/**
 * The branded loading state (piece 6 of listing encoding v2). Diagnosis first: the
 * "freezes and then blinks" symptom traced to zero `loading.tsx` files and zero
 * `<Suspense>` boundaries anywhere in the app — Next's default without one is to hold the
 * previous page fully rendered and unresponsive until the destination route's data is
 * completely ready, then swap the whole page in one frame. This component is the Suspense
 * fallback that fixes that structurally; it is not a spinner glued over the same blocking
 * wait.
 *
 * The mark itself never distorts — it is the fixed brand asset. Only two rings animate,
 * positioned over the gold pin glyph already inside the wordmark (the product's own
 * location-pin motif, not a spinner borrowed from nowhere), staggered half a beat apart so
 * something is always visibly moving without ever reading as a spin. `prefers-reduced-motion`
 * turns the animation off in globals.css; the mark and copy are unaffected either way.
 */
export function LoadingMark({ variant }: { variant: 'public' | 'admin' }) {
  return (
    <div className={`loading-stage ${variant === 'admin' ? 'dark' : ''}`}>
      <div className="loading-mark">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="loading-mark-img"
          src="/assets/dascout-logo.png"
          alt=""
          style={variant === 'admin' ? { filter: 'brightness(0) invert(1)' } : undefined}
        />
        <span className="loading-ping" aria-hidden="true" />
        <span className="loading-ping d2" aria-hidden="true" />
      </div>
      <p className="loading-copy" role="status">
        {variant === 'admin' ? 'Loading…' : 'Finding your next property…'}
      </p>
    </div>
  )
}
