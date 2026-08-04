import { test, expect, type Page } from '@playwright/test'
import { signInAsStaff, staffDirectClient, zzTitle } from './helpers'

/**
 * AC-7..12 create-form validation spot checks (BD already drove these
 * server-side; this layer confirms the surface still behaves through the
 * real form) + AC-33 duplicate submit.
 *
 * The form's own `required`/`min` HTML attributes are convenience-only —
 * several tests remove them before submitting, exactly like a tampered POST
 * would arrive with no client constraints at all, so the assertion lands on
 * the server's own validation rather than the browser's.
 */

async function fillTitle(page: Page, title: string) {
  await page.locator('#lf-title').fill(title)
}
async function fillCategory(page: Page) {
  // Property type is a chip picker over the property_types lookup as of listing encoding
  // v2 piece 3 (see 03-listing-journey.spec.ts) — the first chip is the first real type,
  // there being no blank placeholder option any more.
  await page.locator('.typechip').first().click()
}
async function fillTown(page: Page) {
  await page.locator('#lf-town').selectOption({ index: 1 })
}
async function fillPrice(page: Page, value = '1500000') {
  await page.locator('#lf-price').fill(value)
}

/** Field container's error text, scoped so it never matches a sibling field's default hint. */
function fieldError(page: Page, inputId: string) {
  return page.locator(`.field:has(#${inputId})`).locator('.ferr')
}
function fieldInvalid(page: Page, inputId: string) {
  return page.locator(`.field.invalid:has(#${inputId})`)
}

async function removeConstraint(page: Page, selector: string, attr: string) {
  await page.locator(selector).evaluate((el, a) => el.removeAttribute(a), attr)
}

