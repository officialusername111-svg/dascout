# HANDOFF — DaScout (single overwritten file)

> This file replaces the date-stamped handoff chain (DISPATCH.md §0 "The standing queue").
> It is OVERWRITTEN each handoff; git history keeps prior versions. The dated
> `HANDOFF-2026-*.md` files are retired — `HANDOFF-2026-08-04-evening.md` was the last one
> and remains valid history. Paths are repo-relative; prefix with `dascout/` from the
> workspace root (rule in `D:\Workspace\DaScout\CLAUDE.md`).

## Read first

1. `docs/BACKLOG.md` — the queue: Now / Next / Parked / Decided / Standing.
2. This file — only what changed since the last handoff, plus session quirks.
3. `docs/PLAN-enhancement-v2.md` — the nine client items, the five owner decisions, the
   five phases and their task IDs. Phase A's task IDs (A1–A8) are used throughout below.

---

## State of play — 2026-08-07

**Client enhancement round v2 is mid-flight. Phases B and A are both shipped and committed
on `main`, neither pushed.** Run order is B → A → C → D → E; C, D and E have not started.

### Phase B — DONE

Commit `a0a7dc7` on `main`, **not pushed**. Two additions to the enquiry block on
`app/property/[slug]/page.tsx`:

- Phone as `tel:+639206685742`, displayed `+63 920 668 5742`, `btn btn-ghost` beside Inquire.
- The note "All inquiries for this property are handled exclusively through DaScout." in a
  new `.cta-note` rule in `app/globals.css`.

Verified: `tsc` clean, Vitest no new failures, both additions confirmed live in the browser
against a production build at 375 px and 1280 px.

**Cosmetic defect in that commit, still unfixed:** the subject line is a stray `@` with the
real subject on line 2 (PowerShell here-string syntax leaked into a Bash call). Amending is
ASK-tier under the guard hook — needs the owner's explicit OK in chat, then a single plain
`git commit --amend` so the permission prompt fires.

### Phase A — DONE 2026-08-07

Built to the settled spec below, no deviations. Three files and four new assets:

- `app/globals.css` — hero crop + scrim (A2), the whole search card inverted to dark glass
  including the fallback and the chevron (A3), `.expect` and `.ecard` on the artwork's
  measured gradients (A4), `.verify` rebuilt as image-over-button (A6).
- `components/IconSprite.tsx` — four SOLID symbols `i-check-fill`, `i-target-fill`,
  `i-key-fill`, `i-gem-fill` (A5). They carry `fill="currentColor" stroke="none"` on the
  `<symbol>` itself, the trick `i-facebook` already used, because `.icon` sets `fill:none`.
  The outline `i-gem` in the old spec was NOT added — nothing renders it.
- `components/home/Sections.tsx` — the four cards point at the filled icons and the fourth
  is a gem; the heading gained its full stop; `VerifiedBand()` is now a `<picture>` plus the
  account button, and the aerial photo and its heading are gone.
- `public/assets/buyers-sellers-{900,1400,2000}.webp` + `-2000.jpg` (A7), at exactly the
  proven sizes: 32 / 54 / 80 KB and 134 KB.

**One bug found and fixed during verification, worth remembering:** `<picture>` is an inline
flex item, so under `.verify{align-items:center}` it shrank to nothing — the band measured
0×0 and `srcset` picked the smallest file. `.verify picture{display:block;width:100%}` is
what makes a `<picture>` behave like the `<img>` it replaced.

`public/assets/verified-fields.jpg` is now unreferenced but was left on disk — a one-line
`/clean-me` job, not deleted here.

Verified: `tsc` clean, `npm run build` clean, Vitest no new failures (baseline comparison
below), and the home page checked at 375 px, 768 px and 1280 px against a production build —
no console errors, every asset 200.

**The spec it was built to — settled, do not reopen:**

| Item | Decision |
|---|---|
| A2 hero | **Option 2.** `background-size:230%`, `background-position:57% 26%`, scrim `linear-gradient(90deg, rgba(0,0,0,.96) 0%, rgba(0,0,0,.93) 42%, rgba(0,0,0,.74) 66%, rgba(0,0,0,.90) 100%)` |
| A3 search card | **Dark glass.** Smoked panel, white values, gold labels — CSS below |
| A4 band + cards | **Follow the artwork's gradient** — measured values below |
| A6/A7/A8 banner | **Flat image exactly as supplied.** Aerial photo `verified-fields.jpg` and the "We Don't Just List Properties. We Verify Them." heading both go |
| "See Verified Listings" button | **Stays** (default taken; artwork has none, owner did not object) |
| Icons | **Solid gold, as drawn** (default taken) |

