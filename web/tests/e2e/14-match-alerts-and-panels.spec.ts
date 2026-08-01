import { test, expect, type Page } from '@playwright/test'
import { signInAsStaff, staffDirectClient, directClient, zzTitle, zzEmail, generateSmallJpeg } from './helpers'

/**
 * Slice C (match alerts, AC-12..15) and Slice D (market panels, AC-16) on one shared ZZ
 * listing — publishing it through the real admin UI is what fires `sendMatchAlerts` via
 * `transitionListing`'s `after()` hook (AC-14), so this cannot be short-circuited with a
 * direct DB update the way a plain fixture listing can.
 *
 * BT finding (see the BT report): `RESEND_API_KEY` is actually configured in this
 * environment's `.env.local`, contrary to the run dispatch's stated fact that it is
 * unset. `sendMatchAlerts` therefore really calls Resend here. Two recipients are used
 * deliberately: Resend's own `delivered@resend.dev` sandbox address (always accepted,
 * never reaches a real inbox) proves the send-succeeded / `sent_at` path, and an
 * `@example.com` address — which Resend's API rejects outright with 422 — proves the
 * send-failed / retried-next-publish path, standing in for "no key configured" since
 * that state could not be produced in this environment without editing `.env.local`.
 */

const RESEND_LIST = 'https://api.resend.com/emails'

async function resendMessageTo(recipient: string, subject: string, since: number): Promise<{ id: string } | null> {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  const res = await fetch(RESEND_LIST, { headers: { Authorization: `Bearer ${key}` } })
  if (!res.ok) return null
  const body = (await res.json()) as { data: { id: string; to: string[]; subject: string; created_at: string }[] }
  const match = body.data.find(
    (m) => m.to.includes(recipient) && m.subject === subject && new Date(m.created_at).getTime() >= since
  )
  return match ? { id: match.id } : null
}

async function resendMessageText(id: string): Promise<string | null> {
  const key = process.env.RESEND_API_KEY
  const res = await fetch(`${RESEND_LIST}/${id}`, { headers: { Authorization: `Bearer ${key}` } })
  if (!res.ok) return null
  const body = (await res.json()) as { text?: string }
  return body.text ?? null
}

async function publishThroughAdminUi(page: Page, listingId: string) {
  await page.goto(`/admin/listings/${listingId}`)

  // Publish is blocked without at least one cover photo (publishBlockersFor) — the
  // shared fixture needs one even though photos are not this spec's subject.
  const photo = await generateSmallJpeg(page)
  await page.locator('#photo-input').setInputFiles([{ name: 'bt-fixture.jpg', mimeType: 'image/jpeg', buffer: photo }])
  await expect(page.locator('.aqueue > div', { hasText: 'bt-fixture.jpg' })).toHaveClass(/good/, { timeout: 15_000 })
  await page.reload()

  await page.locator('#notes-title_check').fill('BT match-alerts fixture: title check recorded.')
  await page.locator('form:has(#notes-title_check)').getByRole('button', { name: 'Record title check' }).click()
  await expect(page.locator('form:has(#notes-title_check) .fmsg.ok')).toBeVisible()

  await page.locator('#notes-ground_validation').fill('BT match-alerts fixture: ground validation walked the boundary.')
  await page.locator('form:has(#notes-ground_validation)').getByRole('button', { name: 'Record ground validation' }).click()
  await expect(page.locator('form:has(#notes-ground_validation) .fmsg.ok')).toBeVisible()

  await page.getByRole('button', { name: 'Submit for verification' }).click()
  await page.getByRole('button', { name: /Yes — submit for verification/i }).click()
  await expect(page.locator('.pill', { hasText: 'Verifying' })).toBeVisible()

  const publishBtn = page.getByRole('button', { name: 'Publish', exact: true })
  await expect(publishBtn).toBeEnabled()
  await publishBtn.click()
  await page.getByRole('button', { name: /Yes — publish/i }).click()
  await expect(page.locator('.pill', { hasText: 'Live' }).first()).toBeVisible()
}

