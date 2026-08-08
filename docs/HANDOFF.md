# HANDOFF — DaScout (single overwritten file)

> This file replaces the date-stamped handoff chain (DISPATCH.md §0 "The standing queue").
> It is OVERWRITTEN each handoff; git history keeps prior versions. Paths are repo-relative;
> prefix with `dascout/` from the workspace root (rule in `D:\Workspace\DaScout\CLAUDE.md`).

## Read first

1. `docs/BACKLOG.md` — the queue: Now / Next / Parked / Decided / Standing.
2. This file — only what changed since the last handoff, plus session quirks.
3. `docs/PLAN-enhancement-v2.md` — the nine client items and the five phases.

---

## State of play — 2026-08-08

Three runs, all closed. `do-me-2026-08-08-band-c` (pre-run HEAD `6a7e2d8`) built the band
and the Phase C parts needing no database change; `do-me-2026-08-08-phasec-wire` (pre-run
HEAD `4bed3ec`) applied the Phase C migration and connected them; `do-me-2026-08-08-phased`
(pre-run HEAD `a0f4413`) built Phase D.

**The enhancement round is now B, A, C and D done. Only E is left, and E runs only on the
owner's explicit signal.**

| Commit | What |
|---|---|
| `3411ff4` | Buyers & Sellers band, arrangement A — **complete** |
| `fa6186d` | Phase C sanitiser + 36-test hostile-input suite |
| `4df8d86` | Phase C editor + styles |
| `d3f3f40` | Phase C wired: migration applied, form and public page switched over |
| `a0f4413` | Phase C sweep fix: markup with no words is not a description |
| `a0b6b74` | Phase D: the price show/hide switch, and D5's rule correction |

### The three "waiting on you" items from the last run

All three are now closed.

1. **TEST_BUYER production auth write — already done.** It was applied on 2026-08-07 and the
   marker file was simply stale. Confirmed rather than assumed: Vitest is green, and the five
   files that failed were exactly the five that call `buyerClient()`.
2. **Phases C and D — C is finished; D has an approved sample and no code yet.** See below.
3. **Push — done.** The seven docs commits had already gone up on 2026-08-08
   (`e4105aa` → `6a7e2d8`); this session's six followed at the owner's OK.
4. **`03-listing-journey.spec.ts` — ran, 19/19.** Port 3000 was held by another process
   during the first run and is free again.

### Task 1 — the band. Done.

Built to the approved arrangement-A sample. Two pictures and live text replace the flat
5063 px artwork; the paragraph that used to render at ~4 px on a phone is now real text and
the 462-character `alt` string is gone. 36 KB of new assets retire 307 KB of
`buyers-sellers-*` plus the long-unreferenced `verified-fields.jpg`.

Measured against a production build: pin ratio **0.6956** at 375 / 768 / 1385 px,
pin-to-text **1.686** desktop and **1.548** phone (the sample measured 1.69 and 1.55),
Montserrat measurably rendering (266 px against a 245 px fallback), no page-level
horizontal scroll.

**Two traps this cost time on, both now commented in the code:**

- **Class names.** The sample used bare `.band`, `.grid`, `.copy`, `.glass`. This
  stylesheet already owns `.grid` (listing cards) and `.copy` (footer bottom bar).
  Everything is prefixed `pwbs-`. This is the second CSS-naming trap in two sessions — the
  first was the case-sensitivity collision. Check `globals.css` before naming anything.
- **`-webkit-backdrop-filter` must be written BEFORE the unprefixed property.** Written the
  other way round, the build's CSS minifier drops the unprefixed one and only `-webkit-`
  ships, which Chromium does not honour — the glass card had no blur at all. The source
  looked correct; only reading the built chunk showed it. `.searchcard` has always had the
  right order, which is why it never showed the bug.

**One open cosmetic point, not a defect.** Between roughly 748 px and 890 px of viewport the
band splits into two columns while the left one is still narrow, so the kicker
"Partnering You with the Best" wraps to two lines and the pin-to-text ratio drops to 1.44.
This is the approved CSS behaving exactly as written — the sample's tablet frame was a
768 px *container*, but the real page at a 768 px *viewport* gives a 705 px container
because of the page gutters. The one-number fix, if wanted: raise the two-column
`@container` threshold in `.pwbs-band`'s block from `700px` to `890px`, which is where the
lockup first has room. Not applied, because the instruction was to build the sample exactly.

### Phase C — DONE, wired, and verified end to end.

Run `do-me-2026-08-08-phasec-wire`, pre-run HEAD `4bed3ec`, commit `d3f3f40`. The migration
that blocked this yesterday was applied at the owner's OK.

**Migration `add_listings_description_html`.** Column added, 13/13 existing descriptions
backfilled as ordinary paragraphs, and `grant select (description_html)` to `anon` and
`authenticated` landed WITH the column — `listings` is column-granted, not table-granted,
so a new column is invisible to anon until it is named. The backfill was dry-run as a
SELECT against the real rows before it was applied.

**One field posts, two columns are written.** `listingFieldsFrom` in `app/admin/actions.ts`
is the only door a description comes through, which is why the sanitiser runs there. The
plain `description` is DERIVED from the sanitised html rather than posted beside it, so the
two cannot drift and the plain one can never carry markup — the guarantee the SEO meta path
depends on. **Nothing may post a plain `description` again.**

