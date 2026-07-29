'use client'

import { Icon } from '@/components/Icon'
import { useUI } from '@/components/ui-state'

export function SaveButton({ slug, title }: { slug: string; title: string }) {
  const { isFavorite, toggleFavorite } = useUI()
  const saved = isFavorite(slug)

  return (
    <button
      className="btn btn-ghost"
      aria-pressed={saved}
      onClick={() => toggleFavorite(slug, title)}
    >
      <Icon name="heart" /> {saved ? 'Saved to Favorites' : 'Save to Favorites'}
    </button>
  )
}
