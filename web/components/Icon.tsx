/**
 * Every icon comes from the sprite rendered once in the layout, exactly as the
 * approved mockup did — one request, no icon library.
 */
export function Icon({ name, className = 'icon' }: { name: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  )
}
