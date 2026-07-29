'use client'

import { Icon } from '@/components/Icon'
import { useUI } from '@/components/ui-state'

/** The heart on a listing card. Saved properties live in the browser until Phase 3. */
export function FavButton({ slug, title }: { slug: string; title: string }) {
  const { isFavorite, toggleFavorite } = useUI()
  const saved = isFavorite(slug)

  return (
    <button
      className="fav"
      aria-pressed={saved}
      aria-label={`${saved ? 'Remove' : 'Save'} ${title} ${saved ? 'from' : 'to'} favorites`}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        toggleFavorite(slug, title)
      }}
    >
      <Icon name="heart" />
    </button>
  )
}
