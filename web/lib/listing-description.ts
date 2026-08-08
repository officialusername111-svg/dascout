/**
 * Phase C — formatted property descriptions (client item 6).
 *
 * WHY THIS FILE EXISTS AT ALL. Stored HTML that is rendered back to visitors turns any
 * admin account into a stored-XSS vector against everyone who opens the listing. So the
 * rule is absolute: nothing reaches `listings.description_html` that has not been through
 * `sanitizeDescriptionHtml` ON THE SERVER. Sanitising in the editor is a convenience for
 * the person typing; it is not a control, because the browser is not where the trust is.
 *
 * THE ALLOWLIST DROPS, IT NEVER REPAIRS. The owner's decision to allow free colour codes
 * (2026-08-07) means the filter can no longer just recognise five literal colours. Instead
 * it accepts a `style` attribute carrying ONLY `color`, `font-family` and `text-align`,
 * validates each value against a closed rule, and throws away anything it does not
 * recognise rather than trying to correct it. A filter that guesses at a value it does not
 * understand is a filter with a hole in it.
 *
 * `description` (plain) stays beside `description_html` and is DERIVED from it by
 * `htmlToPlainText`, so the two can never drift. The SEO meta path in
 * `app/property/[slug]/page.tsx` reads the plain one and must never receive markup.
 */
import sanitizeHtml from 'sanitize-html'

/** The four faces, and only these four. */
export const DESCRIPTION_FACES = [
  { id: '', label: 'Figtree — site default', stack: '' },
  { id: 'montserrat', label: 'Montserrat — headings face', stack: 'Montserrat, "Segoe UI", system-ui, sans-serif' },
  { id: 'georgia', label: 'Georgia — serif', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'Monospace', stack: 'ui-monospace, "Cascadia Mono", Consolas, monospace' },
] as const

/**
 * A fifth face would mean shipping a font file on every listing view, which is a separate
 * decision. Two of these are already loaded on every page; two are the reader's own.
 */
const FACE_BY_FIRST_FAMILY = new Map<string, string>(
  DESCRIPTION_FACES.filter((f) => f.stack !== '').map((f) => [firstFamily(f.stack), f.stack])
)

/**
 * The five quick swatches. `#8F6E28` is deliberate and is NOT the brand's bright gold:
 * `#B8923E` measures 2.91:1 on white and fails the 4.5:1 body-text floor. The bright gold
 * stays correct for headings and buttons — just not for paragraphs.
 */
export const DESCRIPTION_SWATCHES = [
  { value: '#16161A', label: 'Ink (default)' },
  { value: '#52525B', label: 'Muted' },
  { value: '#8F6E28', label: 'Gold (text weight)' },
  { value: '#1E7A46', label: 'Green' },
  { value: '#B3261E', label: 'Red' },
] as const

const ALIGNMENTS = new Set(['left', 'center', 'right'])

/** Longer than any legitimate description, short enough that a paste bomb cannot land. */
export const MAX_DESCRIPTION_HTML = 20_000
/** The plain-text ceiling the form has always enforced, unchanged. */
export const MAX_DESCRIPTION_TEXT = 4_000

