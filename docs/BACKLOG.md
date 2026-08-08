# BACKLOG

> Canonical pending state (DISPATCH.md §0 "The standing queue"). Paths are repo-relative;
> prefix with `dascout/` from the workspace root. Entries are candidates — re-derive each
> from the repo at run start. Single writer: the orchestrating session only.
> Seeded 2026-08-06 from HANDOFF-2026-08-04-evening.md (the last date-stamped handoff).

## Now

- **Run `do-me-2026-08-08-band-c`, pre-run HEAD `6a7e2d8`. Surface lock: released.**
  Three commits: `3411ff4` band · `fa6186d` Phase C sanitiser ·
  `4df8d86` Phase C editor. Detail in docs/HANDOFF.md.
  - **Buyers & Sellers band, arrangement A — DONE.** Built to the approved sample. Pin
    holds 0.6956 at 375/768/1385; pin-to-text 1.686 desktop, 1.548 phone. Two traps now
    commented in the code: every class is prefixed `pwbs-` because `.grid` and `.copy` were
    already taken, and `-webkit-backdrop-filter` MUST precede the unprefixed property or the
    minifier drops the unprefixed one and the glass loses its blur.
    - Cosmetic, open, NOT a defect: between ~748 and ~890 px viewport the kicker wraps to
      two lines (the real page's container is 705 px at a 768 px viewport, where the
      sample's tablet frame was 768 px). One-number fix if wanted: raise the two-column
      `@container` threshold from `700px` to `890px`. Left exactly as approved.
  - **Phase C sanitiser (`fa6186d`) and editor (`4df8d86`)** — both SUPERSEDED by the
    "Phase C — DONE AND WIRED" entry below, which connected them. `DescriptionEditor.tsx`
    is referenced now, so the earlier "do not let /clean-me sweep it" warning is retired.
    `components/LoadingMark.tsx` is still unreferenced on purpose and still must not be swept.
  - **Phase D — sample presented**, https://claude.ai/code/artifact/6e1e8f65-6b00-4c51-a45f-2f475222796d
    No code. Both migrations unapplied.

- **Phase C — DONE AND WIRED, run `do-me-2026-08-08-phasec-wire`, pre-run HEAD `4bed3ec`.**
  Commit `d3f3f40`. Migration `add_listings_description_html` applied 2026-08-08: column
  added, 13/13 descriptions backfilled as paragraphs, `grant select (description_html)` to
  `anon` and `authenticated` landed WITH the column, before any code read it.
  - One field posts (`description_html`), two columns are written. `listingFieldsFrom` in
    `app/admin/actions.ts` is the only door a description comes through and is where the
    sanitiser runs; plain `description` is DERIVED from the sanitised html, so it cannot
    drift and cannot contain markup. **Nothing may post a plain `description` again.**
  - The public page uses `dangerouslySetInnerHTML`. Safe there ONLY because the value is
    sanitised on the way IN. Never render a description that has not been through
    `sanitizeDescriptionHtml`, and never widen its allowlist to make the page look better.
  - Verified: journey spec **19/19**, create/validation **14/14**, Vitest **26 files /
    489 tests**, plus a throwaway spec (since deleted) that proved bold + gold + centre
    survive a real save into the real column and come back into the editor. 0 zz- rows left.
  - `02-create-validation.spec.ts` changed because the field changed: the description is a
    contenteditable, so it is typed rather than filled and asserted with `toContainText`.
  - **Remaining Phase C question, still open:** should the editor offer links? Built
    without them. Adding them means adding `a` to the sanitiser WITH an href scheme
    allowlist, never just to the tag list.

- **Enhancement round v2 — B, A and C DONE. D sampled and awaiting build. E not started.**
  Run `do-me-2026-08-06-enhv2`, pre-run HEAD `12b415d`. Surface lock: released.
  - **Phase B** — commit `a0a7dc7`. Exclusivity note + `tel:` phone on
    `app/property/[slug]/page.tsx`, `.cta-note` in `globals.css`.
  - **Phase A** — commit `a0516c3`, 2026-08-07. Built exactly to the settled spec: hero at
    `230%` / `57% 26%` with the 96%→90% scrim; the search card inverted to Dark glass
    (fallback and chevron inverted with it, which closed the 2.70:1 label contrast defect);
    `.expect` and `.ecard` on the artwork's measured warm gradients; four SOLID sprite icons
    with a gem replacing the star; `VerifiedBand()` now the supplied banner as a flat
    `<picture>` with the account button beneath. Detail in docs/HANDOFF.md.
  - **Both are pushed** (`main` fast-forwarded `12b415d` → `5cd2e58`) and live on
    dascoutprime.com. The "NOT pushed" wording that stood here until 2026-08-07 was stale.
  - Phases C, D, E untouched. **E runs only on the owner's explicit signal.**

- **Blocker sweep — run `do-me-2026-08-07-blockers`, pre-run HEAD `5cd2e58`.** Surface lock:
  `app/loading.tsx`, `app/admin/(staff)/loading.tsx`, `app/admin/(staff)/listings/[id]/page.tsx`,
  `tests/e2e/11-account-password.spec.ts`. Items 1 and 2 of the owner's 1–4 list; items 3 and 4
  (Phases C and D) were NOT started — see `## Next`. **Run closed `done-parked`; commits
  `61556ca` `522ae3d` `ecbc0ab` `e4105aa` pushed to `origin/main` at the owner's OK.**

- **Buyers & Sellers band REDESIGN — 3 arrangements presented 2026-08-07, awaiting the owner's
  pick. No code written. SUPERSEDES the layered rebuild below.** New source:
  `C:\Users\USER\Downloads\new_asset\` — `PwBS_2.png` (2136×805, background+silk ALREADY
  composited, alpha) and `icon-removebg.png` (313×450 gold pin, **fully transparent — including the inner ring hole**, replaced by the owner at 16:49; verified alpha 0 at the hole and 255 on the body, before and after WebP).
  Sample: https://claude.ai/code/artifact/3106391e-0206-4c09-abb4-779d1d0563c4
  - These assets change the approach: no `mix-blend-mode: screen` compositing needed, the pin
    is a placeable element, and the wordmark is NOT supplied — so kicker, wordmark and
    paragraph all become live text. One image + one pin, everything else HTML.
  - Three arrangements offered: **A** split billboard (faithful to the artwork), **B** statement
    → 3 proof chips → body (**recommended**), **C** conversion strip with the paragraph behind
    a disclosure. Primary task of the band = get an unregistered visitor to press
    "Get started today"; B serves it without losing a word.
  - Old→new map is in the sample; nothing from the current band is dropped, and the
    462-character `alt` string disappears because the words stop being pixels.
  - Weight: backdrop 29 KB + pin 7 KB = **36 KB**, retiring 307 KB of `buyers-sellers-*`.
  - **Settled, found in code not asked:** `app/layout.tsx:18-19` records that the artwork's
    display face has no licensed files in the repo and **Montserrat Bold is the stand-in the
    owner already approved in the mockup**. The wordmark uses it. Do not re-ask.
  - **Montserrat ships at weights 600 and 700 ONLY** (`layout.tsx:23`). A first pass set the
    wordmark at 800 and the browser silently faked it — corrected to 700. Anything setting
    `--font-head` above 700 is synthesising.
  - Verified at 375 / 768 / 1385 px: no page-level horizontal scroll, both assets resolve in
    all five band instances, wordmark scales 26 → 47.6 → 52 px, and Montserrat is **measurably
    rendering** (244 px vs 208 px for the fallback) — the earlier sample was silently showing
    Segoe UI, which `document.fonts.check` reports as a pass and only a width probe catches.
  - **Lockup proportions matched to the artwork 2026-08-07**: the pin is ~1.73x the height
    of the whole text block there, so the lockup now derives pin height, kicker size and gap
    from one `--wm` variable. Measured after: 1.69 desktop and tablet, 1.55 on the phone
    (the wordmark's clamp floor), pin taller than the text at every width.
  - **CSS trap found and fixed — do not reintroduce:** the arrangements were `.A/.B/.C` and
    the wordmark's lines `.a/.b`, differing only by CASE. Class selectors are
    case-INSENSITIVE in a document with no doctype, so `.A{padding:56px}` applied to
    `<span class="a">` and inflated its line box to 163px. It presented as a text-wrapping
    bug and was not one — a Range `getClientRects()` showed a single line box with 56px
    padding top and bottom. Renamed `.arrA/.arrB/.arrC` and `.wm-gold/.wm-white`.
    Never distinguish class names by case alone; and a fragment served without a doctype
    does not parse like the same markup inside a real page.
  - **ARRANGEMENT A CHOSEN by the owner 2026-08-07.** Final sample, built in full and with the
    pin proven non-deforming: https://claude.ai/code/artifact/83903f57-f665-43a0-b95f-13f72b4dabe6
    The pin ships as an `<img width=313 height=450>` with only `height` set in CSS, plus
    `object-fit:contain` and `flex:none` — three independent guards, none needing anyone to
    remember the ratio. Measured 0.6956 at 375 / 768 / desktop and at forced heights of 16 px
    and 900 px. B and C are not being built.
  - **Next-session prompt written to `docs/NEXT-SESSION.md`** — paste it into a fresh session.
  - THREE open points: (1) B moves the "title-checked / boundary-walked / confirmed on the
    ground" clause onto its own line — no words added or removed, but the sentence order
    changes; (2) "Dascout" → "DaScout"; (3) the CTA sits inside the band.

- ~~Buyers & Sellers band rebuild from the 3-layer folder~~ — SUPERSEDED by the entry above,
  kept for the measurements. Source: `C:\Users\USER\Downloads\Partnering with Buyers and Sellers\` — the three
  LAYERS of the banner that shipped flat this morning (`_Background.png` faceted panel,
  `_2.png` silk drape, `_1.png` gold pin + wordmark lockup), all 5063×1906, plus `Words.txt`
  carrying the paragraph as text. Confirmed by inspection that `Dascout2.png` is these three
  composited with the paragraph set as type.
  Sample: https://claude.ai/code/artifact/b43490e8-5e92-4b7c-80ae-2cba642c94ab
  - **What it fixes:** the "known consequence the owner accepted" on A8 — the paragraph is
    ~50 px in a 5063 px image, so ~12 px desktop / 8 px tablet / **4 px on a phone**, and it
    exists only as pixels plus a 462-character `alt` string. Rebuilt it is real text.
  - **It is also lighter:** three layers at 2000px = 25 + 12 + 20 = **57 KB** against the
    current flat **82 KB**, and retires 307 KB of `buyers-sellers-*` assets. A texture, a
    shape and a wordmark each compress better than one image containing small type.
  - Approach: background as `background-image` cover, silk and lockup as `mix-blend-mode:
    screen` layers (the PNGs have NO alpha — 3 channels, black matte, so screen is what drops
    the black), paragraph in a card reusing Phase A's dark-glass recipe verbatim.
  - Verified in-browser at 375 / 768 / 1385 px: no page-level horizontal scroll, all three
    layers resolve, two-column split fires at ≥700 px. **Screenshots unavailable this session**
    (the Browser-pane compositing quirk) — verification was by `getBoundingClientRect` and
    computed style, per the standing workaround.
  - THREE open points for the owner: (1) "Dascout" → "DaScout" in live text, matching the rest
    of the site — the artwork and `Words.txt` both write it "Dascout"; (2) the comma splice
    and double space in "trust alone,  it should run on proof" set as an em dash; (3) the
    "Get started today" button moved INSIDE the band rather than below it.
  - No database change, no dependency, no server work. Same two files Phase A touched.

- **Phase C — SAMPLE PRESENTED 2026-08-07, awaiting approval. No code written.** The owner
  picked C as the next phase. The sample is a working mock (type in it, the buyer view
  updates live): https://claude.ai/code/artifact/12d5691d-bd7d-491b-8602-bcbfdc9c66c2
  **Revision 2, 2026-08-07** — the owner overruled two of the three open points. Both risks
  were stated once and the owner's call stands; do not re-litigate:
  - DECIDED: **typeface picker is IN.** Four faces only — Figtree (already loaded),
    Montserrat (already loaded as `--font-head`), Georgia and a monospace stack (both
    system fonts, no download). A fifth face means shipping a font file on every listing
    view and is a separate decision.
  - DECIDED: **free colour codes are IN**, hex or `rgb()`, alongside the five swatches. The
    control computes contrast against white live and warns below 4.5:1 — it warns, it never
    blocks. **Consequence for C3:** the sanitiser can no longer allowlist five literal
    colours. It must allow `style` carrying ONLY `color` (a parsed, valid colour),
    `font-family` (one of the four) and `text-align`, and drop every other declaration
    rather than try to repair it.
  - Found while building the control: the proposed gold swatch `#B8923E` measures **2.91:1**
    on white and fails the body-text floor. Swapped to `#8F6E28` (**4.74:1**), same hue.
    `#B8923E` stays correct for headings and buttons, not for paragraphs.
  - OPEN: no links and no images (images are already blocked by `img-src` in `proxy.ts:57`).
    **Built without links**, per the recommendation — adding them later means adding `a` to
    the sanitiser WITH an href scheme allowlist, never just to the tag list.
  - SETTLED: the 12 existing descriptions carry over as plain paragraphs, no retyping.
  - SETTLED: plain `description` stays beside `description_html`, because
    `lib/match-alerts.ts:120` and the SEO meta path must never receive markup.
  Nothing may be built until the owner approves — standing sample-before-build rule.

## Next

- [user-intake] Client enhancement round v2 (2026-08-06) — 9 items from
  `C:\Users\USER\Downloads\dascout.enhancement\`. Plan, task list and requirements in
  docs/PLAN-enhancement-v2.md. All five owner decisions ANSWERED 2026-08-06; nothing
  blocked. Five phases, run order B → A → C → D → E:
  B contact block (items 7,8, ships first) · A home visuals (1,2,3,4, sample first) ·
  C rich-text description (6) · D price show/hide (5) · E clear listings (9, on signal).
  **B and A are done, pushed and live. C, D and E are not started.** NOTE: phase D reverses
  the "no peso anywhere public" standing rule — task D5 corrects CLAUDE.md and this file's
  Standing section in the same change.
  **Why C and D did not start in `do-me-2026-08-07-blockers`, though the owner asked for
  items 1–4:** both are gated twice over and neither gate could be cleared inside a
  fire-and-forget run. (1) Each needs a production migration applied through the Supabase
  MCP at the owner's OK — C1 `description_html`, D1 `price_public`, D2 the `listings_public`
  view + grant, and D2's grant must land BEFORE the code that reads it. (2) Each adds an
  admin control — C's editor toolbar, D's show/hide plus the hidden-state label — and the
  standing global rule is sample-before-build, which outranks autonomy. Restarting either
  means: build the sample, get it approved, apply the migration, then build. Item 1's fix
  was the right thing to spend this run on regardless: until it landed, neither C nor D
  could have been verified, because `03-listing-journey.spec.ts` could not finish.
- [agent-derived, 2026-08-07] **Piece 6's loading indicator is reverted — the freeze is back.**
  The fix above deleted `app/loading.tsx` and `app/admin/(staff)/loading.tsx`, so navigation is
  once again blocking (~450–670 ms public, ~2 s on the admin listing detail page) with no
  indicator. That is the deliberate trade: a slow navigation beats a publish button that lies.
  `components/LoadingMark.tsx` is kept on disk and is now UNREFERENCED — it is the redesign's
  starting material, not junk; do not let `/clean-me` sweep it.
  Doing it properly = split the admin listing detail fetch so `ListingActionBar` renders from
  one fast query and the heavy panels stream behind their own `<Suspense>` boundaries placed
  BELOW it, never above. Medium, UI-adjacent, sample not needed (same mark, same copy).
  **Any future loading work must re-run `03-listing-journey.spec.ts` — a boundary in the wrong
  place passes tsc and the build, and only that spec catches it.**
- [user-intake] Piece 4 — approval-workflow refinement (BRIEF-listing-encoding-v2.md). Not started.
- [user-intake] Piece 5 — photos section redesign with icons. Brief says SAMPLE FIRST.
- [user-intake] Piece 6 — custom loading indicator. Brief says DIAGNOSE the freeze before styling.
- [user-intake] Piece 7 — remove the request-property function. Deliberately deferred;
  `property_requests.category` still blocks retiring `listing_category`.
- [agent-derived] Full-suite E2E account-spec interference — TEST_BUYER password not restored
  across specs 07/09/10/11/15 (HANDOFF-2026-08-04-evening.md §3; task chip task_3f5515f1).
  Needs the human's flip to `approved` before an autonomous run picks it up.
- [agent-derived, 2026-08-07] **Vitest: 5 integration files fail — RE-DIAGNOSED, one action
  left, and it needs the owner.** The old entry called this "`fetch failed`, environmental,
  the set changes between runs". That is wrong as of 2026-08-07: the error is
  `Buyer sign-in failed: Invalid login credentials`, it is deterministic, and it is exactly
  the five files that call `buyerClient()`. Measured 3/3 failures for the buyer and 3/3
  successes for the staff fixture against `/auth/v1/token`. `TEST_BUYER`'s real password in
  Supabase auth no longer matches `.env.local` — this is `task_3f5515f1`, now proven.
  - Why it cannot be recovered from the repo: `11-account-password.spec.ts` rotated the
    fixture to `Zz-Bt-Temp-${Date.now()}` and the run died before its `afterAll` restore, so
    the live password is a timestamp only that dead process ever knew.
  - **Recurrence is now fixed** — that temp value is a constant (`Zz-Bt-Temp-Fixture-Rotation`),
    so any later run's restore loop can always sign in and put the original back.
  - **DONE 2026-08-07** — the owner approved the write; it was applied through the Supabase
    MCP, scoped to that one email. **Vitest is now 25/25 files, 453/453 tests, fully green
    for the first time since 2026-08-04.** The statement that was run, kept for the record:
    `update auth.users set encrypted_password = crypt('<the .env.local value>', gen_salt('bf'))
    where email = 'test-buyer-p4@dascout.local'`, applied through the Supabase MCP. Nothing
    else unblocks those five files: the account is a `.local` address with no mailbox, so
    password recovery cannot reach it, and there is no service-role key by policy.
  - The "no new failures against a stashed baseline" bar is retired with it. The standing bar
    is once again **Vitest green + `03-listing-journey.spec.ts` green**, both reachable.
- [agent-derived, 2026-08-07] `web/public/assets/verified-fields.jpg` is now unreferenced
  (Phase A retired the aerial photo). Left on disk deliberately; a `/clean-me` job.
- [agent-derived, 2026-08-06] ~~**Admin server actions hang without ever reporting back.**~~
  **FIXED 2026-08-07** in run `do-me-2026-08-07-blockers`. Root cause: piece 6's Suspense
  boundaries. Any boundary above `ListingActionBar`/`ListingForm` — the client components
  holding `useActionState` — makes Next 16 keep TWO copies of the admin page after a server
  action's `revalidatePath` re-render; the stale copy never leaves `pending === true`, so the
  button sits on "Working…"/"Saving…" while the write has already succeeded. Evidence chain:
  server-side `console.log` probes showed `transitionListing` returning in <1 ms after the DB
  flip and `after()` finishing 808 ms later, while the client sat 10 s; then a strict-mode
  violation caught the duplication directly (`#lf-title` resolved to 2 inputs).
  Measured on `03-listing-journey.spec.ts`: group `loading.tsx` present 11/19 · in-page
  `<Suspense>` instead 5/19 · root `app/loading.tsx` only 13/19 · **no boundary 19/19, twice.**
  Fix = delete both `loading.tsx` files. See the new `## Next` item for what that costs.
- [user-intake, recurring] V3 full-battery verification per docs/E2E-V3-RUNBOOK.md — on
  request, before any release, after any schema/grant change, or when a week has passed
  without one. Runs in-session (sweep needs the Supabase MCP); never as an OS job.

## Parked

- `cleanup_backup` schema still in Supabase — blocked on: owner satisfaction; then
  `drop schema cleanup_backup cascade;` via MCP. Since 2026-08-02.
- Bulk actions from the admin mockup — blocked on: owner's explicit call (new capability on a
  verification gate). Unbuilt on purpose. Since 2026-08-02.
