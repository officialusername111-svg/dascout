'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  addListingPhoto,
  deletePhoto,
  reorderPhotos,
  setPrimaryPhoto,
  type ActionResult,
} from '@/app/admin/actions'
import {
  downscaleImage,
  rejectOversizeBlob,
  rejectUnsupportedFile,
} from '@/lib/admin/downscale'
import {
  ALLOWED_PHOTO_TYPES,
  photoObjectPath,
  type PhotoBucket,
} from '@/lib/admin/photos'
import { createClient } from '@/lib/supabase/client'
import { PhotoCard, type PhotoCardPhoto } from '@/components/admin/PhotoCard'

/**
 * Uploading, ordering and deleting a listing's photos.
 *
 * The bytes go straight from this browser to Storage under the staff user's own
 * session, so row-level security is what authorises the write and no server action
 * ever carries a file. Each picked file goes through the same four steps, one file at
 * a time so a slow connection produces a readable queue rather than eight stalled
 * parallel requests:
 *
 *   reject unsupported type → downscale and re-encode → upload → record the row
 *
 * The row is recorded last and by the server, which re-checks that the object really
 * arrived. That ordering is what stops a failed upload from leaving a row pointing at
 * nothing.
 */

type QueueState = 'working' | 'done' | 'failed'
type QueueItem = {
  key: string
  name: string
  state: QueueState
  detail: string
  /** A `blob:` URL of the resized image, so the clerk sees what was actually sent. */
  preview?: string
}

export function PhotoManager({
  listingId,
  status,
  uploadBucket,
  photos,
}: {
  listingId: string
  status: string
  uploadBucket: PhotoBucket
  photos: PhotoCardPhoto[]
}) {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)
  const previewUrls = useRef<string[]>([])

  // Object URLs are held by the browser until they are revoked by hand; leaving them
  // behind on every navigation leaks the whole photo into memory for the session.
  useEffect(() => {
    const urls = previewUrls.current
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
      urls.length = 0
    }
  }, [])

  // A withdrawn listing's photos are already public, so anything uploaded now would be
  // published the moment it landed. The control is hidden and the action refuses too.
  const uploadsBlocked = status === 'withdrawn'
  const busy = uploading || pending

  function report(result: ActionResult<unknown>): void {
    if (result.ok) {
      setNotice({ kind: result.warning ? 'err' : 'ok', text: result.warning ?? result.message ?? 'Saved.' })
    } else {
      setNotice({ kind: 'err', text: result.message })
    }
  }

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files || !files.length) return

    setNotice(null)
    setUploading(true)
    const supabase = createClient()

    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`
      const update = (state: QueueState, detail: string, preview?: string) =>
        setQueue((items) =>
          items.some((item) => item.key === key)
            ? items.map((item) =>
                item.key === key ? { ...item, state, detail, preview: preview ?? item.preview } : item
              )
            : [...items, { key, name: file.name, state, detail, preview }]
        )

      const unsupported = rejectUnsupportedFile(file)
      if (unsupported) {
        update('failed', unsupported.reason)
        continue
      }

      update('working', 'Resizing…')

      try {
        const shrunk = await downscaleImage(file)

        const oversize = rejectOversizeBlob(file, shrunk.blob)
        if (oversize) {
          update('failed', oversize.reason)
          continue
        }

        const preview = URL.createObjectURL(shrunk.blob)
        previewUrls.current.push(preview)

        const path = photoObjectPath(listingId, shrunk.extension)
        update('working', `Uploading ${shrunk.width}×${shrunk.height}…`, preview)

        const { error: uploadError } = await supabase.storage
          .from(uploadBucket)
          .upload(path, shrunk.blob, { contentType: shrunk.blob.type, upsert: false })

        if (uploadError) {
          update('failed', `Upload refused: ${uploadError.message}`)
          continue
        }

        update('working', 'Recording…')
        const result = await addListingPhoto({ listingId, storagePath: path })

        if (!result.ok) {
          update('failed', result.message)
          continue
        }

        update('done', `Added at ${shrunk.width}×${shrunk.height}.`)
      } catch (error) {
        update('failed', error instanceof Error ? error.message : 'Could not read that image.')
      }
    }

    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  function move(index: number, direction: -1 | 1): void {
    const target = index + direction
    if (target < 0 || target >= photos.length) return

    const ids = photos.map((photo) => photo.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]

    setNotice(null)
    startTransition(async () => {
      report(await reorderPhotos({ listingId, photoIds: ids }))
    })
  }

  function makeCover(photoId: string): void {
    setNotice(null)
    startTransition(async () => {
      report(await setPrimaryPhoto({ listingId, photoId }))
    })
  }

  function remove(photoId: string): void {
    setNotice(null)
    startTransition(async () => {
      report(await deletePhoto({ listingId, photoId }))
    })
  }

  return (
    <section className="apanel" aria-labelledby="photosH">
      <h2 id="photosH">Photos</h2>
      <p className="sub2">
        The first photo is the cover buyers see. Photos are resized in your browser before they
        upload, and the camera&rsquo;s location data is dropped in the process.{' '}
        {uploadBucket === 'listing-photos-draft'
          ? 'While this listing is unpublished they sit in the private bucket, where only staff can open them.'
          : 'This listing is published, so its photos are served publicly.'}
      </p>

      {notice && (
        <div className={`fmsg ${notice.kind}`} role={notice.kind === 'err' ? 'alert' : 'status'}>
          {notice.text}
        </div>
      )}

      {uploadsBlocked ? (
        <div className="empty">
          <b>Uploads are paused while this listing is withdrawn</b>
          Its photos are already in the public bucket, so anything added now would be reachable
          straight away. Relist it first.
        </div>
      ) : (
        <div className="field">
          <label htmlFor="photo-input">Add photos</label>
          <input
            id="photo-input"
            ref={inputRef}
            type="file"
            multiple
            accept={ALLOWED_PHOTO_TYPES.join(',')}
            disabled={busy}
            onChange={(event) => {
              void handleFiles(event.target.files)
            }}
          />
          <div className="hint">
            JPEG, PNG or WebP. Straight off a phone is fine — anything larger than 1920px on its
            longest edge is shrunk here before it leaves your device.
          </div>
        </div>
      )}

      {queue.length > 0 && (
        <div className="aqueue" aria-live="polite">
          {queue.map((item) => (
            <div
              key={item.key}
              className={item.state === 'failed' ? 'bad' : item.state === 'done' ? 'good' : ''}
            >
              {item.preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.preview} alt="" />
              )}
              <b>{item.name}</b>
              <span>{item.detail}</span>
            </div>
          ))}
        </div>
      )}

      {photos.length ? (
        <div className="aphotos">
          {photos.map((photo, index) => (
            <PhotoCard
              key={photo.id}
              listingId={listingId}
              photo={photo}
              index={index}
              total={photos.length}
              busy={busy}
              onMove={move}
              onMakeCover={makeCover}
              onDelete={remove}
            />
          ))}
        </div>
      ) : (
        <div className="empty">
          <b>No photos yet</b>
          A listing needs at least one photo, with one of them chosen as the cover, before it can
          be published.
        </div>
      )}
    </section>
  )
}
