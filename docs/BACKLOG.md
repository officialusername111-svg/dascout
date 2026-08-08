# BACKLOG

> Canonical pending state (DISPATCH.md §0 "The standing queue"). Paths are repo-relative;
> prefix with `dascout/` from the workspace root. Entries are candidates — re-derive each
> from the repo at run start. Single writer: the orchestrating session only.
>
> **Swept 2026-08-08.** Everything finished moved to `## Done`, condensed to one line plus
> its commit. The lessons those runs paid for are in `## Hard-won rules`, which is the part
> to read before touching anything. Nothing was deleted that a future session needs; the
> full narrative of each run lives in git history and in `docs/HANDOFF.md`.

## Now

Four open items. None is blocking; two are one-line decisions.

- **Push — 2 commits sit on `main`, unpushed** (`a0b6b74` Phase D, `df9dd73` its record).
  Everything before them is on `origin/main`. Standing rule: never push without asking.

- **`D:\Workspace\DaScout\CLAUDE.md` is edited but UNCOMMITTABLE.** Phase D's D5 retired the
  "no peso anywhere public" rule there as well as here, but that file sits ABOVE the
  repository root, so it is in no commit and will not travel with a clone. The copy in
  `## Standing` below is committed and correct. Only an issue if that file is kept elsewhere.

- **Should the description editor offer links?** Phase C shipped without them, per the
  recommendation. Adding them later means adding `a` to the sanitiser **with an href scheme
  allowlist**, never just to the tag list. Images stay impossible regardless — `img-src` in
  `proxy.ts:57` blocks them.

- **The band's tablet kicker wrap.** Between roughly 748 and 890 px of viewport the kicker
  wraps to two lines and the pin-to-text ratio drops to 1.44. This is the approved CSS
  behaving exactly as written — the sample's tablet frame was a 768 px *container*, but the
  real page at a 768 px *viewport* gives a 705 px container because of the page gutters.
  Cosmetic, left as approved. One-number fix if wanted: raise the two-column `@container`
  threshold in `.pwbs-band` from `700px` to `890px`.

## Next

Nothing here is started. Ordered roughly by dependency, not by priority.

- **Enhancement round v2 — Phase E, and only Phase E, is left.** Clear the listing database
  (client item 9). **Runs ONLY on the owner's explicit signal.** All site data is test data
  (owner, 2026-08-06), so it is lower risk than first assessed, but it is irreversible and
  runs alone. Tasks E1–E5 in `docs/PLAN-enhancement-v2.md`: back up via the MCP (no Docker,
  so no `pg_dump`), clear listings and dependents, clear BOTH storage buckets — deleting
  rows never removes the files — decide whether `property_no` restarts at `001`, then verify
  `sitemap.ts` and the live site render cleanly empty.
- **Piece 6 done properly — the loading indicator.** Navigation blocks again with no
  indicator (~450–670 ms public, ~2 s on the admin listing detail page). That is the
  deliberate trade recorded below: a slow navigation beats a publish button that lies.
  The real fix is to split the admin listing detail fetch so `ListingActionBar` renders from
  one fast query and the heavy panels stream behind `<Suspense>` boundaries placed **BELOW**
  it, never above. Medium, UI-adjacent, no sample needed (same mark, same copy).
  `components/LoadingMark.tsx` is on disk, **unreferenced on purpose** — it is this job's
  starting material. **Do not let `/clean-me` sweep it.**
- [user-intake] Piece 4 — approval-workflow refinement (`docs/BRIEF-listing-encoding-v2.md`).
- [user-intake] Piece 5 — photos section redesign with icons. Brief says **SAMPLE FIRST**.
- [user-intake] Piece 7 — remove the request-property function. Deliberately deferred;
  `property_requests.category` still blocks retiring `listing_category`.
- [recurring] V3 full-battery verification per `docs/E2E-V3-RUNBOOK.md` — on request, before
  any release, after any schema/grant change, or when a week has passed without one. Runs
  in-session (the sweep needs the Supabase MCP); never as an OS job.
- [hygiene] `/clean-me` candidates: `docs/NEXT-SESSION.md` and `docs/NEXT-SESSION-PROMPT.md`
  are both spent — the sessions they were written for have run. Keep `LoadingMark.tsx`.

## Parked

- `cleanup_backup` schema still in Supabase — blocked on owner satisfaction, then
  `drop schema cleanup_backup cascade;` via MCP. Since 2026-08-02.
