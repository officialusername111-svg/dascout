import { test, expect } from '@playwright/test'
import { directClient, staffDirectClient, seedBuyerSessionCookie, buyerDirectClient, userId, zzEmail } from './helpers'

/**
 * Slice B: the public request dialog (AC-6, 7, 8, 9, 11). One shared page per describe
 * block keeps the per-email throttle test deterministic (workers: 1, fullyParallel:
 * false — no cross-test interleaving on the same email).
 */

async function openRequestDialog(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  // Two elements on the home page match /request a property/i: the hero carousel's own
  // "Request a Property" CTA (an off-screen, inactive slide most of the time — `.first()`
  // resolves to that one and times out as unclickable, which is correct rotator behaviour,
  // not a bug) and the "Can't find it? Request it." band further down. Scope to the band.
  await page.locator('.reqband').getByRole('button', { name: /request a property/i }).click()
  await expect(page.locator('dialog[aria-labelledby="reqDH"][open]')).toBeVisible()
}

async function fillAndSubmit(
  page: import('@playwright/test').Page,
  values: { category?: string; town: string; budget?: string; notes?: string; email: string }
) {
  if (values.category) await page.locator('#rq-type').selectOption(values.category)
  await page.locator('#rq-loc').fill(values.town)
  if (values.budget !== undefined) await page.locator('#rq-budget').fill(values.budget)
  if (values.notes !== undefined) await page.locator('#rq-notes').fill(values.notes)
  await page.locator('#rq-email').fill(values.email)
  await page.getByRole('button', { name: /submit request/i }).click()
}

test.describe('Request dialog — valid submit and DB row shape (AC-6, 7, 11)', () => {
  const cleanupEmails: string[] = []

  test.afterAll(async () => {
    if (!cleanupEmails.length) return
    const staff = await staffDirectClient()
    const { error } = await staff.from('property_requests').delete().in('email', cleanupEmails)
    if (error) console.warn('[BT cleanup] property_requests delete failed:', error.message)
  })

  test('AC-6/7/11: a valid submit shows the success message and inserts a row with parsed budget + enum category', async ({
    page,
  }) => {
    const email = zzEmail('valid-submit')
    cleanupEmails.push(email)

    await openRequestDialog(page)
    await fillAndSubmit(page, {
      category: 'rlot',
      town: 'ZZ Test Town',
      budget: '₱2M – ₱6M',
      notes: 'BT verification row',
      email,
    })

    await expect(page.locator('.fmsg.ok', { hasText: /got it/i })).toBeVisible()

    const anon = directClient()
    // property_requests carries no anon SELECT policy (load-bearing note in the
    // dispatch) — read back through the staff client instead.
    const staff = await staffDirectClient()
    const { data, error } = await staff
      .from('property_requests')
      .select('category, preferred_town, budget_min, budget_max, notes, email, is_handled, profile_id')
      .eq('email', email)
      .maybeSingle()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data!.category).toBe('residential_lot')
    expect(data!.preferred_town).toBe('ZZ Test Town')
    expect(Number(data!.budget_min)).toBe(2_000_000)
    expect(Number(data!.budget_max)).toBe(6_000_000)
    expect(data!.is_handled).toBe(false)
    expect(data!.profile_id).toBeNull()
    void anon
  })

  test('AC-7: an unparseable budget is a field error, and no row is written', async ({ page }) => {
    const email = zzEmail('bad-budget')

    await openRequestDialog(page)
    await fillAndSubmit(page, { town: 'ZZ Test Town', budget: 'cheap please', email })

    await expect(page.locator('.field.invalid:has(#rq-budget) .ferr')).toContainText(/could not read that budget/i)
    // The dialog must not have posted a success message.
    await expect(page.locator('.fmsg.ok')).toHaveCount(0)

    const staff = await staffDirectClient()
    const { data } = await staff.from('property_requests').select('id').eq('email', email)
    expect(data).toEqual([])
  })

  test('AC-11: signed-in buyer submit attributes profile_id to the session', async ({ page, context }) => {
    const email = zzEmail('buyer-attrib')
    cleanupEmails.push(email)

    await seedBuyerSessionCookie(context)
    await openRequestDialog(page)
    await fillAndSubmit(page, { town: 'ZZ Buyer Town', email })
    await expect(page.locator('.fmsg.ok')).toBeVisible()

    const buyer = await buyerDirectClient()
    const buyerId = await userId(buyer)

    const staff = await staffDirectClient()
    const { data } = await staff.from('property_requests').select('profile_id').eq('email', email).maybeSingle()
    expect(data?.profile_id).toBe(buyerId)
  })
})