**A3 — Dark glass, as sampled and contrast-checked:**

```css
.searchcard{
  background:linear-gradient(146deg,rgba(22,20,16,.62) 0%,rgba(14,13,11,.52) 100%);
  backdrop-filter:blur(40px) saturate(1.5);
  -webkit-backdrop-filter:blur(40px) saturate(1.5);
  border:1.5px solid rgba(233,206,143,.34); color:#fff;
  box-shadow:0 30px 70px rgba(0,0,0,.6), inset 0 1.5px 0 rgba(255,255,255,.22);
}
.searchcard h2{color:#fff}
.searchcard .sf{background:rgba(255,255,255,.09);border-color:rgba(255,255,255,.20)}
.searchcard .sf label{color:var(--gold-l)}   /* 12.64:1 */
.searchcard .sf select{color:#fff}           /* 19.39:1 */
.searchcard .go{background:linear-gradient(180deg,var(--gold-l),var(--gold));color:var(--on-gold)}
```

The existing `@supports not (backdrop-filter)` fallback at `globals.css:150` sets
`background:rgba(255,255,255,.95)` — **that must be inverted too** or the fallback renders
white type on a white card. Make it an opaque dark, e.g. `rgba(16,14,11,.96)`.

Also update the `.sf select` chevron data-URI at `globals.css:158`: its stroke is hardcoded
`%2352525B` (dark grey) and will be invisible on the dark chip. Use `%23E9CE8F`.

**A4 — the artwork's real colours, sampled from `Dascout.png`, not eyeballed:**

```css
/* .expect — a warm glow anchored at the LEFT EDGE, MID-HEIGHT, not flat black */
background:radial-gradient(128% 112% at 0% 50%,
  #332f22 0%, #2b2719 20%, #211e15 34%, #1b1811 52%, #17150f 100%);

/* .ecard — bright specular top rim, warm greys down, bounce light at the bottom */
background:linear-gradient(177deg,#3e3c38 0%,#2c2a26 30%,#211f1b 62%,#1a1815 84%,#272522 100%);
box-shadow:inset 0 1.5px 0 rgba(255,255,255,.26), inset 0 -1px 0 rgba(255,255,255,.07),
           0 14px 34px rgba(0,0,0,.5);
border-radius:26px;
```

Every value is **warm** (R > G > B). An earlier pass used cool blue-greys (`#33333A`,
`#232329`) and read visibly grey beside the artwork — do not revert to those.