- Bulk actions from the admin mockup — blocked on the owner's explicit call (a new
  capability on a verification gate). Unbuilt on purpose. Since 2026-08-02.
- Migration ledger drift (filename timestamps ≠ applied versions) — low risk; harmless via
  the API, would confuse `db push` / `db reset`. `docs/MIGRATION-LEDGER-DRIFT.md`. Since
  2026-07-31.

## Hard-won rules — read before touching these areas

Each of these cost a session or an outage. They are here because the code they describe
looks correct without them.

**Database and grants**

- `listings` is **column-granted, not table-granted** (the 2026-08-02 price detach). A new
  column is invisible to `anon` until it is named in a `grant select (col)`. Adding a column
  and forgetting this looks like the column simply has no data.
- **A grant that widens lands BEFORE the code that reads it; a grant that narrows lands
  AFTER.** Backwards took the site down for ten minutes on 2026-08-02.
- **Never expose a per-row rule through a view.** A Postgres view runs with its OWNER's
  rights unless declared `security_invoker`, so it bypasses row-level security entirely and
  has to re-implement filters like `status='live'` in a second place. Declaring it
  `security_invoker` only moves the problem — the caller then needs the underlying grant.
  Phase D uses a **stored generated column** (`price_public_php`) instead. Do not "fix" it
  back into a view.
- Migrations apply through the Supabase MCP at the owner's OK, or not at all. No Docker.
- Test data: sweep `zz-` rows through the MCP only, scoped by the `zz-` prefix and **never**
  by status alone. `test-staff-p4@dascout.local` stays `role=staff` — load-bearing fixture.

**Stored HTML**

- Nothing reaches `listings.description_html` without `sanitizeDescriptionHtml` **on the
  server**. Sanitising in the editor is a convenience, not a control.
- The allowlist **drops, it never repairs**. `style` may carry only `color`, `font-family`
  and `text-align`, each validated against a closed rule.
- `span` MUST stay in the tag allowlist — colour and typeface arrive as
  `<span style="…">`, and dropping it silently threw away every colour and face on save with
  no error at all.
- Plain `description` is **derived** from the sanitised HTML, never posted beside it.
  Nothing may post a plain `description` again. The SEO meta path depends on it being clean.
- `dangerouslySetInnerHTML` on the listing page is safe **only** because the value is
  filtered on the way in. Never widen the allowlist to make that page look better.

**CSS**

- **Check `globals.css` before naming a class.** The approved band sample used bare `.band`,
  `.grid`, `.copy`, `.glass`; this stylesheet already owned `.grid` (listing cards) and
  `.copy` (footer). Everything is prefixed `pwbs-`.
- **Never distinguish two class names by CASE alone.** Class selectors are case-INSENSITIVE
  in a document with no doctype, so `.A{padding:56px}` silently applied to
  `<span class="a">`. Cost an hour and presented as a text-wrapping bug that was not one.
- **`-webkit-backdrop-filter` must be written BEFORE the unprefixed property.** The other
  way round, the build's minifier drops the unprefixed one and only `-webkit-` ships, which
  Chromium does not honour — the glass loses its blur. The source looks correct; only the
  built chunk shows it.
- Montserrat ships at weights **600 and 700 only** (`layout.tsx:23`). Anything heavier is
  the browser faking it.

**Next.js and testing**

- **A `<Suspense>` boundary above `ListingActionBar` or `ListingForm` breaks server
  actions.** Next 16 keeps two copies of the admin page after `revalidatePath`; the stale
  one never leaves `pending === true`, so the button sits on "Working…" while the write has
  already succeeded. It passes `tsc` and passes the build. **Only
  `03-listing-journey.spec.ts` catches it — re-run that spec on any loading change.**
- Playwright needs `npm run build` first and takes port 3000; stop any preview.
  `reuseExistingServer: false`, so a server already on 3000 blocks the whole suite.
- The E2E suite writes to the **live** database. Prefer targeted specs.
- `document.fonts.check()` returns true for a font that is NOT loaded. Only measuring text
  width against the fallback proves a webfont is really rendering.
- Next's production server caches its public-file list at boot — a file added to `public/`
  after start returns 404 until it is restarted.
- Container-query units do not re-resolve within one script tick, and a viewport resize
  needs a page reload before container queries read correctly.