function firstFamily(stack: string): string {
  const first = stack.split(',')[0] ?? ''
  return first.trim().replace(/^["']|["']$/g, '').toLowerCase()
}

/**
 * Parse a CSS colour the toolbar can produce: #rgb, #rrggbb, rgb() and rgba().
 * Named colours are NOT accepted — "red" and "rebeccapurple" are real, but so is the long
 * tail of names nobody audits, and the toolbar never emits one.
 * Returns null for anything else, which the caller turns into a dropped declaration.
 */
export function parseCssColor(input: string): [number, number, number] | null {
  const text = String(input).trim()

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }

  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(text)
  if (rgb) {
    const parts: [number, number, number] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    return parts.every((n) => n >= 0 && n <= 255) ? parts : null
  }

  return null
}

export function toHexColor(rgb: [number, number, number]): string {
  return '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()
}

/**
 * WCAG contrast against white, which is what a listing description sits on. The editor
 * shows this live and WARNS below 4.5:1 — the owner's call is that it warns and never
 * blocks, so this is reporting, not enforcement, and the sanitiser does not consult it.
 */
export function contrastOnWhite(rgb: [number, number, number]): number {
  const linear = rgb.map((n) => {
    const c = n / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  return 1.05 / (luminance + 0.05)
}

/**
 * Rebuild a style attribute from only the declarations that survive validation.
 * Anything unrecognised — a property not on the list, a colour that does not parse, a
 * typeface not among the four — is dropped rather than corrected.
 */
function filterStyle(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const kept: string[] = []

  for (const declaration of raw.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon === -1) continue
    const prop = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).trim()
    if (value === '') continue

    // No separate guard for `!important`, CSS comments or `url(...)` is needed: each
    // property below validates its whole value against a closed rule, so
    // `color:#fff !important` fails to parse as a colour and is dropped like any other
    // value the filter does not recognise. One path, not two.

    if (prop === 'color') {
      const rgb = parseCssColor(value)
      if (rgb) kept.push(`color:${toHexColor(rgb)}`)
      continue
    }

    if (prop === 'text-align') {
      const align = value.toLowerCase()
      if (ALIGNMENTS.has(align)) kept.push(`text-align:${align}`)
      continue
    }

    if (prop === 'font-family') {
      const canonical = FACE_BY_FIRST_FAMILY.get(firstFamily(value))
      if (canonical) kept.push(`font-family:${canonical}`)
      continue
    }

    // every other property, silently gone
  }

  return kept.length > 0 ? kept.join(';') : undefined
}

const STYLEABLE = new Set(['p', 'h4', 'li', 'span', 'strong', 'em', 'u'])

/**
 * The one function that decides what may be stored. Server-side, on every save.
 *
 * No `a` and no `img`. Images are impossible anyway — `img-src` in `proxy.ts` blocks
 * remote ones — and links were left out because they are a way to send a buyer somewhere
 * else. Adding links later means adding `a` here WITH an href scheme allowlist, never
 * just to the tag list.
 */
export function sanitizeDescriptionHtml(input: string | null | undefined): string {
  if (!input) return ''

  const once = sanitizeOnce(String(input).slice(0, MAX_DESCRIPTION_HTML))
  if (once.length <= MAX_DESCRIPTION_HTML) return once

  /*
   * Slicing the INPUT does not bound the OUTPUT: the parser repairs whatever the slice
   * broke by writing the closing tags back, so a cut at the limit can come back a few
   * characters over it. Re-run with headroom for those closers, so the cap is a real
   * guarantee rather than an approximate one. The nesting this allowlist permits is at
   * most p > ul > li > strong, so 256 characters is generous.
   */
  return sanitizeOnce(String(input).slice(0, MAX_DESCRIPTION_HTML - 256))
}

function sanitizeOnce(input: string): string {
  const clean = sanitizeHtml(input, {
    /*
     * `span` is here because that is how colour and typeface actually arrive: the editor
     * writes them as `<span style="color:...;font-family:...">`, not as attributes on the
     * paragraph. Leaving it out silently threw away every colour and every face on save —
     * the editor looked right, the saved listing came back plain, and nothing errored.
     * A bare span carries no meaning of its own, so the style filter is what makes it safe.
     */
    allowedTags: ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'h4', 'span'],
    allowedAttributes: { '*': ['style'] },
    // no schemes at all: nothing that survives can carry a URL in the first place
    allowedSchemes: [],
    allowedSchemesByTag: {},
    allowProtocolRelative: false,
    // strip the CONTENTS of these too — the default drops the tag but keeps the text,
    // which would leave a script body sitting in the page as visible words.
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'iframe', 'template'],
    transformTags: {
      /*
       * ONE transform, not several. `b -> strong` as its own entry would win over this
       * `*` entry for <b> and skip the style filter entirely, so a pasted
       * `<b style="position:fixed">` would arrive as a <strong> with its style intact.
       * Renaming inside the single wildcard keeps every tag on one path.
       */
      '*': (tagName, attribs) => {
        const name = tagName === 'b' ? 'strong' : tagName === 'i' ? 'em' : tagName
        const attrs: Record<string, string> = {}
        if (STYLEABLE.has(name)) {
          const style = filterStyle(attribs.style)
          if (style) attrs.style = style
        }
        return { tagName: name, attribs: attrs }
      },
    },
  })

  /*
   * The editor keeps an empty paragraph at the end as somewhere to click, and it is real
   * markup that would ship as a blank gap under every description. Trailing ones only:
   * an empty paragraph the author put BETWEEN two others is spacing they chose.
   */
  return clean.replace(/(?:<p>(?:\s|<br\s*\/?>)*<\/p>)+$/i, '').trim()
}

/**
 * The plain-text derivation stored in `description`. Block ends become blank lines and
 * `<br>` becomes a single newline, so the plain version reads the way the formatted one
 * looks rather than as one run-on paragraph.
 *
 * It runs on the SANITISED html, never on raw input, so it cannot be the thing that lets
 * something through.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return ''

  const spaced = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h4|li)>/gi, '\n\n')
    .replace(/<\/(ul|ol)>/gi, '\n')

  const text = decodeEntities(sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} }))

  return text
    .replace(/ /g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * `sanitizeHtml` with an empty tag list ESCAPES the text it keeps, so stripping the markup
 * leaves `&amp;` sitting in what is supposed to be plain text — and that string goes
 * straight into the page's `<meta name="description">`, where a reader would see the
 * entity instead of the ampersand.
 *
 * One pass, not several: decoding `&lt;` and then `&amp;` in separate passes would turn a
 * literal `&amp;lt;` into `<`, inventing a character the author never typed.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole: string, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

/** True when the editor produced nothing a reader would see (empty paragraphs count as nothing). */
export function isEmptyDescriptionHtml(html: string | null | undefined): boolean {
  return htmlToPlainText(html) === ''
}
