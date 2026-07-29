'use client'

import { useState } from 'react'

/** Main photo plus the thumbnail strip, in the order staff arranged them. */
export function Gallery({ photos, title }: { photos: { url: string; alt: string }[]; title: string }) {
  const [index, setIndex] = useState(0)
  const main = photos[index]

  return (
    <div className="gallery">
      <div className="main">
        {main ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={main.url} alt={main.alt || `${title} photo`} />
        ) : (
          <span className="ph-empty" aria-hidden="true" />
        )}
      </div>
      {photos.length > 1 && (
        <div className="thumbs" role="group" aria-label="Photos">
          {photos.map((photo, i) => (
            <button
              key={photo.url}
              aria-pressed={i === index}
              aria-label={`Photo ${i + 1} of ${photos.length}`}
              onClick={() => setIndex(i)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img loading="lazy" decoding="async" src={photo.url} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
