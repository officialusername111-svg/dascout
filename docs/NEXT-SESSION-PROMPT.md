# Prompt for the next session

Copy everything inside the block below into a fresh session.

---

```
Read docs/HANDOFF-2026-08-02-evening.md first — it is the state of play. It SUPERSEDES
docs/HANDOFF-2026-08-02.md; where they disagree the evening one is right, and the older
one's 15-column anon grant list is wrong (it omits updated_at and would break the sitemap).

The repo is D:\Workspace\DaScout\dascout, one level BELOW the working directory.
Three sessions in a row have lost their first tool calls to that.

Two commits are unpushed: 47a45e1 (admin v1 redesign) and 25c4124 (property number leads
the listing name). They are committed, tested and NOT live.

Start here:

1. Push those two commits and confirm dascoutprime.com comes back healthy — home, the
   ?loc= filter view, a property page and the sitemap. Then show me the admin listings
   screen and a listing detail on the live site so I can see the redesign.

   Note what went wrong last time: applying a grant migration while the deployed code
   still depended on the revoked column took the site to a 500 for ten minutes. Nothing
   in these two commits touches grants, so a plain push is safe — but verify, don't assume.

2. Give a listing a real property number so I can actually see "001 - Dacera Heights
   Corner Lot" on the public page. Right now 0 of 78 listings have one, so the feature is
   invisible. Pick one of the 12 real (non-zz) live listings, ask me which before you
   write, and use the admin UI rather than raw SQL so the uniqueness check gets exercised.

3. Then the zz- test rows. 66 of 78 listings are E2E residue and it grows every full
   Playwright run. Clean out the current ones AND fix it durably — I don't want to keep
   doing this. The handoff has the cleanup SQL (verification_events first, it is the only
   RESTRICT FK) and three durable options: a separate Supabase project, a Supabase branch,
   or a global-teardown in the suite. Recommend one and tell me the trade-off before you
   build it. This deletes production rows, so it is an ASK gate.

Decisions already made — do not reopen these:
- Price readable by any REGISTERED account is accepted. Staff and buyers share the
  `authenticated` role so no column grant separates them; closing it properly means moving
  the price to its own staff-only table. I said we can activate that later if the client
  wants it. Do not re-raise it as a security finding.
- Property number: public, shown before the name, NOT required to publish, and not
  prefixed on the admin listings index (that screen has its own column for it).
- The mockup's bulk-select bar was deliberately not built. Ask me before building it —
  bulk publish past the per-listing confirm is a new capability on a verification gate.

Standing rules: no peso amounts and no map anywhere public (admin may show peso); commits
go straight to main; never push without asking me. There is no Docker on this machine, so
production is the only database you can reach — migrations are applied at my OK or not at
all. The E2E suite writes to the live database, so prefer targeted specs; 06-public-smoke
and 18-admin-redesign are both read-only. Playwright needs `npm run build` first and takes
port 3000 for itself, so stop any dev preview before running it.

Route substantive work through /do-me as usual, and keep the reports in plain words.
```