- Migration ledger drift (filename timestamps ≠ applied versions) — noted, low risk; harmless
  via API, would confuse `db push`/`db reset`. docs/MIGRATION-LEDGER-DRIFT.md. Since 2026-07-31.

## Decided — do not reopen

- 2026-08-02 — price_php readable by any REGISTERED account is ACCEPTED; closing it properly
  means a staff-only price table, deferred until the client wants it. Not a security finding.
- 2026-08-02 — property number: public, shown before the name, NOT required to publish, own
  column (no prefix) on the admin index.
- 2026-08-03 — test-data cleanup is NEVER automated: no service-role key, no purge function,
  no separate project/branch. Sweep zz- rows through the Supabase MCP only; scope by zz-
  prefix, never by status alone.
- 2026-08-08 — Phase D: a HIDDEN price shows **nothing at all**. No "price on request", no
  placeholder line — the price is absent and the layout closes up. The concern was raised
  once (a card with no price gives a buyer nothing to ask about, so the question arrives
  through Inquire instead) and the owner's call stands. D4 needs no wording decision.
- 2026-08-08 — the Buyers & Sellers band is spelled **DaScout**, not the artwork's
  "Dascout", and the "Get started today" button sits INSIDE the band beneath the wordmark.
  Both were the standing recommendations; taken rather than blocked on, per the owner.
