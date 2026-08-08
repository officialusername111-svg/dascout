/**
 * Phase C (C4) — the sanitiser's hostile-input suite.
 *
 * This is the security requirement of the enhancement round, not a nice-to-have. Stored
 * HTML is rendered back to every visitor who opens a listing, so a hole here is a stored
 * XSS against buyers, reachable by anyone who can edit a listing.
 *
 * The tests are written as "what an attacker sends" rather than "what the function does",
 * so a future refactor that changes the implementation still has to answer the same
 * questions.
 */
import { describe, expect, it } from 'vitest'
import {
  contrastOnWhite,
  htmlToPlainText,
  isEmptyDescriptionHtml,
  parseCssColor,
  sanitizeDescriptionHtml,
  toHexColor,
} from '@/lib/listing-description'

describe('sanitizeDescriptionHtml — hostile input', () => {
  it('drops a script tag AND its body, so the code never shows up as visible words', () => {
    const out = sanitizeDescriptionHtml('<p>Nice lot</p><script>alert(1)</script>')
    expect(out).not.toContain('script')
    expect(out).not.toContain('alert')
    expect(out).toContain('Nice lot')
  })

  it('drops an onerror handler', () => {
    const out = sanitizeDescriptionHtml('<p onerror="alert(1)">Corner lot</p>')
    expect(out).not.toContain('onerror')
    expect(out).toContain('Corner lot')
  })

  it('drops every other inline event handler it is given', () => {
    for (const attr of ['onclick', 'onload', 'onmouseover', 'onfocus', 'onanimationstart']) {
      const out = sanitizeDescriptionHtml(`<p ${attr}="alert(1)">x</p>`)
      expect(out, attr).not.toContain(attr)
      expect(out, attr).not.toContain('alert')
    }
  })

  it('drops a javascript: href by dropping the anchor entirely — links are not offered', () => {
    const out = sanitizeDescriptionHtml('<p><a href="javascript:alert(1)">tap here</a></p>')
    expect(out).not.toContain('javascript')
    expect(out).not.toContain('href')
    expect(out).not.toContain('<a')
    // the words survive; only the link does not
    expect(out).toContain('tap here')
  })

  it('drops http and mailto links too, not just dangerous schemes', () => {
    const out = sanitizeDescriptionHtml(
      '<p><a href="https://example.com">site</a> <a href="mailto:x@y.z">mail</a></p>'
    )
    expect(out).not.toContain('href')
    expect(out).not.toContain('<a')
  })

  it('drops images, which the CSP already blocks but which must not reach the database', () => {
    const out = sanitizeDescriptionHtml('<p><img src=x onerror=alert(1)>Lot</p>')
    expect(out).not.toContain('img')
    expect(out).not.toContain('onerror')
  })

  it('drops iframes, objects, embeds, forms and svg', () => {
    for (const tag of ['iframe', 'object', 'embed', 'form', 'svg', 'math', 'base', 'meta', 'link']) {
      const out = sanitizeDescriptionHtml(`<p>ok</p><${tag}></${tag}>`)
      expect(out, tag).not.toContain(`<${tag}`)
    }
  })

  it('drops a style tag and its CSS body', () => {
    const out = sanitizeDescriptionHtml('<style>p{position:fixed}</style><p>Lot</p>')
    expect(out).not.toContain('position')
    expect(out).toContain('Lot')
  })

  it('does not resurrect a tag from a broken or nested-tag evasion attempt', () => {
    const out = sanitizeDescriptionHtml('<p><scr<script>ipt>alert(1)</script></p>')
    /*
     * The payload's leftovers DO survive as words — the result is
     * `<p>ipt&gt;alert(1)</p>`. That is the correct outcome, not a miss: every `<` and `>`
     * in the residue is escaped, so no tag can form from it and the browser renders it as
     * text. Asserting "the string alert(1) is absent" would be asserting the wrong thing;
     * what matters is that nothing in the output can open an element.
     */
    expect(out.toLowerCase()).not.toContain('<script')
    expect(out).toBe('<p>ipt&gt;alert(1)</p>')
    expect(out.replace(/<\/?p>/g, '')).not.toMatch(/[<>]/)
  })

  it('keeps a <b style> attacker on the same filtering path as every other tag', () => {
    // b is renamed to strong; the rename must not skip the style filter
    const out = sanitizeDescriptionHtml('<b style="position:fixed;top:0;color:#8F6E28">x</b>')
    expect(out).toContain('<strong')
    expect(out).not.toContain('position')
    expect(out).not.toContain('fixed')
    expect(out).toContain('color:#8F6E28')
  })
})