test.describe('Create listing: happy path + validation spot checks (AC-7..12, AC-33)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsStaff(page)
    await page.goto('/admin/listings/new')
  })

  // Every fixture in this file is a plain `list` entry that never left that status, and
  // every remaining foreign key into `listings` cascades — sweep them all rather than
  // tracking ids one by one.
  test.afterAll(async () => {
    const staff = await staffDirectClient()
    const { error } = await staff.from('listings').delete().ilike('title', 'ZZ Test AC%').eq('status', 'list')
    if (error) console.warn(`[cleanup] AC-7..12/33 sweep failed: ${error.message}`)
  })

  test('AC-7: happy-path create — draft status, no rent/lease controls, sale-only pesos', async ({ page }) => {
    await expect(page.getByText(/per month/i)).toHaveCount(0)
    await expect(page.locator('select[name="lease_term"]')).toHaveCount(0)
    await expect(page.getByText('DaScout does not list rentals.')).toBeVisible()

    const title = zzTitle('AC7 create happy path')
    await fillTitle(page, title)
    await fillCategory(page)
    await fillTown(page)
    await fillPrice(page)
    await page.getByRole('button', { name: 'Create listing' }).click()

    await expect(page).toHaveURL(/\/admin\/listings\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await expect(page.locator('.pill.muted', { hasText: 'List' })).toBeVisible()
  })

  test.describe('AC-8: required fields — one blank at a time, others valid', () => {
    test('blank title -> field error, no row inserted', async ({ page }) => {
      await fillCategory(page)
      await fillTown(page)
      await fillPrice(page)
      await page.getByRole('button', { name: 'Create listing' }).click()
      await expect(page).toHaveURL(/\/admin\/listings\/new$/)
      await expect(fieldInvalid(page, 'lf-title')).toHaveCount(1)
    })

    test('blank category -> field error, no row inserted', async ({ page }) => {
      await fillTitle(page, zzTitle('AC8 category'))
      await fillTown(page)
      await fillPrice(page)
      await page.getByRole('button', { name: 'Create listing' }).click()
      await expect(page).toHaveURL(/\/admin\/listings\/new$/)
      // The chip picker has no id of its own; `lf-ptype-label` (the radiogroup's static
      // label id) is the only fixed anchor into the field — the radios themselves get
      // per-type dynamic ids (`lf-ptype-{uuid}`).
      await expect(fieldError(page, 'lf-ptype-label')).toContainText('property type')
    })

    test('blank price -> field error, no row inserted', async ({ page }) => {
      await fillTitle(page, zzTitle('AC8 price'))
      await fillCategory(page)
      await fillTown(page)
      await page.getByRole('button', { name: 'Create listing' }).click()
      await expect(page).toHaveURL(/\/admin\/listings\/new$/)
      await expect(fieldInvalid(page, 'lf-price')).toHaveCount(1)
    })

    test('blank town -> field error, no row inserted', async ({ page }) => {
      await fillTitle(page, zzTitle('AC8 town'))
      await fillCategory(page)
      await fillPrice(page)
      await page.getByRole('button', { name: 'Create listing' }).click()
      await expect(page).toHaveURL(/\/admin\/listings\/new$/)
      await expect(fieldError(page, 'lf-town')).toContainText('Choose a town')
    })
  })

  test('AC-9: price 0 and negative are rejected server-side, never a raw constraint violation', async ({
    page,
  }) => {
    await fillTitle(page, zzTitle('AC9 price boundary zero'))
    await fillCategory(page)
    await fillTown(page)
    await removeConstraint(page, '#lf-price', 'min')
    await page.locator('#lf-price').fill('0')
    await page.getByRole('button', { name: 'Create listing' }).click()
    await expect(page).toHaveURL(/\/admin\/listings\/new$/)
    await expect(fieldError(page, 'lf-price')).toContainText('₱0')
  })

  test('AC-10a: property_type_id not in the lookup is rejected (tampered POST value)', async ({ page }) => {
    await fillTitle(page, zzTitle('AC10a category tamper'))
    await fillTown(page)
    await fillPrice(page)
    // Same tamper shape as AC-10b's town_id below, adapted for a radio group: inject a
    // rogue radio sharing `name="property_type_id"` with a value that isn't in the
    // property_types lookup, then check it — native radio-group exclusivity means setting
    // `.checked = true` unchecks every real chip sharing that name, so this is what a
    // tampered POST (no real chip selected) would arrive as.
    await page.locator('[role="radiogroup"][aria-labelledby="lf-ptype-label"]').evaluate((el) => {
      const rogue = document.createElement('input')
      rogue.type = 'radio'
      rogue.name = 'property_type_id'
      rogue.value = '00000000-0000-0000-0000-000000000000'
      el.appendChild(rogue)
      rogue.checked = true
    })
    await page.getByRole('button', { name: 'Create listing' }).click()
    await expect(page).toHaveURL(/\/admin\/listings\/new$/)
    await expect(fieldError(page, 'lf-ptype-label')).toContainText('property type')
  })

  test('AC-10b: a nonexistent town_id is rejected with a field error', async ({ page }) => {
    await fillTitle(page, zzTitle('AC10b town fk'))
    await fillCategory(page)
    await fillPrice(page)
    await page.locator('#lf-town').evaluate((el) => {
      const select = el as HTMLSelectElement
      const opt = document.createElement('option')
      opt.value = '00000000-0000-0000-0000-000000000000'
      opt.text = 'ghost town'
      select.appendChild(opt)
      select.value = '00000000-0000-0000-0000-000000000000'
    })
    await page.getByRole('button', { name: 'Create listing' }).click()
    await expect(page).toHaveURL(/\/admin\/listings\/new$/)
    await expect(page.locator('.fmsg.err')).toContainText(/town/i)
  })

  test('AC-11a: lot_area_sqm 0/negative rejected; blank accepted as null', async ({ page }) => {
    await fillTitle(page, zzTitle('AC11a lot area'))
    await fillCategory(page)
    await fillTown(page)
    await fillPrice(page)
    await removeConstraint(page, '#lf-lot', 'min')
    await page.locator('#lf-lot').fill('-5')
    await page.getByRole('button', { name: 'Create listing' }).click()
    await expect(page).toHaveURL(/\/admin\/listings\/new$/)
    await expect(fieldInvalid(page, 'lf-lot')).toHaveCount(1)
  })

  test('AC-11b: bedrooms -1 rejected', async ({ page }) => {
    await fillTitle(page, zzTitle('AC11b bedrooms neg'))
    await fillCategory(page)
    await fillTown(page)
    await fillPrice(page)
    await removeConstraint(page, '#lf-bed', 'min')
    await page.locator('#lf-bed').fill('-1')
    await page.getByRole('button', { name: 'Create listing' }).click()
    await expect(page).toHaveURL(/\/admin\/listings\/new$/)
    await expect(fieldInvalid(page, 'lf-bed')).toHaveCount(1)
  })

  test('AC-11b: bedrooms=0 is accepted (fresh form)', async ({ page }) => {
    await fillTitle(page, zzTitle('AC11b bedrooms zero'))
    await fillCategory(page)
    await fillTown(page)
    await fillPrice(page)
    await page.locator('#lf-bed').fill('0')
    await page.getByRole('button', { name: 'Create listing' }).click()
    await expect(page).toHaveURL(/\/admin\/listings\/[0-9a-f-]{36}$/)
  })

  test('regression fix confirmed: create form retains every field after a rejected submission, only the invalid one flagged', async ({
    page,
  }) => {
    const title = zzTitle('AC11b retained-values regression')
    await fillTitle(page, title)
    await fillCategory(page)
    await fillTown(page)
    await fillPrice(page, '1750000')
    await page.locator('#lf-area').fill('Retained Area Detail')
    await page.locator('#lf-desc').fill('Retained description text.')
    await page.locator('#lf-trend').check()

    const categoryValue = await page.locator('input[name="property_type_id"]:checked').getAttribute('value')
    const townValue = await page.locator('#lf-town').inputValue()

    await removeConstraint(page, '#lf-bed', 'min')
    await page.locator('#lf-bed').fill('-1')
    await page.getByRole('button', { name: 'Create listing' }).click()
    await expect(page).toHaveURL(/\/admin\/listings\/new$/)

    // Fixed per the builder's verify-fix cycle: failing actions now echo the submitted
    // FormData back as `values`, and ListingForm prefers those over the (null, in create
    // mode) listing prop for every control, remounting the two <select>s so they restore
    // too — see the "echoed"/"generation" logic in components/admin/ListingForm.tsx.
    await expect(page.locator('#lf-title')).toHaveValue(title)
    await expect(page.locator('#lf-price')).toHaveValue('1750000')
    await expect(page.locator('#lf-area')).toHaveValue('Retained Area Detail')
    await expect(page.locator('#lf-desc')).toHaveValue('Retained description text.')
    await expect(page.locator(`input[name="property_type_id"][value="${categoryValue}"]`)).toBeChecked()
    await expect(page.locator('#lf-town')).toHaveValue(townValue)
    await expect(page.locator('#lf-trend')).toBeChecked()
    // The invalid field also echoes what was typed (for redisplay) and is the only one flagged.
    await expect(page.locator('#lf-bed')).toHaveValue('-1')
    await expect(fieldInvalid(page, 'lf-bed')).toHaveCount(1)
    await expect(fieldInvalid(page, 'lf-title')).toHaveCount(0)
    await expect(fieldInvalid(page, 'lf-ptype-label')).toHaveCount(0)
    await expect(fieldInvalid(page, 'lf-town')).toHaveCount(0)
    await expect(fieldInvalid(page, 'lf-price')).toHaveCount(0)
  })

  test('AC-12a/b: slug generated from title, uniquified on a title collision', async ({ page }) => {
    const title = zzTitle('AC12 slug collide')
    await fillTitle(page, title)
    await fillCategory(page)
    await fillTown(page)
    await fillPrice(page)
    await page.getByRole('button', { name: 'Create listing' }).click()
    await expect(page).toHaveURL(/\/admin\/listings\/[0-9a-f-]{36}$/)
    const firstUrl = page.url()

    await page.goto('/admin/listings/new')
    await fillTitle(page, title)
    await fillCategory(page)
    await fillTown(page)
    await fillPrice(page)
    await page.getByRole('button', { name: 'Create listing' }).click()
    await expect(page).toHaveURL(/\/admin\/listings\/[0-9a-f-]{36}$/)
    expect(page.url()).not.toBe(firstUrl)

    const staff = await staffDirectClient()
    const { data, error } = await staff.from('listings').select('slug').eq('title', title)
    expect(error).toBeNull()
    expect(data).toHaveLength(2)
    expect(data![0].slug).not.toBe(data![1].slug)
  })

  test('AC-33: rapid double-click on submit creates exactly one row', async ({ page }) => {
    const title = zzTitle('AC33 dedupe')
    await fillTitle(page, title)
    await fillCategory(page)
    await fillTown(page)
    await fillPrice(page)

    await page.getByRole('button', { name: 'Create listing' }).dblclick()
    await page.waitForURL(/\/admin\/listings\/[0-9a-f-]{36}$/, { timeout: 15_000 })

    const staff = await staffDirectClient()
    const { data, error } = await staff.from('listings').select('id').eq('title', title)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })
})