- 2026-08-04 — public `?cat=` taxonomy fixed at the five seeded types ("Split"); later types
  are visible but not in `?cat=`/nav. `DbCategory`/`CategoryKey` stays, sourced via join.
- Standing verification bar = Vitest + 03-listing-journey.spec.ts (both against a production
  build); the full E2E battery is fragile (see Next) and is not the bar.

## Standing

(mirror — `D:\Workspace\DaScout\CLAUDE.md` is authoritative)

- No map anywhere public. Peso amounts are public ONLY on listings whose `price_public`
  switch is on (Phase D, 2026-08-08) — the blanket "no peso anywhere public" rule is
  retired. `anon` still has no grant on `price_php`; the public side reads the generated
  `price_public_php`. A hidden price renders no line at all.
- Commits go straight to main; NEVER push without asking.
- No Docker — production Supabase is the only reachable database; migrations apply via the
  Supabase MCP at the owner's OK, or not at all.
- A grant change and the code depending on it ship TOGETHER: widening lands before the code,
  narrowing lands after it (the 2026-08-02 outage; inverted-and-correct on 2026-08-04).
- Playwright needs `npm run build` first and takes port 3000; the E2E suite writes to the
  live database — prefer targeted specs. test-staff-p4@dascout.local stays role=staff.
- Show a sample before building any screen; reports in plain words; route via /do-me.
