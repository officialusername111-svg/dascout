# Brief — super admin can invite other admins (NOT YET BUILT)

**Written 2026-08-01 for a fresh session.** Written to be built from cold: read this, then
`/do-me` (it will route to `build-me` — this is backend-led with a small admin UI surface).

**Tier: Medium/Large, security-sensitive.** This is a privilege-escalation surface. It earns the
full cycle: BA for the rules, SA for the contract, a migration, RLS, and BT coverage. Do not
right-size this down to "just add a page".

---

## What the owner asked for, verbatim

> I'm the super admin. I can Add other admin that can add listing and manage listing but can't add
> admin accounts. Upon adding an account creation link will be send to the email is inputted in the
> admin assignment.

So: two privilege levels, and an email-invite flow to create the lower one.

---

## What already exists (verified 2026-08-01, don't re-discover this)

- **The enum already has the roles.** `public.user_role` = `buyer | broker | staff | admin`.
  Live counts at the time of writing: 1 buyer, 1 staff, 1 admin.
- **But `admin` and `staff` are treated identically everywhere.** Every check in the app is
  `role === 'staff' || role === 'admin'`:
  - `web/lib/admin/auth.ts` — `isStaffRole()` returns true for both; `StaffRole = 'staff' | 'admin'`.
  - `web/app/account/page.tsx:25` and `web/app/account/password/page.tsx:31` — same disjunction.
  - The database's `is_staff()` is true for both.
  **The privilege split the owner wants does not exist yet — it has to be built.**
- **Role comes from an own-row `profiles` select, never from the JWT** (`lib/admin/auth.ts:15-16`)
  — a deliberate decision, because a claim baked into a token survives a demotion. Keep it.
- **A staff-guard trigger already protects the `profiles` role column.** Find it before changing
  anything; the new flow must go through it, not around it.
- **Email already works.** Resend is wired in `web/lib/email.ts`, `RESEND_API_KEY` and
  `REQUEST_NOTIFY_TO` are set on Vercel, and the chain was proven live 2026-07-31.
- **There is a proven token-flow precedent to copy:** `web/app/requests/confirm/` and
  `web/app/requests/unsubscribe/` — GET renders only (mail-scanner safe), POST mutates, identical
  output for valid/invalid/absent tokens so nothing is enumerable. Mirror that shape.

## The trap that already bit this project once

Run `run-p5b-double-optin` (see `docs/agent-runs/run-p5b-double-optin.md`) used a row's own UUID as
its email-confirmation token. The blind panel flagged it: the anon PostgREST surface lets a caller
insert a chosen id and self-confirm. It was accepted there because the blast radius was only
"alerts for an address you already controlled".

**That reasoning does NOT transfer here.** A self-redeemable invite token grants staff access to the
admin panel. This flow needs a real secret token — random, hashed at rest, single-use, expiring —
and redemption must not be reachable by an anon caller crafting their own row. Budget for the fact
that the app deliberately holds no service-role key (`.env.example`: "The service_role key must
never appear"), so decide early where redemption executes.

## Rules to pin down with the owner (BA's job — do not assume)

1. Can a `staff` admin edit or delete listings created by another admin, or only their own?
2. Can the super admin revoke or demote a staff admin? From where?
3. Does an invite expire? Suggested default: 7 days, single use.
4. What happens if the invited email already has a `buyer` account — promote it, or refuse?
5. Should the super admin see a list of pending invites, and be able to cancel one?

## Non-negotiables

- **A `staff` admin must not be able to promote themselves or anyone else.** This is the whole
  point. Prove it with a test that signs in as staff and attempts the promotion, expecting denial
  at the database, not just a hidden button.
- **RLS must enforce it**, not just the UI. A hidden nav item is not an authorization control.
- Invite tokens: never logged, never in a URL that gets stored server-side, never echoed back.
- The existing standing rule still binds: **no peso amounts and no map anywhere public.**
- Migration goes in `supabase/migrations/` and is applied deliberately at the ASK gate — never
  auto-applied. Follow `docs/RUNBOOK-deploy.md` conventions.

## Where the code lives

| Concern | Path |
|---|---|
| Role resolution and guards | `web/lib/admin/auth.ts` |
| Admin screens | `web/app/admin/(staff)/` |
| Admin server actions | `web/app/admin/actions.ts` |
| Admin queries | `web/lib/admin/queries.ts` |
| Token-flow precedent | `web/app/requests/confirm/`, `web/app/requests/unsubscribe/` |
| Email sending | `web/lib/email.ts` |
| Migrations | `supabase/migrations/` |
| E2E specs | `web/tests/e2e/` (`01-auth-and-noindex` is the authz one) |

## Also worth doing while in here

`docs/agent-runs/run-v6-home-black.md` records that the E2E suite writes test listings into the
**production** Supabase project — a full run leaves ~10 `zz-*` rows behind, and 101 had accumulated
before the 2026-08-01 cleanup. None are public (only `live` listings render), but the admin list
fills with noise. A separate test project or a Supabase branch would fix it properly. Out of scope
for this brief; raise it with the owner.