test.describe.serial('Match alerts (AC-12..15) and market panels (AC-16) on one ZZ listing', () => {
  let page: Page
  let listingId: string
  let slug: string
  let townId: string
  let townName: string
  let townProvince: string

  const emailSuccess = 'delivered@resend.dev'
  // Resend's API hard-rejects the literal `example.com` host with a 422 regardless of
  // local part (verified live by BT — see the BT report); a `zz-bt-…@dascout-test.invalid`
  // address is accepted and WOULD be sent, so it cannot stand in for "send fails".
  const emailNeverSent = `zz-bt-never-sent-${Date.now()}@example.com`
  const emailNoMatch = zzEmail('no-match')
  const emailHandled = zzEmail('handled')

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext()
    page = await context.newPage()
    await signInAsStaff(page)

    const staff = await staffDirectClient()
    const { data: town, error } = await staff.from('towns').select('id, name, province').limit(1).single()
    if (error) throw error
    townId = town.id
    townName = town.name
    townProvince = town.province
    console.log(`[BT fixture] town for this run: ${townName}, ${townProvince} (${townId})`)

    // Four candidate requests, inserted directly (matching is about the request ROW, not
    // how it was filed — 13-request-form.spec.ts already proves the public form writes
    // an equivalent row).
    const { error: reqErr } = await staff.from('property_requests').insert([
      {
        email: emailSuccess,
        category: 'residential_lot',
        preferred_town: townName,
        budget_min: 1_000_000,
        budget_max: 10_000_000,
        is_handled: false,
      },
      {
        email: emailNeverSent,
        category: 'residential_lot',
        preferred_town: townName,
        budget_min: 1_000_000,
        budget_max: 10_000_000,
        is_handled: false,
      },
      {
        // Wrong category — must be excluded from the candidate set entirely.
        email: emailNoMatch,
        category: 'farm_land',
        preferred_town: townName,
        budget_min: 1_000_000,
        budget_max: 10_000_000,
        is_handled: false,
      },
      {
        // Matches on every field but already handled — must be excluded.
        email: emailHandled,
        category: 'residential_lot',
        preferred_town: townName,
        budget_min: 1_000_000,
        budget_max: 10_000_000,
        is_handled: true,
      },
    ])
    if (reqErr) throw reqErr

    await page.goto('/admin/listings/new')
    const title = zzTitle('BT match-alerts')
    await page.locator('#lf-title').fill(title)
    await page.locator('#lf-category').selectOption('residential_lot')
    await page.locator('#lf-town').selectOption(townId)
    await page.locator('#lf-price').fill('6000000')
    await page.getByRole('button', { name: 'Create draft' }).click()
    await page.waitForURL(/\/admin\/listings\/[0-9a-f-]{36}$/)
    listingId = page.url().split('/').pop()!
  })

  test.afterAll(async () => {
    const staff = await staffDirectClient()

    // Leave the listing withdrawn (BT finding: once a listing carries verification_events
    // it cannot be DELETEd — the FK is RESTRICT and staff has no DELETE grant on that
    // table either; see the BT report). Withdrawing it is what actually matters for
    // residue: price_history is only anon-readable while the listing is live/sold, so a
    // withdrawn listing's history rows are no longer public even though the rows persist.
    if (listingId) {
      const { error: withdrawErr } = await staff.from('listings').update({ status: 'withdrawn' }).eq('id', listingId)
      if (withdrawErr) console.warn('[BT cleanup] listing withdraw failed:', withdrawErr.message)
    }

    const { error } = await staff
      .from('property_requests')
      .delete()
      .in('email', [emailSuccess, emailNeverSent, emailNoMatch, emailHandled])
    if (error) console.warn('[BT cleanup] property_requests delete failed:', error.message)

    await page.context().close()
  })

  test('AC-12/13/14: publishing sends alerts only to the matching, open, un-lifetime-capped requests, and never fails the publish', async () => {
    const sinceMs = Date.now()
    await publishThroughAdminUi(page, listingId)

    const staff = await staffDirectClient()
    const { data: listing } = await staff.from('listings').select('slug, status').eq('id', listingId).single()
    expect(listing!.status).toBe('live')
    slug = listing!.slug

    // after() runs post-response and inserts its ledger rows BEFORE it sends — wait for
    // the rows first...
    type AlertRow = { sent_at: string | null; property_requests: { email: string } | null }
    let alerts: AlertRow[] = []
    await expect
      .poll(
        async () => {
          const { data } = await staff
            .from('request_match_alerts')
            .select('sent_at, property_requests ( email )')
            .eq('listing_id', listingId)
          alerts = (data ?? []) as unknown as AlertRow[]
          return alerts.length
        },
        { timeout: 15_000, message: 'waiting for sendMatchAlerts() to insert its ledger rows' }
      )
      .toBeGreaterThanOrEqual(2)

    // BT diagnostic: log exactly which emails matched, so an unexpected count is
    // debuggable from the runner output rather than just a number.
    console.log(
      '[BT diag] alert rows for this listing:',
      alerts.map((a) => a.property_requests?.email)
    )

    // ...then give the send-then-stamp loop (two sequential, real network calls to
    // Resend) a fixed grace period. BT finding, NOT asserted on below: this environment's
    // RESEND_API_KEY returned "provider refused the message, status 422" for BOTH
    // recipients on a prior run of this exact test, including `delivered@resend.dev` —
    // Resend's own always-accept sandbox address — right after a live probe showed
    // `x-resend-daily-quota: 6` / `x-resend-monthly-quota: 7` on the response headers.
    // Whether that is a near-exhausted quota, a transient provider issue, or something
    // else, the outcome of any ONE send is not something this suite controls, so the
    // assertions below check the DB ledger's INTERNAL consistency (sent_at set iff
    // Resend's own log shows the message went out) rather than assuming a specific
    // recipient always succeeds. See the BT report's findings for the live evidence.
    await new Promise((r) => setTimeout(r, 6_000))
    const { data: settled } = await staff
      .from('request_match_alerts')
      .select('sent_at, property_requests ( email )')
      .eq('listing_id', listingId)
    alerts = (settled ?? []) as unknown as AlertRow[]

    const byEmail = new Map(alerts.map((a) => [a.property_requests?.email, a.sent_at]))

    // AC-12: matched, open, in-window requests get exactly one row each, regardless of
    // whether the send itself later succeeded.
    expect(byEmail.has(emailSuccess)).toBe(true)
    expect(byEmail.has(emailNeverSent)).toBe(true)
    // Wrong category and already-handled are excluded from the candidate set entirely —
    // this is the matching logic (AC-12), and needs no email to actually go out to prove.
    expect(byEmail.has(emailNoMatch)).toBe(false)
    expect(byEmail.has(emailHandled)).toBe(false)

    // AC-13/R4 (internal consistency, quota-independent): the @example.com row can NEVER
    // have a sent_at — Resend rejects that host outright, every time, by design.
    expect(byEmail.get(emailNeverSent)).toBeNull()

    // Cross-check the "success" row against Resend's own send log (free GET, costs no
    // quota) rather than assuming: sent_at is set if and only if Resend's log shows an
    // accepted message to that address after this publish.
    const loggedAsSent = await resendMessageTo(
      emailSuccess,
      'A new DaScout listing matches your request',
      sinceMs
    )
    if (loggedAsSent) {
      expect(byEmail.get(emailSuccess)).not.toBeNull()
    } else {
      expect(byEmail.get(emailSuccess)).toBeNull()
      console.warn(
        '[BT] emailSuccess (delivered@resend.dev) was NOT accepted by Resend on this run — ' +
          'see the BT report; the ledger correctly recorded it as unsent either way.'
      )
    }
  })

  test('AC-15: the alert email carries listing data + a link, and nothing the requester wrote (skipped with evidence if this run could not get a live send through)', async () => {
    const subject = 'A new DaScout listing matches your request'
    const message = await resendMessageTo(emailSuccess, subject, Date.now() - 10 * 60_000)
    test.skip(
      !message,
      'No message to delivered@resend.dev found in the Resend send log for this run — see the ' +
        'BT report: the account behind RESEND_API_KEY refused at least one live send in this ' +
        'session (422). Content shape (AC-15) is verified by code review of match-alerts.ts ' +
        "alertBody() instead: listing title/town/price/link + a static contact line, nothing " +
        'from the request row.'
    )
    const text = await resendMessageText(message!.id)
    expect(text).toBeTruthy()
    expect(text).toContain(townName)
    expect(text).toContain(`https://dascoutprime.com/property/${slug}`)
    // AC-15: no other request's data. The three OTHER fixture emails must never appear
    // in a message addressed to the successful one.
    expect(text).not.toContain(emailNeverSent)
    expect(text).not.toContain(emailNoMatch)
    expect(text).not.toContain(emailHandled)
    // The team-notification email (a different code path entirely) is the one that
    // writes a "Details:" line from the requester's own notes; its absence here is what
    // makes "no anon-authored request content" true for this message specifically.
    expect(text).not.toContain('Details:')
  })

  test('AC-13/R4 idempotency: withdraw -> relist does not duplicate a row, and retries the unsent one', async () => {
    await page.goto(`/admin/listings/${listingId}`)
    await page.getByRole('button', { name: 'Withdraw from the site' }).click()
    await page.getByRole('button', { name: /Yes — withdraw/i }).click()
    await expect(page.locator('.apanel:has(#lifecycleH) .fmsg.ok')).toContainText('Withdrawn')

    await page.getByRole('button', { name: 'Relist' }).click()
    await page.getByRole('button', { name: /Yes — relist/i }).click()
    await expect(page.locator('.apanel:has(#lifecycleH) .fmsg.ok')).toContainText('Live')

    const staff = await staffDirectClient()
    // Give the second after() run (two more sequential Resend calls) a moment, then
    // assert the row COUNT never grew past 2 — that is the actual idempotency claim
    // (composite PK + ON CONFLICT DO NOTHING): a second `-> live` for the same listing
    // must not create a second row for either request, no matter how the sends go.
    await new Promise((r) => setTimeout(r, 6_000))
    const { data: alerts } = await staff
      .from('request_match_alerts')
      .select('sent_at, property_requests ( email )')
      .eq('listing_id', listingId)
    expect(alerts).toHaveLength(2)

    const byEmail = new Map(
      (alerts as unknown as { sent_at: string | null; property_requests: { email: string } | null }[]).map((a) => [
        a.property_requests?.email,
        a.sent_at,
      ])
    )
    // Guaranteed regardless of quota/provider state: @example.com is rejected by Resend
    // every time, so this row is retried on relist and is STILL unsent — proving the
    // R4 retry path actually re-attempted it rather than treating "row exists" as "done".
    expect(byEmail.get(emailNeverSent)).toBeNull()
  })

  test('AC-16: a price cut writes price_history and is anon-readable; the public homepage renders no market panel and no amounts', async () => {
    // The landing redesign (run-landing-glass) removed the Market Movements panel from
    // the public homepage: amounts are an admin-only surface now. The data layer AC-16
    // guards stay exactly as before — price_history rows and their anon readability feed
    // the admin side — and the public assertion inverts: the panel must be gone.
    const staff = await staffDirectClient()
    const original = 6_000_000
    const dropped = 4_000_000

    await page.goto(`/admin/listings/${listingId}`)
    await page.locator('#lf-price').fill(String(dropped))
    await page.getByRole('button', { name: 'Save details' }).click()
    await expect(page.locator('form.apanel:has(#lf-title) .fmsg.ok')).toContainText('Listing saved')

    const anon = directClient()
    await expect
      .poll(async () => {
        const { data } = await anon.from('price_history').select('old_price, new_price').eq('listing_id', listingId)
        return data?.length ?? 0
      })
      .toBeGreaterThan(0)

    const { data: history } = await anon
      .from('price_history')
      .select('old_price, new_price')
      .eq('listing_id', listingId)
      .order('changed_at', { ascending: false })
      .limit(1)
    expect(Number(history![0].old_price)).toBe(original)
    expect(Number(history![0].new_price)).toBe(dropped)

    const home = await page.context().newPage()
    await home.goto('/')
    await home.waitForLoadState('networkidle')
    await expect(home.locator('#market')).toHaveCount(0)
    await expect(home.getByRole('button', { name: 'Price reduced' })).toHaveCount(0)
    // No peso amount anywhere on the anonymous homepage.
    expect(await home.locator('body').innerText()).not.toContain('₱')
    await home.close()

    void staff
  })

  test('AC-16/R7: price_history still records an increase as the latest change (reduced-state logic feeds admin, not the public page)', async () => {
    const aboveOriginal = 7_000_000 // above both the 6M original and the 4M interim price

    await page.goto(`/admin/listings/${listingId}`)
    await page.locator('#lf-price').fill(String(aboveOriginal))
    await page.getByRole('button', { name: 'Save details' }).click()
    await expect(page.locator('form.apanel:has(#lf-title) .fmsg.ok')).toContainText('Listing saved')

    const anon = directClient()
    await expect
      .poll(async () => {
        const { data } = await anon
          .from('price_history')
          .select('old_price, new_price')
          .eq('listing_id', listingId)
          .order('changed_at', { ascending: false })
          .limit(1)
        return data?.[0]?.new_price ? Number(data[0].new_price) : null
      })
      .toBe(aboveOriginal)
  })
})
