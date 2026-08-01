# Runbook — release the v6 home redesign to dascoutprime.com

**Status: EXECUTED 2026-08-01. Approved by the owner in-conversation, pushed, and verified live.**
Push `6d749b7..fc9d51b`; the new design was serving on dascoutprime.com ~20 seconds later.
Verification results are at the bottom of this file. Keep this runbook — the rollback section is
still the live procedure if the site needs to go back.

- **What is being deployed:** the Next.js app in `web/`, at commit `fc9d51b` on `main`
  (5 commits ahead of `origin/main`).
- **Target:** production — <https://dascoutprime.com>, Vercel project `dascout`, Root Directory `web`.
- **Deploy mechanism:** **`git push origin main`**. Vercel auto-deploys every push to `main`
  straight to production. There is no separate deploy button — **the push IS the release.**
- **Database:** **no schema change.** No file under `supabase/` is touched by this release. No
  backup is required for schema reasons, and no migration script exists to apply.
- **Environment variables:** **no change.** The release introduces no new variable and removes
  none. The five in use (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `NEXT_PUBLIC_SITE_URL`, `RESEND_API_KEY`, `REQUEST_NOTIFY_TO`) all stay exactly as they are.
  `RESEND_API_KEY` and `REQUEST_NOTIFY_TO` are still needed — the match-alert mailer was kept.

---

## What changes for someone visiting the site

- The home page is the approved v6 design: new hero photo, the featured property as a photo tile
  beside a glass search box, a new "We Verify Them" section, and a footer with the real phone,
  email and Facebook page.
- **The whole site turns black instead of navy** — header, footer, sidebar, buttons, and the admin
  and account screens too.
- **"Request a Property" disappears from the site.** No one can submit a new request. Requests
  already in the database still work: confirmation links still work, unsubscribe links still work,
  the admin inbox still lists them, and match-alert emails still go out.
- Gone from the home page: the search strip, the trust badges, Explore Property Types, the
  testimonials, the request band, Browse by Location and the FAQ.

---

## Pre-flight — already verified, no action needed

| Check | Result |
|---|---|
| Production build (`npm run build`) | pass, 17 routes |
| TypeScript (`tsc --noEmit`) | pass |
| Lint (`eslint`) | pass, 0 warnings |
| Unit tests (Vitest) | **136 / 136** |
| End-to-end tests (Playwright) | **101 / 101** |
| Secrets in the diff | none — screened before commit |
| Migrations touched | none |

These ran against the exact `web/` tree that this push ships (confirmed byte-identical).

---

## Steps

### 1. Confirm you are on the right commit

```bash
git -C D:/Workspace/DaScout/dascout log --oneline -1
```

**You should see:** `fc9d51b docs(run): record the run-v6-home-black merge SHA and rollback command`

If you see anything else, stop and say so.

### 2. Note the current live deployment, so you can roll back to it

1. Open <https://vercel.com> → project **dascout** → **Deployments**.
2. Find the deployment currently marked **Production** (the top one, labelled `Current`).
3. **Write its URL down** — something like `dascout-abc123.vercel.app`. This is your way back.

**You should see:** one deployment marked Production, dated 2026-08-01 or earlier.

### 3. Push — this starts the release

```bash
git -C D:/Workspace/DaScout/dascout push origin main
```

**You should see:** `To https://github.com/officialusername111-svg/dascout.git` followed by
`6d749b7..fc9d51b  main -> main`.

### 4. Watch the Vercel build

1. Back on Vercel → **Deployments**. A new build appears within about 30 seconds.
2. Wait for it. It takes roughly one to two minutes.

**You should see:** the new deployment goes **Building → Ready**, and takes over as Production.

**If it says Error:** open the build log, copy the last 20 lines, and stop here. Do not retry.
The old version is still live and untouched — a failed Vercel build never replaces the running one.

### 5. Check the live site

Open <https://dascoutprime.com> in a **private/incognito window** (so you are not served a cached
copy) and confirm:

- [ ] The **footer** is pure black, and the buttons and pills are black rather than navy. (The
      header bar itself stays **white** — it always was; the dark header in the mockup was a
      mockup simplification, not a change to the app.)
- [ ] The hero shows the new night photo, with the property tile on the left and the
      "Find Your Best Property" box on the right.
