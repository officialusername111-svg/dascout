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

Run `do-me-2026-08-08-band-c`, pre-run HEAD `6a7e2d8`. Three commits, none pushed:

| Commit | What |
|---|---|
| `3411ff4` | Buyers & Sellers band, arrangement A — **complete** |
| `fa6186d` | Phase C sanitiser + 36-test hostile-input suite — **complete** |
| `4df8d86` | Phase C editor + styles — **built, deliberately not wired** |

### The three "waiting on you" items from the last run

1. **TEST_BUYER production auth write — already done.** It was applied on 2026-08-07 and the
   marker file was simply stale. Confirmed rather than assumed: Vitest is green, and the five
   files that failed were exactly the five that call `buyerClient()`.
2. **Phases C and D — started.** See below.
3. **Push — already done.** The seven docs commits went to `origin/main` on 2026-08-08
   (`e4105aa` → `6a7e2d8`). The marker's "4 commits unpushed" was stale too.

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

### Task 2 — Phase C. Half built, and BLOCKED on the migration.

**The blocker: `alter table listings add column description_html` was never applied.** The
Supabase MCP call was refused by the permission classifier before it could reach the owner,
so it is not a "no" — it has not been asked yet. Everything else in Phase C waits on it.

**What is done and proven (C3, C4):** `lib/listing-description.ts` is the server-side
sanitiser, with 36 tests. It allows `p br strong em u ul ol li h4 span`, no anchors and no
images, and a `style` attribute carrying only `color`, `font-family` and `text-align` —
each validated against a closed rule, anything else **dropped rather than repaired**, which
is what the owner's free-colour-codes decision forces.

**What is built but NOT wired (C2, C6):** `components/admin/DescriptionEditor.tsx`, the
Tiptap editor and toolbar from the approved sample, plus its styles and the `.desc` rules
the public page will need. Nothing imports it.

**Why it is not wired, and do not "finish" it before the migration:** every remaining step
needs the column. Wiring the form or the public page first would take the admin screen and
every listing page down — the same ordering mistake as the 2026-08-02 outage.

**Three bugs the verification found, all fixed, worth knowing because two are invisible:**

- **`span` was missing from the tag allowlist.** Colour and typeface arrive as
  `<span style="...">`, not as attributes on the paragraph, so every colour and every face
  would have been silently dropped on save — no error, editor looks right, listing comes
  back plain. The hostile-input tests could never have caught it: it was the filter being
  too *strict*. Only a round trip of real editor output finds this class of bug, and that
  round trip is now a permanent test.
- **Slicing the input did not bound the output.** The parser writes back the closing tags
  the slice broke, so a cut at the limit came back over it. It re-runs with headroom now.
- **Stripping markup ESCAPES the text it keeps**, so the derived plain text carried
  `&amp;` — and that string goes into the page's `<meta name="description">`. Entities are
  decoded in a single pass, because decoding `&lt;` and `&amp;` separately turns a literal
  `&amp;lt;` into a `<` nobody typed.

**To finish Phase C, in this order:**

1. Apply the migration in `docs/BACKLOG.md ## Now` (the full SQL is recorded there,
   grants included).
2. Add `description_html` to the two column lists in `lib/queries.ts` and
   `lib/admin/queries.ts`.
3. In `app/admin/actions.ts`, take `description_html` from the form, run it through
   `sanitizeDescriptionHtml`, and derive `description` from it with `htmlToPlainText` —
   one editor, two stored columns, so they cannot drift.
4. Swap the `<textarea>` in `components/admin/ListingForm.tsx` for `<DescriptionEditor>`.
5. Render `description_html` at `app/property/[slug]/page.tsx:92-97` via
   `dangerouslySetInnerHTML`. It is safe there **only** because step 3 sanitised it on the
   way in; never render an unsanitised value.
6. Update `tests/e2e/02-create-validation.spec.ts:211,229` — it fills `#lf-desc` and asserts
   `toHaveValue`, which does not work against a contenteditable. The field's nature changed,
   so the spec has to change with it.

### Phase D — sample presented, and the owner settled the open question.

https://claude.ai/code/artifact/6e1e8f65-6b00-4c51-a45f-2f475222796d

**Decided 2026-08-08: a hidden price shows NOTHING.** No "price on request", no placeholder
line — the price is simply absent and the layout closes up. This was raised as a concern
(a card with no price gives a buyer nothing to ask about, so the question arrives through
Inquire instead) and the owner's call stands. D4 no longer needs a wording decision.

No Phase D code exists. Both its migrations are still unapplied.

---

## Verification that ran

- `tsc --noEmit` clean.
- `npm run build` clean.
- **Vitest: 26 files, 489 tests, all passing** (was 25/453; the 36 new sanitiser tests).
- Band measured in a browser against a production build at 375 / 768 / 1385 px.
- Editor mounted and driven in a browser against a production build, on a temporary route
  that was deleted afterwards.

**`03-listing-journey.spec.ts` did NOT run.** Another session holds port 3000 and
`playwright.config.ts` sets `reuseExistingServer: false`, so Playwright cannot start its
own server. Nothing in this run touches the admin journey — no server action, no query, no
loading boundary — but the E2E half of the standing bar is unproven and should be run once
port 3000 is free.

No test was deleted, skipped or weakened. No `zz-` rows were created, so there is nothing
to sweep.

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