**The trap the last handoff predicted was real and is closed.** The old shape read
`formData.get('description')`, and `blankToNull` turns a missing field into null. Had the
form stopped sending it without the shape changing in the same edit, the first save on any
listing would have written null over its description with no error at all.

**The public page renders `description_html` through `dangerouslySetInnerHTML`.** That is
safe there and only there, because the value cannot arrive unsanitised: it is filtered on
the way IN, and the backfill escaped the plain text it came from. A listing with no html
falls back to its plain text rather than showing a gap. **Never render a description that
has not been through `sanitizeDescriptionHtml`, and never widen that allowlist to make this
page look better.**

**Still open, one question:** should the editor offer links? Built without them. Adding them
means adding `a` to the sanitiser WITH an href scheme allowlist, never just to the tag list.

### Phase D — DONE. Staff can show or hide each listing's price.

Run `do-me-2026-08-08-phased`, pre-run HEAD `a0f4413`, commit `a0b6b74`. Sample:
https://claude.ai/code/artifact/6e1e8f65-6b00-4c51-a45f-2f475222796d

Off for every existing listing, so nothing became visible because this shipped. A hidden
price shows **no line at all** — no "price on request", no placeholder (the owner's call,
2026-08-08); the layout closes up as if the field had never been filled in.

**The per-row rule is a generated COLUMN, not a view. Do not "correct" this back.** The
plan's D2 said to create `listings_public` and grant it to `anon`. That is the obvious
shape and the wrong one: a Postgres view runs with its OWNER's rights unless declared
`security_invoker`, so it would bypass row-level security on `listings` entirely — the
public side would stop being governed by the policies protecting it, and the view would
have to re-implement the `status='live'` filter in a second place forever. Declaring it
`security_invoker` only moves the problem, because `anon` would then need SELECT on
`price_php`, which is exactly the grant the 2026-08-02 detach removed.

`price_public_php` is a stored generated column, `case when price_public then price_php
end`. The database evaluates the per-row decision on write; RLS keeps applying unchanged;
and it is granted per column the same way every other public field on this table already
is. `price_php` stays ungranted to `anon` and is selected by no public query. **Nothing
writes the generated column** — it follows the switch on its own, so there is no second
place for the two to disagree.

**D5 shipped in the same change**, as the plan required. The standing "no peso amounts
anywhere public" rule is retired in `docs/BACKLOG.md` and in
`D:\Workspace\DaScout\CLAUDE.md` — note that CLAUDE.md lives ABOVE the repository root,
so it is **not** in the commit and will not travel with a clone. The map half stands.

The listing page's meta description still carries no amount, deliberately: link previews
are cached and reshared far beyond the page, so a price switched on in March would keep
circulating after it was switched off again.

---

## Verification that ran

- `tsc --noEmit` clean · `npm run build` clean · **Vitest 26 files / 489 tests**.
- **`03-listing-journey.spec.ts` 19/19** and **`02-create-validation.spec.ts` 14/14**
  against a production build.
- Two throwaway specs, both since deleted, each proving a link nothing else covered:
  - **Phase C** — bold, gold and centre applied with the real toolbar buttons, saved
    through the real form, arriving as `<strong>`, `color:#8F6E28` and
    `text-align:center`, with the plain column derived clean and the formatting restored
    into the editor on reload.
  - **Phase D** — the whole chain on a real listing: off by default with no `.prop-price`
    element; an anonymous reader REFUSED when asking for `price_php`; staff switching it
    on through the real form; the generated column following with no code writing it; the
    amount then appearing publicly; and `price_php` still refused anonymously afterwards,
    which is what proves the amount arrived by the derived column rather than by a widened
    grant. It withdrew and deleted its own row.
- The public page of a real backfilled listing renders four paragraphs and seven line
  breaks where it used to render one run-on block; its meta description carries no markup
  and no amount.

**Test residue: none.** 0 `zz-` rows, confirmed through the Supabase MCP, and no real
listing has `price_public` on.

## Session quirks worth knowing

- **Browser-pane screenshots failed all session** ("not compositing frames"). Everything
  visual was verified by `getBoundingClientRect` and computed style instead, per the
  standing workaround. Assume this and plan to measure rather than look.
- **Container-query units do not re-resolve within one script tick.** A width sweep that
  sets `element.style.width` and measures in the same tick returns the same numbers for
  every width and looks like a broken layout. Resize the viewport and reload instead.
- **A viewport resize needs a page reload before container queries are right.** The first
  measurement after `resize_window` reported the phone layout at a desktop width.
- `.claude/launch.json` gained a `dascout-web-prod-alt` entry with `autoPort: true`, so a
  preview can start while another session holds 3000. Playwright still needs 3000 itself.
- The three `npm audit` highs are pre-existing devDependency transitives (eslint's
  `brace-expansion` and `js-yaml`, postcss's `nanoid`). None ships in the bundle and none
  arrived with the new dependencies.

## Standing rules that bit this round

- Commits go straight to `main`. **Never push without asking.** Three commits are unpushed.
- Migrations apply through the Supabase MCP at the owner's OK, or not at all.
- A grant that widens lands BEFORE the code that reads it — which is why the Phase C
  migration includes its own `grant select (description_html) ... to anon`.
- `npm`/`npx` run from `dascout/web`; `git` runs from `dascout`.
