# Runbook — put DaScout on Vercel, then on your Hostinger domain

Follow this top to bottom. Every step says what you should see when it worked.
Nothing here has been done for you — you run it.

- **What is being deployed:** the Next.js app in `web/`, at commit `784e42c` on `main`.
- **What is not touched:** the old static site (`index.html`, `styles.css`) keeps serving on
  GitHub Pages at <https://officialusername111-svg.github.io/dascout/>. It has no custom domain,
  so it cannot clash with your Hostinger domain. Retiring it is Phase 6, not today.
- **Database:** no schema change. Supabase stays exactly as it is.

---

## Stage 1 — Get it running on a Vercel address (nothing public yet)

### 1.1 Create the project

1. Go to <https://vercel.com> and sign in **with GitHub**.
2. **Add New → Project**.
3. Find `officialusername111-svg/dascout` and click **Import**.

### 1.2 Set the root directory — this is the step everything depends on

The repository root holds the old static site; the app lives in `web/`.

4. On the configure screen, find **Root Directory** and click **Edit**.
5. Choose the **`web`** folder. Save.
6. **Framework Preset** should now read **Next.js**. If it still says "Other", the root directory
   did not take — go back to step 4.

Leave Build Command, Output Directory and Install Command on their defaults.

### 1.3 Add the two environment variables — before the first deploy

Still on the configure screen, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://kogpuuidawbmttyswvsx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | copy from `web/.env.local` on your PC, or Supabase → Project Settings → API keys → publishable key |

Tick **all three** environments (Production, Preview, Development) for both.

> **Never add the `service_role` key.** The website does not use it. It belongs only to the photo
> uploader script on your own machine.

### 1.4 Deploy

7. Click **Deploy**. It takes about one to two minutes.
8. Success looks like: a confetti screen and a link such as `dascout-xxxx.vercel.app`.

### 1.5 Check it actually works

Open the `.vercel.app` link and confirm:

- [ ] The home page shows **12 properties** with photos.
- [ ] Clicking a property opens its page, with the photo gallery and map.
- [ ] The search bar filters — try a town, then a price range.
- [ ] `<your-url>/sitemap.xml` lists the 12 properties.
- [ ] `<your-url>/robots.txt` loads.

**If the build failed with "No Next.js version detected"** — the root directory is not `web`.
Project → Settings → General → Root Directory → set to `web` → Redeploy.

**If the page loads but shows an error** — an environment variable is missing or misspelled.
Project → Settings → Environment Variables, fix it, then **Deployments → ⋯ → Redeploy**.
Environment variable changes only take effect on a new deployment.

---

## Stage 2 — Attach the Hostinger domain

Do this only once Stage 1 checks all pass.

### 2.1 Tell Vercel about the domain

1. In the Vercel project: **Settings → Domains**.
2. Type your domain (for example `dascout.ph`) and click **Add**.
3. Add `www.yourdomain` as well. Vercel will ask which one is the main address and set the other
   to redirect to it — either choice is fine, just pick one.
4. Vercel now shows you the exact DNS records to create. **Copy what your screen shows**, not what
   any guide says — these values change. They usually look like:

   | Type | Name | Value |
   |---|---|---|
   | A | `@` | `76.76.21.21` |
   | CNAME | `www` | `cname.vercel-dns.com` |

### 2.2 Put those records in Hostinger

5. Sign in to Hostinger → **hPanel** → **Domains** → your domain → **DNS / Nameservers** →
   **DNS Records**.
6. **Keep Hostinger's nameservers as they are.** You are editing records, not switching
   nameservers — that way any email on this domain keeps working.
7. Delete or edit the existing `A` record for `@` (Hostinger usually points it at a parking page).
8. Add the **A** record exactly as Vercel showed it. TTL: leave default, or 300 for faster updates.
9. Delete any existing `CNAME` for `www`, then add the **CNAME** Vercel showed.
10. Save.

### 2.3 Wait for it to take

11. Back in Vercel → **Settings → Domains**. The domain shows **Invalid Configuration** at first.
12. Refresh every few minutes. It usually turns to **Valid Configuration** within 10–30 minutes.
    DNS can take up to 24 hours in the worst case — that is normal, not a fault.
13. Once valid, Vercel issues the HTTPS certificate on its own. `https://yourdomain` should load.

---

## Stage 3 — Point the site at its own address

The sitemap, `robots.txt` and the link preview when someone shares a property all need to know the
real address. Until you do this, they say `https://dascout.ph` whether or not that is your domain.

1. Vercel → **Settings → Environment Variables** → add:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SITE_URL` | `https://yourdomain` — no slash at the end |

2. **Deployments → ⋯ → Redeploy**.
3. Check `https://yourdomain/sitemap.xml` — the links inside should now use your domain.

---

## What changes about your workflow from now on

Every push to `main` automatically deploys to the live site. There is no separate "deploy" step
any more. If that is not what you want, turn it off in Vercel → Settings → Git.

---

## Rollback — how to get back

| If | Do this |
|---|---|
| A deployment breaks the site | Vercel → **Deployments** → find the last good one → **⋯ → Promote to Production**. Takes seconds. |
| The domain misbehaves | Vercel → Settings → Domains → remove the domain. The site stays up on its `.vercel.app` address. |
| You want the whole thing gone | Delete the Vercel project. Nothing in GitHub, Supabase or Hostinger is affected. |
| You want the code back to before Phase 2 | `git revert -m 1 a13d4c2` — this undoes the merge as a new commit, keeping history intact. |

Nothing in this runbook changes the database, so there is no backup step and nothing to restore.

---

## Two things to decide before you start

1. **Vercel's free plan is for non-commercial projects.** DaScout is a business listing site, which
   puts it on the **Pro** plan (about US$20 a month) under Vercel's terms. The free plan will work
   technically; this is a licensing question, not a technical one.
2. **Sign-in is not switched on yet.** When accounts land (Phase 3), the domain must also be added
   to Supabase → Authentication → URL Configuration. Not needed today.
