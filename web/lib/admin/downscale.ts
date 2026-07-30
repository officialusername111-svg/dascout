import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES } from '@/lib/admin/photos'

/**
 * Shrinks a camera photo in the browser before it is ever uploaded.
 *
 * Three reasons this happens client-side rather than on a server:
 *
 * - A phone photo is 4–15 MB and the bucket's ceiling is 10 MB. Re-encoding first
 *   is what makes a normal field photo uploadable at all.
 * - Server actions carry a 1 MB body, so the bytes must go straight from the
 *   browser to Storage. Nothing on the server ever sees the original file.
 * - Re-encoding through a canvas drops the EXIF block, and with it the GPS
 *   coordinates and device serial a seller's phone stamped into the file. For a
 *   property listing that metadata is a privacy leak, so losing it is the point,
 *   not a side effect.
 *
 * Browser-only: it touches `document` and `createImageBitmap`, so only client
 * components may import it.
 */

/** The longest edge any stored photo is allowed to have. */
export const MAX_EDGE_PX = 1920

/** WebP first — smallest at a given quality, and every browser that runs this app reads it. */
const WEBP_QUALITY = 0.9
const JPEG_QUALITY = 0.85

export type DownscaleResult = {
  blob: Blob
  /** The extension the object path must use, derived from what the canvas actually produced. */
  extension: 'webp' | 'jpg'
  width: number
  height: number
  originalBytes: number
}

/** Why a file was turned away before any network request happened. */
export type PhotoRejection = { reason: string }

/**
 * The checks that run before a byte leaves the browser. Type is checked here rather
 * than only after downscaling so a PDF is refused instantly with the accepted types
 * named, instead of failing deep inside an image decoder.
 */
export function rejectUnsupportedFile(file: File): PhotoRejection | null {
  if (!(ALLOWED_PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return {
      reason: `${file.name}: only JPEG, PNG and WebP images can be uploaded.`,
    }
  }
  return null
}

/**
 * Re-encodes `file` so its longest edge is at most 1920px.
 *
 * `imageOrientation: 'from-image'` applies the EXIF rotation flag while decoding.
 * Without it a portrait phone photo decodes sideways, and since the re-encode drops
 * EXIF there would be no flag left for the browser to correct it by — the photo
 * would be stored rotated for good.
 *
 * An image already inside the limit is still re-encoded (for the EXIF strip) but
 * never scaled up: enlarging pixels only inflates the file.
 */
export async function downscaleImage(file: File): Promise<DownscaleResult> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

  try {
    const longest = Math.max(bitmap.width, bitmap.height)
    const scale = longest > MAX_EDGE_PX ? MAX_EDGE_PX / longest : 1
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser could not open a drawing canvas for the photo.')
    context.drawImage(bitmap, 0, 0, width, height)

    let blob = await toBlob(canvas, 'image/webp', WEBP_QUALITY)
    let extension: 'webp' | 'jpg' = 'webp'

    // A browser that cannot encode WebP silently hands back a PNG instead, which
    // would be larger than the original. Ask for JPEG rather than store that.
    if (!blob || blob.type !== 'image/webp') {
      blob = await toBlob(canvas, 'image/jpeg', JPEG_QUALITY)
      extension = 'jpg'
    }
    if (!blob) throw new Error('This browser could not re-encode the photo for upload.')

    return { blob, extension, width, height, originalBytes: file.size }
  } finally {
    bitmap.close()
  }
}

/**
 * The size rule, applied to the re-encoded file rather than the original — a 15 MB
 * camera photo is a normal thing to upload and comes out well under the cap.
 */
export function rejectOversizeBlob(file: File, blob: Blob): PhotoRejection | null {
  if (blob.size > MAX_PHOTO_BYTES) {
    return {
      reason: `${file.name}: still ${formatMb(blob.size)} after resizing, over the ${formatMb(
        MAX_PHOTO_BYTES
      )} limit. Crop it or save it at a lower quality first.`,
    }
  }
  return null
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}
