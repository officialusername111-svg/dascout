# Next session — ready-to-paste opening prompt

> Written 2026-08-07 at the end of run `do-me-2026-08-07-blockers`, because that session grew
> too long to keep working in. Paths here are repo-relative; prefix with `dascout/` from the
> workspace root. Paste everything between the rules into a fresh session.

---

/do-me Build the two things that were approved in the previous session but never coded. Both
have signed-off samples; neither has a line of implementation. Read `docs/BACKLOG.md` first —
it is the canonical state — then `docs/HANDOFF.md`, then this file's "Detail" section.

**Task 1 — Buyers & Sellers band, arrangement A.** Approved. Rebuild `VerifiedBand()` in
`components/home/Sections.tsx` as a split billboard: the transparent gold pin plus the kicker
"Partnering You with the Best" and the wordmark BUYERS& / SELLERS on the left, the brand
paragraph in a dark-glass card on the right, "Get started today" beneath the lockup. The
approved sample is https://claude.ai/code/artifact/83903f57-f665-43a0-b95f-13f72b4dabe6 —
build to it exactly, including the CSS in it.

**Task 2 — Phase C, formatted property descriptions.** Approved with the owner's two
overrides. Follow `docs/PLAN-enhancement-v2.md` tasks C1–C6 and the sample at
https://claude.ai/code/artifact/12d5691d-bd7d-491b-8602-bcbfdc9c66c2

Do task 1 first — it is smaller, needs no database change, and is fully reversible.

Two questions are still unanswered and both are cosmetic; take the recommendation, log it, and
flag it in the packet rather than blocking: (a) spell it "DaScout", not the artwork's
"Dascout"; (b) keep the button inside the band.

---

## Detail the prompt above depends on

### Task 1 — the band

**Assets** live in `C:\Users\USER\Downloads\new_asset\`:

| Source | Ship as | Size |
|---|---|---|
| `PwBS_2.png` (2136×805, backdrop + silk already composited) | `pwbs-bg-2000.webp`, `pwbs-bg-1200.webp` | 29 KB / 15 KB |
| `icon-removebg.png` (313×450, fully transparent incl. the ring hole) | `pin-320.webp`, `pin-160.webp` | 13 KB / 8 KB |

Generate with `sharp` (already in `web/node_modules`): webp quality 72 for the backdrop,
quality 88 **with `alphaQuality: 100`** for the pin — the ring hole is the whole point of that
asset and a soft alpha edge shows.

**Retire** `public/assets/buyers-sellers-{900,1400,2000}.webp` and `-2000.jpg` (307 KB), plus
`verified-fields.jpg` which has been unreferenced since Phase A. The 462-character `alt` string
on the current `<img>` goes too — it existed only because the words were pixels.

**The pin must not deform.** Ship it as an `<img>` with `width="313" height="450"`, set only
`height` in CSS, `width:auto`, `object-fit:contain`, `flex:none`. Verified holding 0.6956 at
375 / 768 / desktop and at forced heights of 16px and 900px.

**The lockup proportions are measured, not guessed.** Off the supplied artwork the pin is
~1.73× the height of the whole text block. Drive everything from one variable so they cannot
drift: `--wm:clamp(26px,6.2cqw,52px)`, pin `height:calc(var(--wm)*4)`, kicker
`clamp(13px,calc(var(--wm)*.33),19px)`, gap `calc(var(--wm)*.18)`. Measured result: 1.69 at
desktop and tablet, 1.55 on the phone. **The sample uses container queries so three widths can
be shown on one page — the real build uses ordinary media queries at the same breakpoints.**

**Wordmark:** Montserrat Bold. `app/layout.tsx:18-19` records that the artwork's face has no
licensed files here and Montserrat Bold is the stand-in the owner already approved. It ships at
**weights 600 and 700 only** (`layout.tsx:23`) — anything heavier is the browser faking it.
Both wordmark lines need `white-space:nowrap`.

**Do not name a class so it differs from another only by case.** The sample originally had
arrangements `.A/.B/.C` and wordmark lines `.a/.b`; class selectors are case-insensitive in a
document without a doctype, so `.A{padding:56px}` silently applied to `<span class="a">`. Cost
an hour and presented as a text-wrapping bug that was not one.

### Task 2 — Phase C

Owner's overrides on the original proposal, both already argued and settled:

- **Typeface picker is IN** — four faces only: Figtree (loaded), Montserrat (loaded), Georgia
  and a monospace stack (both system fonts, no download). A fifth face means shipping a font
  file on every listing view; treat that as a separate decision.
- **Free colour codes are IN** — hex or `rgb()`, beside the five swatches, with a live contrast
  readout that **warns below 4.5:1 without blocking**.
- Consequence for **C3**: the sanitiser cannot allowlist five literal colours. It must accept a
  `style` attribute carrying **only** `color` (a parsed valid colour), `font-family` (one of the
  four) and `text-align`, validate each, and **drop** anything else rather than repair it.
- The gold swatch is `#8F6E28` (4.74:1), **not** `#B8923E` — that measures 2.91:1 and fails the
  body-text floor. The bright gold stays correct for headings and buttons.
- Settled without asking: the 12 existing descriptions carry over as plain paragraphs, and
  plain `description` stays beside `description_html` because `lib/match-alerts.ts:120` and the
  SEO meta path must never receive markup.
- Still open, and worth one question in the packet: should the editor offer links? Images are
  already impossible — `img-src` in `proxy.ts:57` blocks them.

C1 (the `description_html` migration) needs the owner's OK at the Supabase MCP prompt. C2–C6
need nothing from them.

### Before you start

- **Acknowledge or clear `REVIEW-PENDING.md`** at the repo root — run
  `do-me-2026-08-07-blockers`, terminal state `done-parked`. A new autonomous run must not start
  over an unacknowledged marker.
- **Six docs commits are unpushed.** No product code among them. Ask before pushing.

### Verification bar, now fully reachable

Vitest **and** `03-listing-journey.spec.ts`, both against a production build. As of 2026-08-07
Vitest is **25/25 files, 453/453 tests** and the journey spec is **19/19** — the first time both
halves have been green since 4 August. Any red is yours.

### Traps that cost real time in the last session

- `npm run build` before Playwright, and it takes port 3000 — stop any preview first.
- **Next's production server caches its public-file list at boot**; a file added to `public/`
  after start returns 404 until you restart it.
- **`document.fonts.check()` returns true for a font that is not loaded.** Only measuring text
  width against the fallback proves a webfont is really rendering.
- **A Suspense boundary must never sit above `ListingActionBar` or `ListingForm`.** It makes
  Next 16 keep two copies of the admin page after a server action and the button sticks on
  "Working…" forever. Both `loading.tsx` files were deleted for this reason; re-run the journey
  spec on any loading change, because a misplaced boundary passes `tsc` and the build.
- The Bash tool is bash, not PowerShell — `-m @'…'@` leaks a literal `@`. Use `git commit -F`.
- Browser-pane screenshots fail intermittently ("not compositing frames"); verify by
  `getBoundingClientRect` and computed style instead.
- Serving a scratch HTML file from `web/public/` applies DaScout's nonce CSP, which **blocks
  inline `<script>`** — fine for checking layout, misleading if the page needs script.
- The E2E suite writes to the live database. Sweep `zz-` rows through the Supabase MCP
  afterwards, scoped by the `zz-` prefix and **never** by status alone.
