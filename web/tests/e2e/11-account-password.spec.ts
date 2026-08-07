import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { signInViaModal, signInAsStaff } from './helpers'

/**
 * E.21-25 — password management. This whole file runs `serial` and single-worker (the
 * global config is already `workers: 1`/`fullyParallel: false`, but `.serial` is added
 * explicitly so the ordering — and the fact that nothing else may run between the
 * rotation and its restore — is true by the file's own declaration, not merely an
 * accident of the current config).
 *
 * The real fixture password IS rotated (through the real UI, proving the actual product
 * behaviour) and is restored via a direct, page-independent Supabase client in
 * `test.afterAll` — NOT solely through more UI interaction inside the same test. A first
 * version of this file restored through the UI in a `try/finally` and lost a race with
 * Playwright's own test timeout: the timeout tore the page down before the `finally`
 * block's UI actions could complete, leaving the shared fixture's password rotated with
 * no automatic recovery. `afterAll` here uses a plain `createClient(...).auth.signIn +
 * updateUser` round trip that does not depend on `page`/`context` at all, so it cannot be
 * cut short by a browser-side timeout the way the UI-driven restore was.
 */
test.describe.serial('Password management (E.21-25)', () => {
  const ORIGINAL_PASSWORD = process.env.TEST_BUYER_PASSWORD!
  // FIXED, not `Zz-Bt-Temp-${Date.now()}`. A timestamped temp value is only knowable to the
  // process that generated it, so a run killed between the rotation and `afterAll` left the
  // shared fixture on a password NOBODY could sign in with — unrecoverable without a
  // production auth write. That is exactly what happened on 2026-08-04 and it blocked five
  // Vitest files for three days. A constant is recoverable by any later run: the candidate
  // loop below signs in with it and puts the original back. It is a throwaway value on a
  // `.local` fixture account and is the real password only for the seconds between E.22 and
  // `afterAll`.
  const TEMP_PASSWORD = 'Zz-Bt-Temp-Fixture-Rotation'
  let rotated = false

  test.afterAll(async () => {
    if (!rotated) return
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    const email = process.env.TEST_BUYER_EMAIL!

    // Whichever of TEMP or ORIGINAL currently signs in is the one to restore from —
    // this makes the restore idempotent even if re-run after a partial prior attempt.
    for (const candidate of [TEMP_PASSWORD, ORIGINAL_PASSWORD]) {
      const client = createClient<Database>(url, key, { auth: { persistSession: false } })
      const { data, error } = await client.auth.signInWithPassword({ email, password: candidate })
      if (!error && data.session) {
        if (candidate === ORIGINAL_PASSWORD) return // already restored
        const { error: updateError } = await client.auth.updateUser({ password: ORIGINAL_PASSWORD })
        if (updateError) throw new Error(`RESTORE FAILED: could not set the original fixture password back: ${updateError.message}`)
        console.log('[password-restore] fixture password restored to its original value via direct client.')
        return
      }
    }
    throw new Error('RESTORE FAILED: neither the temp nor the original fixture password signs in — manual intervention needed.')
  })

  test('E.21: wrong current password gets a named field error; the old password still signs in', async ({ page }) => {
    await page.goto('/')
    await signInViaModal(page, 'buyer')
    await page.goto('/account/password')

    await page.locator('#pw-current').fill('definitely-not-the-current-password')
    await page.locator('#pw-new').fill('Whatever-New-Pass-1')
    await page.locator('#pw-confirm').fill('Whatever-New-Pass-1')
    await page.getByRole('button', { name: 'Change password' }).click()

    await expect(page.locator('.field.invalid:has(#pw-current) .ferr')).toContainText('not your current password')

    // G.31 (this action's own hygiene): the wrong password just submitted never comes
    // back in the page's HTML — `changePassword` never builds a `values` object for a
    // password form at all (CONTRACT.md §3: "every field on this form is a password").
    const html = await page.content()
    expect(html).not.toContain('definitely-not-the-current-password')

    // Old password still works (nothing was changed).
    await page.goto('/account')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.waitForURL('**/')
    await signInViaModal(page, 'buyer')
    await expect(page.locator('.hd-actions a.btn.btn-gold[href="/account"]')).toBeVisible()
  })

  test('E.23: mismatch and same-as-current are refused before any change is attempted', async ({ page }) => {
    await page.goto('/')
    await signInViaModal(page, 'buyer')
    await page.goto('/account/password')

    // Mismatch.
    await page.locator('#pw-current').fill(ORIGINAL_PASSWORD)
    await page.locator('#pw-new').fill('First-New-Pass-1')
    await page.locator('#pw-confirm').fill('Different-New-Pass-1')
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(page.locator('.field.invalid:has(#pw-confirm) .ferr')).toContainText('do not match')

    // Same-as-current.
    await page.locator('#pw-current').fill(ORIGINAL_PASSWORD)
    await page.locator('#pw-new').fill(ORIGINAL_PASSWORD)
    await page.locator('#pw-confirm').fill(ORIGINAL_PASSWORD)
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(page.locator('.field.invalid:has(#pw-new) .ferr')).toContainText('different from your current one')
  })

  test('E.22: a correct change succeeds; old password fails, new password works', async ({ page }) => {
    await page.goto('/')
    await signInViaModal(page, 'buyer')
    await page.goto('/account/password')

    await page.locator('#pw-current').fill(ORIGINAL_PASSWORD)
    await page.locator('#pw-new').fill(TEMP_PASSWORD)
    await page.locator('#pw-confirm').fill(TEMP_PASSWORD)
    await page.getByRole('button', { name: 'Change password' }).click()

    await expect(page.locator('.fmsg.ok')).toContainText('Password changed')
    // From this point on the fixture's real password IS the temp one — afterAll MUST run.
    rotated = true

    // Old/new password behaviour is checked with a direct, short-lived client rather than
    // a second full sign-out/sign-in-through-the-UI round trip in the same test — this is
    // both faster and removes the exact kind of long UI chain that caused the previous
    // version of this file to occasionally exceed the test timeout.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    const email = process.env.TEST_BUYER_EMAIL!

    const oldAttempt = await createClient<Database>(url, key, { auth: { persistSession: false } }).auth.signInWithPassword({
      email,
      password: ORIGINAL_PASSWORD,
    })
    expect(oldAttempt.error).not.toBeNull()

    const newAttempt = await createClient<Database>(url, key, { auth: { persistSession: false } }).auth.signInWithPassword({
      email,
      password: TEMP_PASSWORD,
    })
    expect(newAttempt.error).toBeNull()
    expect(newAttempt.data.session).not.toBeNull()
  })

  test('E.24: the staff fixture can reach /account/password from the admin nav and the form renders', async ({ page }) => {
    await signInAsStaff(page)
    await page.getByRole('link', { name: 'Password' }).click()
    await expect(page).toHaveURL(/\/account\/password/)
    await expect(page.locator('#pw-current')).toBeVisible()
    await expect(page.locator('#pw-new')).toBeVisible()
    await expect(page.locator('#pw-confirm')).toBeVisible()
  })

  test('E.25: /account/password?reset=1 with an ordinary session still renders the THREE-field form (reset bypass refused)', async ({
    page,
  }) => {
    // The buyer's real password is currently TEMP_PASSWORD (E.22 rotated it; afterAll
    // restores it only once this whole file is done) — sign in with that value.
    await page.goto('/?auth=login')
    await page.waitForSelector('dialog[aria-labelledby="authH"][open]')
    await page.locator('#li-user').fill(process.env.TEST_BUYER_EMAIL!)
    await page.locator('#li-pass').fill(TEMP_PASSWORD)
    await page.locator('dialog[open] button.mbtn[type="submit"]').click()
    await page.waitForLoadState('networkidle')

    await page.goto('/account/password?reset=1')

    // The bypass is refused: three fields, not two — `?reset=1` is display sugar only,
    // and the real gate is the session's own `amr` claim (absent for an ordinary sign-in).
    await expect(page.locator('#pw-current')).toBeVisible()
    await expect(page.locator('#pw-new')).toBeVisible()
    await expect(page.locator('#pw-confirm')).toBeVisible()
    await expect(page.locator('h1', { hasText: 'Change your password' })).toBeVisible()
  })
})