Card contents change too: icon becomes a **gold glyph centred at the top** (no cream square,
no top-left placement), title white, body `rgba(226,226,230,.80)`. Heading gains the
artwork's full stop and reads `Here's what you can expect <em>from us.</em>` — **"expect",
not the artwork's "expects"** (owner decision D2).

**A5** — the fourth card's icon changes star → gem. Add to `components/IconSprite.tsx`:

```html
<symbol id="i-gem" viewBox="0 0 24 24"><path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20"/><path d="m12 21 4-12-2-6"/><path d="m12 21-4-12 2-6"/></symbol>
```

That is the **outline** version, matching the sprite's existing stroke language. The approved
design uses **solid** icons, so the four cards need filled glyphs — the filled set (check,
target, key, gem) is in the sample's `<defs>` under ids `f-check`/`f-target`/`f-key`/`f-gem`.
Decide whether they live in the same sprite with an `f-` prefix or as a separate set; the
sprite currently assumes stroke-only (`.icon{stroke:currentColor;fill:none}` at
`globals.css:46`), so filled symbols need their own class or inline `fill`.

**A7 — banner assets, already proven:**

`Dascout2.png` is 6.5 MB at 5063 px and must not ship as-is. Regenerate with `sharp`
(present in `web/node_modules`, no install needed):

| Output | Size |
|---|---|
| `buyers-sellers-900.webp` | 32 KB |
| `buyers-sellers-1400.webp` | 54 KB |
| `buyers-sellers-2000.webp` | 80 KB |
| `buyers-sellers-2000.jpg` (fallback, mozjpeg q78) | 134 KB |

webp quality 76, jpg quality 78 + mozjpeg. Target was "largest well under 400 KB". Ship as
`<picture>` with a `srcset`. Source stays in `C:\Users\USER\Downloads\dascout.enhancement\`.

**A8** — the banner's alt text must carry the artwork's full paragraph verbatim, because the
words only exist as pixels. The exact string is in the sample page's `<img alt="...">`, and
the source paragraph is in `components/home/Sections.tsx` → `VerifiedBand()` today.

**Known consequence the owner accepted:** the paragraph inside the flat banner is ~50 px tall
in a 5063 px image, so it scales to roughly 12 px on desktop, 8 px on tablet, 4 px on a phone.
Raised, decided, recorded — do not re-litigate it.

### Phases C, D, E — untouched

C (rich-text description) and D (price show/hide) are independent of each other. **E (clearing
the listings) runs only on the owner's explicit signal.**

---

## Two findings that are NOT Phase A's doing

### 0. Five Vitest integration FILES fail on `fetch failed` — environmental, not the code

`admin-escalation-denial`, `reorder-photos-rpc`, `property-types-apply1` and two others fail
at Supabase sign-in with `fetch failed`, and the set changes run to run. Baseline proof: with
every Phase A edit stashed, the same 5 files fail and **0 assertions** fail (417 passed). The
host itself is reachable (`/auth/v1/health` answers 401, i.e. up). Treat it as flaky network
to Supabase, not a regression — but it does mean "Vitest green" is currently unattainable and
the honest bar is "no new failures against a stashed baseline".

### 1. Admin server actions hang without ever reporting back — blocks the E2E bar

`03-listing-journey.spec.ts` cannot be run to completion. The button sits on
"Saving…"/"Working…" and the `.fmsg.ok` confirmation never arrives, even at a 45 s assertion
timeout. Hit on `saveListingFeatures` (AC-13a) and `transitionListing` (AC-24a).

Evidence it is pre-existing: a baseline run of the same spec on `12b415d` with the Phase B
edits stashed fails at the identical test. Evidence it is not the database: the zz- listing
left behind by a failed run had all 3 features **saved**, so the write completes server-side
and only the response never reaches the client; Supabase auth was returning 200s at ~2 ms
with 1 active connection throughout.

Route to `/fix-me` — diagnosis first, not a patch.

### 2. The hero search-card labels already failed WCAG AA — CLOSED by Phase A

`.searchcard .sf label` is `--ink-3` `#7A7A83` on an 80 %-white card over the scrimmed hero,
composited to `#CECECE` — **2.70:1** against a 4.5:1 floor for text that size. Pre-existing,
and fixed as a side effect of the Dark glass rebuild: the labels are now `--gold-l` on the
smoked panel at 12.64:1 and the values are white at 19.39:1. Nothing further to do.

---

## Session quirks worth knowing

- **Browser-pane screenshots fail intermittently** — "the Browser pane is not displayed, so
  the page is not compositing frames". Verify by computed style and `getBoundingClientRect`
  via `javascript_tool` when that happens; it is reliable when screenshots are not.
- **`resize_window` sometimes does not take** on a preview tab — `innerWidth` stays put.
  Check `innerWidth` after resizing rather than trusting the tool's success message.
- **Serving a scratch HTML file from `web/public/` applies DaScout's own nonce CSP**, which
  blocks inline `<script>`. Fine for checking layout; misleading if the page needs script.
- **The Bash tool is bash, not PowerShell** — `-m @'…'@` here-string syntax leaks a literal
  `@`. Use a heredoc into a file and `git commit -F`.
- Test residue: 7 zz- listings from this round's runs were swept via the Supabase MCP, scoped
  by the `zz-` prefix. 13 live listings remain, all real.

## Standing rules that bit this round

- Commits go straight to `main`. **Never push without asking.**
- The E2E suite writes to the live database — prefer targeted specs.
- Playwright needs `npm run build` first and takes port 3000; stop any dev preview.
- `npm`/`npx` run from `dascout/web`; `git` runs from `dascout`.