describe('sanitizeDescriptionHtml — the style allowlist drops rather than repairs', () => {
  it('keeps a valid colour and normalises it to hex', () => {
    expect(sanitizeDescriptionHtml('<p style="color:rgb(143,110,40)">x</p>')).toContain('color:#8F6E28')
    expect(sanitizeDescriptionHtml('<p style="color:#8f6e28">x</p>')).toContain('color:#8F6E28')
    expect(sanitizeDescriptionHtml('<p style="color:#abc">x</p>')).toContain('color:#AABBCC')
  })

  it('drops a colour that is not a real colour code', () => {
    for (const bad of ['red', 'rebeccapurple', 'var(--gold)', 'url(javascript:alert(1))', '#12345', 'rgb(300,0,0)']) {
      const out = sanitizeDescriptionHtml(`<p style="color:${bad}">x</p>`)
      expect(out, bad).not.toContain('color:')
    }
  })

  it('drops a colour carrying !important instead of stripping the keyword and keeping it', () => {
    const out = sanitizeDescriptionHtml('<p style="color:#8F6E28 !important">x</p>')
    expect(out).not.toContain('color:')
    expect(out).not.toContain('important')
  })

  it('keeps the four allowed typefaces and canonicalises the stack', () => {
    expect(sanitizeDescriptionHtml('<p style="font-family:Georgia">x</p>')).toContain('Georgia')
    expect(sanitizeDescriptionHtml('<p style="font-family:montserrat, junk">x</p>')).toContain('Montserrat')
    expect(sanitizeDescriptionHtml('<p style="font-family:ui-monospace">x</p>')).toContain('ui-monospace')
    // the canonical stack is substituted, so a caller cannot smuggle extra families in
    expect(sanitizeDescriptionHtml('<p style="font-family:montserrat, junk">x</p>')).not.toContain('junk')
  })

  it('drops a fifth typeface, because a fifth face is a separate decision', () => {
    const out = sanitizeDescriptionHtml('<p style="font-family:Comic Sans MS">x</p>')
    expect(out).not.toContain('font-family')
  })

  it('keeps the three alignments and drops anything else', () => {
    expect(sanitizeDescriptionHtml('<p style="text-align:center">x</p>')).toContain('text-align:center')
    expect(sanitizeDescriptionHtml('<p style="text-align:right">x</p>')).toContain('text-align:right')
    expect(sanitizeDescriptionHtml('<p style="text-align:justify">x</p>')).not.toContain('text-align')
  })

  it('drops every property that is not colour, typeface or alignment', () => {
    const hostile =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;background:red;' +
      'opacity:0;transform:scale(40);behavior:url(x.htc);-moz-binding:url(x.xml)'
    const out = sanitizeDescriptionHtml(`<p style="${hostile}">Free house</p>`)
    expect(out).toBe('<p>Free house</p>')
  })

  it('keeps the allowed declarations out of a mixed hostile style attribute', () => {
    const out = sanitizeDescriptionHtml(
      '<p style="position:fixed;color:#1E7A46;background:url(javascript:alert(1));text-align:center">x</p>'
    )
    expect(out).toContain('color:#1E7A46')
    expect(out).toContain('text-align:center')
    expect(out).not.toContain('position')
    expect(out).not.toContain('background')
    expect(out).not.toContain('javascript')
  })
})

describe('sanitizeDescriptionHtml — the formatting the toolbar produces survives', () => {
  it('keeps the tags the toolbar can make', () => {
    const input =
      '<p>A <strong>corner lot</strong> with <em>clean title</em> and <u>paid taxes</u>.</p>' +
      '<h4>What is included</h4>' +
      '<ul><li>Fenced on three sides</li><li>Frontage cleared</li></ul>' +
      '<ol><li>First</li></ol>' +
      '<p style="text-align:center;color:#8F6E28"><strong>Viewing by appointment.</strong></p>'
    expect(sanitizeDescriptionHtml(input)).toBe(input)
  })

  it('keeps line breaks', () => {
    expect(sanitizeDescriptionHtml('<p>one<br />two</p>')).toContain('<br')
  })

  it('returns an empty string for empty input rather than throwing', () => {
    expect(sanitizeDescriptionHtml('')).toBe('')
    expect(sanitizeDescriptionHtml(null)).toBe('')
    expect(sanitizeDescriptionHtml(undefined)).toBe('')
  })

  it('truncates absurdly long input instead of storing it', () => {
    const huge = '<p>' + 'a'.repeat(60_000) + '</p>'
    expect(sanitizeDescriptionHtml(huge).length).toBeLessThanOrEqual(20_000)
  })

  it('is idempotent — sanitising twice changes nothing', () => {
    const once = sanitizeDescriptionHtml('<p style="color:rgb(30,122,70)">Clean <b>title</b></p>')
    expect(sanitizeDescriptionHtml(once)).toBe(once)
  })
})