- Browser-pane screenshots fail intermittently ("not compositing frames"); verify by
  `getBoundingClientRect` and computed style instead.
- The Bash tool is bash, not PowerShell — `-m @'…'@` leaks a literal `@`. Use `git commit -F`.

## Done

Condensed. Full narrative in git history and `docs/HANDOFF.md`.

**2026-08-08**

- **Phase D — price show/hide** (`a0b6b74`). Per-listing switch; off everywhere; a hidden
  price renders no line at all. Generated column `price_public_php`, `price_php` still
  ungranted to `anon`. D5 retired the "no peso anywhere public" rule in the same change.
- **Phase C — formatted descriptions** (`fa6186d` sanitiser + 36 tests, `4df8d86` editor,
  `d3f3f40` wiring, `a0f4413` empty-markup fix). Migration applied, 13/13 backfilled.
- **Buyers & Sellers band, arrangement A** (`3411ff4`, `4bed3ec`). Live text replaces the
  flat 5063 px artwork; 36 KB of assets retire 307 KB, plus `verified-fields.jpg`.
- **TEST_BUYER auth write confirmed already applied** — the marker claiming otherwise was
  stale. Vitest green.
- **Push** — `e4105aa` → `a0f4413` on `origin/main`.

**2026-08-07 and earlier**

- Phase A home visuals (`a0516c3`) and Phase B contact block (`a0a7dc7`) — pushed and live.
- Admin server-action hang **fixed** (`do-me-2026-08-07-blockers`) — root cause was piece 6's
  Suspense boundaries; both `loading.tsx` files deleted. See the rule above.
- Listing encoding v2 apply 1–3, admin redesign, property numbers 001–012, admin invites and
  the privilege split, the anon price-column detach, the v6 home redesign, deployment to
  dascoutprime.com. All live.

## Decided — do not reopen

- 2026-08-08 — Phase D: a HIDDEN price shows **nothing at all**. No "price on request", no
  placeholder. The concern was raised once (a card with no price gives a buyer nothing to
  ask about, so the question arrives through Inquire) and the owner's call stands.
- 2026-08-08 — the band is spelled **DaScout**, not the artwork's "Dascout", and the
  "Get started today" button sits INSIDE the band beneath the wordmark.
- 2026-08-07 — Phase C: the typeface picker is IN (four faces only) and free colour codes
  are IN, warning below 4.5:1 without ever blocking. The body-text gold is `#8F6E28`
  (4.74:1), NOT `#B8923E` (2.91:1) — the bright gold stays right for headings and buttons.
- 2026-08-07 — Montserrat Bold is the approved stand-in for the artwork's display face;
  no licensed files exist in the repo (`app/layout.tsx:18-19`). Do not re-ask.
- 2026-08-04 — public `?cat=` taxonomy fixed at the five seeded types; later types are
  visible but not in `?cat=`/nav.
- 2026-08-03 — test-data cleanup is NEVER automated: no service-role key, no purge function,
  no separate project or branch.
- 2026-08-02 — `price_php` readable by any REGISTERED account is ACCEPTED. Closing it
  properly means a staff-only price table, deferred until the client wants it. Not a
  security finding.
- 2026-08-02 — property number: public, shown before the name, NOT required to publish, own
  column on the admin index.
- Standing verification bar = **Vitest + `03-listing-journey.spec.ts`**, both against a
  production build. The full E2E battery is fragile and is not the bar.

## Standing

(mirror — `D:\Workspace\DaScout\CLAUDE.md` is authoritative)

- No map anywhere public. Peso amounts are public ONLY on listings whose `price_public`
  switch is on (Phase D, 2026-08-08) — the blanket "no peso anywhere public" rule is
  retired. `anon` still has no grant on `price_php`; the public side reads the generated
  `price_public_php`. A hidden price renders no line at all.
- Commits go straight to main; **NEVER push without asking.**
- No Docker — production Supabase is the only reachable database; migrations apply via the
  Supabase MCP at the owner's OK, or not at all.
- A grant change and the code depending on it ship TOGETHER: widening lands before the code,
  narrowing lands after it.
- Playwright needs `npm run build` first and takes port 3000; the E2E suite writes to the
  live database — prefer targeted specs. `test-staff-p4@dascout.local` stays `role=staff`.
- Show a sample before building any screen; reports in plain words; route via `/do-me`.