test.describe.serial('Request dialog — throttle uniformity (AC-8, 9)', () => {
  const email = zzEmail('throttle')

  test.afterAll(async () => {
    const staff = await staffDirectClient()
    const { error } = await staff.from('property_requests').delete().eq('email', email)
    if (error) console.warn('[BT cleanup] throttle rows delete failed:', error.message)
  })

  test('three submits from the same email all succeed with the identical uniform message', async ({ page }) => {
    for (let i = 0; i < 3; i += 1) {
      await openRequestDialog(page)
      await fillAndSubmit(page, { town: `ZZ Throttle Town ${i}`, email })
      await expect(page.locator('.fmsg.ok')).toContainText("we'll email you when a matching verified listing goes live")
    }

    const staff = await staffDirectClient()
    const { data } = await staff.from('property_requests').select('id').eq('email', email)
    expect(data).toHaveLength(3)
  })

  test('AC-8/9: a 4th submit within the hour shows the SAME success message (uniform, no leak) and writes no 4th row', async ({
    page,
  }) => {
    await openRequestDialog(page)
    await fillAndSubmit(page, { town: 'ZZ Throttle Town 4th', email })

    // Uniform: the throttled response is indistinguishable from a clean insert.
    await expect(page.locator('.fmsg.ok')).toContainText("we'll email you when a matching verified listing goes live")
    await expect(page.locator('.fmsg.err')).toHaveCount(0)

    const staff = await staffDirectClient()
    const { data } = await staff.from('property_requests').select('id').eq('email', email)
    expect(data).toHaveLength(3) // still 3 — the throttled attempt wrote nothing
  })
})

test.describe.serial('Request dialog — global circuit breaker (AC-9)', () => {
  const bulkEmails = Array.from({ length: 29 }, (_, i) => zzEmail(`breaker-bulk-${i}`))
  const thirtiethEmail = zzEmail('breaker-30th')
  const probeEmail = zzEmail('breaker-probe')

  test.afterAll(async () => {
    const staff = await staffDirectClient()
    const { error } = await staff
      .from('property_requests')
      .delete()
      .in('email', [...bulkEmails, thirtiethEmail, probeEmail])
    if (error) console.warn('[BT cleanup] breaker rows delete failed:', error.message)
  })

  test('AC-9: once 30 requests exist in the last hour, a brand-new email is ALSO uniformly accepted client-side but writes no row', async ({
    page,
  }) => {
    // Prime 29 rows directly (each a distinct, never-throttled email, so only the global
    // count is being exercised) — the 30th is the real UI submit below, which itself
    // must land as row #30 (site-wide cap is >=30, so the 30th insert is still allowed;
    // the 31st is what the breaker actually stops).
    const staff = await staffDirectClient()
    const { error: bulkErr } = await staff
      .from('property_requests')
      .insert(bulkEmails.map((email) => ({ email, category: 'residential_lot' as const, preferred_town: 'ZZ Breaker Town' })))
    expect(bulkErr).toBeNull()

    await openRequestDialog(page)
    await fillAndSubmit(page, { town: 'ZZ Breaker Town 30th', email: thirtiethEmail })
    await expect(page.locator('.fmsg.ok')).toBeVisible()

    // Now the table holds >=30 rows in the last hour — the NEXT insert, even from a
    // never-before-seen email, must trip the global breaker and still read as success.
    await openRequestDialog(page)
    await fillAndSubmit(page, { town: 'ZZ Breaker Town Probe', email: probeEmail })
    await expect(page.locator('.fmsg.ok')).toContainText("we'll email you when a matching verified listing goes live")
    await expect(page.locator('.fmsg.err')).toHaveCount(0)

    const { data: probeRow } = await staff.from('property_requests').select('id').eq('email', probeEmail)
    expect(probeRow).toEqual([]) // the breaker dropped it silently — no row for the probe email
  })
})