/**
 * THE TEST THAT EARNS ITS KEEP. Everything above proves the filter blocks what it should;
 * this proves it does not block what it must not. The string below is not hand-written —
 * it was copied out of the editor's own hidden input in a browser after using the toolbar,
 * so it is exactly what the server will be handed.
 *
 * It caught a real one: `span` was missing from the tag allowlist, so every colour and
 * every typeface was silently dropped on save. Nothing errored, the editor looked correct,
 * and the listing simply came back plain. Only a round-trip finds that class of bug —
 * hostile-input tests never would have.
 */
describe('round trip — what the toolbar produces survives the filter', () => {
  const FROM_EDITOR =
    '<p style="text-align: center;"><span style="color: rgb(143, 110, 40); ' +
    'font-family: Georgia, &quot;Times New Roman&quot;, serif;">A <strong>corner residential lot</strong> ' +
    'in a gated subdivision.</span></p><ul><li><p><span style="color: rgb(143, 110, 40);">Title clean</span>' +
    '</p></li></ul><p></p>'

  it('keeps every piece of formatting the toolbar applied', () => {
    const clean = sanitizeDescriptionHtml(FROM_EDITOR)
    expect(clean).toContain('color:#8F6E28')
    expect(clean).toContain('font-family:Georgia')
    expect(clean).toContain('text-align:center')
    expect(clean).toContain('<strong>')
    expect(clean).toContain('<li>')
    expect(clean).toContain('<span')
  })

  it('drops the editor’s trailing empty paragraph rather than shipping a blank gap', () => {
    expect(sanitizeDescriptionHtml(FROM_EDITOR)).not.toMatch(/<p><\/p>$/)
    // an empty paragraph BETWEEN two others is spacing the author chose, and stays
    expect(sanitizeDescriptionHtml('<p>a</p><p></p><p>b</p>')).toBe('<p>a</p><p></p><p>b</p>')
  })

  it('derives readable plain text from it for the meta description', () => {
    expect(htmlToPlainText(sanitizeDescriptionHtml(FROM_EDITOR))).toBe(
      'A corner residential lot in a gated subdivision.\n\nTitle clean'
    )
  })

  it('is stable — re-saving an already-saved description changes nothing', () => {
    const once = sanitizeDescriptionHtml(FROM_EDITOR)
    expect(sanitizeDescriptionHtml(once)).toBe(once)
  })
})

describe('htmlToPlainText — what the SEO meta path and alerts receive', () => {
  it('never returns markup', () => {
    const text = htmlToPlainText('<p style="color:#8F6E28">A <strong>corner lot</strong></p>')
    expect(text).toBe('A corner lot')
    expect(text).not.toContain('<')
  })

  it('turns blocks into blank lines and <br> into a single newline', () => {
    expect(htmlToPlainText('<p>One</p><p>Two</p>')).toBe('One\n\nTwo')
    expect(htmlToPlainText('<p>One<br>Two</p>')).toBe('One\nTwo')
  })

  it('reads list items as separate lines', () => {
    expect(htmlToPlainText('<ul><li>A</li><li>B</li></ul>')).toBe('A\n\nB')
  })

  it('decodes entities rather than leaving them for the page to render', () => {
    expect(htmlToPlainText('<p>Lot &amp; house &lt;here&gt;</p>')).toBe('Lot & house <here>')
  })

  it('reports an editor that looks full but says nothing as empty', () => {
    expect(isEmptyDescriptionHtml('<p></p>')).toBe(true)
    expect(isEmptyDescriptionHtml('<p><br></p>')).toBe(true)
    expect(isEmptyDescriptionHtml('')).toBe(true)
    expect(isEmptyDescriptionHtml('<p>Something</p>')).toBe(false)
  })
})

describe('the colour helpers the editor readout depends on', () => {
  it('parses the forms the picker can produce and rejects the rest', () => {
    expect(parseCssColor('#8F6E28')).toEqual([143, 110, 40])
    expect(parseCssColor('#abc')).toEqual([170, 187, 204])
    expect(parseCssColor('rgb(74, 44, 122)')).toEqual([74, 44, 122])
    expect(parseCssColor('rgba(74,44,122,0.5)')).toEqual([74, 44, 122])
    expect(parseCssColor('nonsense')).toBeNull()
    expect(parseCssColor('rgb(1,2)')).toBeNull()
  })

  it('round-trips to hex', () => {
    expect(toHexColor([143, 110, 40])).toBe('#8F6E28')
  })

  it('measures the two golds the way the decision to swap them was made', () => {
    // this is the reason the swatch is #8F6E28 and not the brand's bright gold
    expect(contrastOnWhite([184, 146, 62])).toBeCloseTo(2.91, 1) // #B8923E — fails
    expect(contrastOnWhite([143, 110, 40])).toBeCloseTo(4.74, 1) // #8F6E28 — passes
  })

  it('puts black at 21:1 and white at 1:1', () => {
    expect(contrastOnWhite([0, 0, 0])).toBeCloseTo(21, 1)
    expect(contrastOnWhite([255, 255, 255])).toBeCloseTo(1, 2)
  })
})