- [ ] The featured property tile is **just a photo** with the name and location on it — no
      bed/bath/size row underneath.
- [ ] Scrolling down: Featured Listings → "Here's what you can expect from us" (dark panel, four
      cards) → "We Don't Just List Properties. We Verify Them." → Top Properties → Continue Browsing.
- [ ] The footer shows **0920 668 5742**, **dascoutph@gmail.com** and **DaScout on Facebook**.
- [ ] **No peso amounts anywhere** and **no map** — this is the standing rule.
- [ ] Open the menu (☰). There is **no "Request a property"** item.
- [ ] Click a property. Its page opens normally and the "Inquire" button opens an email to
      **dascoutph@gmail.com**.

### 6. Check the parts that were kept

- [ ] Sign in at `/admin` → **Requests**. The existing property requests are still listed.
- [ ] `https://dascoutprime.com/sitemap.xml` still loads and lists the properties.
- [ ] `https://dascoutprime.com/robots.txt` still loads.

---

## Rollback plan

**Fastest — under a minute, no code change.** Use this if the site looks wrong or is down.

1. Vercel → project **dascout** → **Deployments**.
2. Find the deployment you wrote down in step 2.
3. Click its **⋯** menu → **Promote to Production** (older Vercel wording: **Rollback**).
4. Confirm. dascoutprime.com returns to the previous version immediately.

Vercel keeps every past deployment, so this is the rollback artifact — there is no folder to copy
and nothing to rebuild.

**Durable — puts the code back too.** Use this if you want the repository to match the rolled-back
site rather than just overriding it.

```bash
git -C D:/Workspace/DaScout/dascout revert -m 1 7cce7b6
git -C D:/Workspace/DaScout/dascout push origin main
```

This undoes the entire redesign as one commit and triggers a fresh deploy of the old design.

**Database rollback:** not applicable — this release changes no schema and writes no data.

---

## Known, accepted, not blocking

- **`/#faq` and `/#locations` no longer exist.** Any old bookmark or search result pointing at them
  lands on the home page instead. No error page, nothing broken — just no jump.
- **The old static site on GitHub Pages is untouched** and still served at
  `officialusername111-svg.github.io/dascout/`. Retiring it is a separate decision.
- **Vercel is still on the Hobby plan.** Unchanged by this release.

---

## Execution record — 2026-08-01

| Step | Result |
|---|---|
| 1. Commit check | `fc9d51b` confirmed |
| 2. Before-state captured | old design confirmed live (`reqband`, `Explore Property Types` present) |
| 3. `git push origin main` | `6d749b7..fc9d51b`, remote not diverged, clean fast-forward |
| 4. Vercel build | new design serving **~20s** after the push |
| 5. Home page verified | see below |
| 6. Retained surfaces verified | see below |

**Live home page (dascoutprime.com):**

- Present: "Find Your Best Property", "We Verify Them", `0920 668 5742`, `dascoutph@gmail.com`,
  the Facebook page link, `verified-fields.jpg`, `btn-dark`.
- Gone: `reqband`, Explore Property Types, What Our Clients Say, Browse by Location, the FAQ,
  every "Request a property" string, `btn-navy`, `hero-night.jpg`.
- Standing rules hold: **0** peso signs, **0** map embeds.

**Live stylesheet:** `hero-night2` present, `--ink-900` = `#0d0d0f`, `--navy-900` gone,
`.searchcard` / `.glasscard` / `.expect` / `.ecard` present; `btn-navy`, `reqband`, `searchbar`,
`.trust`, `azindex`, `quotes` and both old navy hex values all absent.

**Live DOM at 1360px:** footer background `rgb(0,0,0)`; featured tile **404px** and search card
**562px** on one row, centred against each other; sections in order — Featured Listings → Here's
what you can expect from us → We Don't Just List Properties. We Verify Them. → Top Properties →
Continue Browsing; `.tabs` pill 44px tall with `align-items:center`; no "request a property"
text; no peso sign.

**Retained request backend:** `/requests/confirm` 200, `/requests/unsubscribe` 200, `/admin` 307
(redirects to sign-in, as designed). `/sitemap.xml` 200, `/robots.txt` 200.

> Note: the site header is white by design (`header{background:#fff}`) and always was — the dark
> header in the mockup was a mockup simplification, not a spec for the app.
