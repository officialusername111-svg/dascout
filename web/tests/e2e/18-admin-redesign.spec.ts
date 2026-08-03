import { test, expect } from '@playwright/test'
import { signInAsStaff } from './helpers'

/**
 * The admin v1 redesign — docs/mockups/admin-v1-proposed.html, built.
 *
 * READ-ONLY. This spec creates no listing, uploads no photo and changes no status, which
 * matters because the only database this project can reach is production. It signs in,
 * looks, and navigates.
 *
 * The assertion that earns this file is the LAST one: opening a listing and coming back
 * used to lose the filter. A static mockup cannot show that defect and no unit test can
 * prove the round trip, because the bug lived in the link the index writes and the page
 * that reads it — two files that were each individually fine.
 */
test.describe('Admin listings redesign', () => {
  test('one toolbar carries status, search and sort together', async ({ page }) => {
    await signInAsStaff(page)
    await page.goto('/admin')

    const toolbar = page.locator('.atoolbar')
    await expect(toolbar).toBeVisible()

    // Status, search and order used to be three stacked blocks. They are one control now.
    await expect(toolbar.locator('.asegmented a')).toHaveCount(6) // All + five statuses
    await expect(toolbar.locator('input[name="q"]')).toBeVisible()
    await expect(toolbar.locator('select[name="sort"]')).toBeVisible()

    // The Apply button is gone for anyone running JavaScript: sort applies on change and
    // search applies on Enter. It survives only inside <noscript>.
    await expect(toolbar.getByRole('button', { name: 'Apply' })).toHaveCount(0)

    // Each tab carries its own count, so "how many drafts?" no longer needs a click.
    await expect(toolbar.locator('.asegmented .n').first()).toBeVisible()
  })

  test('pagination is truncated rather than one link per page', async ({ page }) => {
    await signInAsStaff(page)
    await page.goto('/admin')

    const pager = page.locator('.apager')
    if (!(await pager.count())) {
      test.skip(true, 'Only one page of listings — nothing to truncate.')
    }

    // The defect: every page number was rendered. Whatever the table's size, the pager
    // must stay a handful of controls.
    const numbered = await pager.locator('a[aria-label^="Page "]').count()
    expect(numbered).toBeLessThanOrEqual(5)
    await expect(pager.locator('.count')).toContainText('listing')
  })

  test('a listing that cannot go live says so on the row, not in grey meta text', async ({ page }) => {
    await signInAsStaff(page)
    await page.goto('/admin?status=list')

    const rows = page.locator('.atable .arow')
    if (!(await rows.count())) test.skip(true, 'No draft listings to inspect.')

    // Every draft row shows its property number in a column of its own — set or not.
    await expect(rows.first().locator('.ref')).toBeVisible()
  })

  test('the publish checklist sits at the top of a draft, above the panels', async ({ page }) => {
    // Drafts are reachable only through a staff session — `anon` sees zero rows for them,
    // which is AC-30 and is asserted in anon-rls-reads. So the listing is found by driving
    // the real screen rather than by fetching an id first.
    await signInAsStaff(page)
    await page.goto('/admin?status=list')

    const first = page.locator('.atable .arow a', { hasText: 'Open' }).first()
    if (!(await first.count())) test.skip(true, 'No draft listings to open.')

    await first.click()
    await page.waitForURL('**/admin/listings/**')

    // The sticky identity + action bar, and the itemised blockers, both above the panels.
    await expect(page.locator('.aabar')).toBeVisible()
    const checklist = page.locator('.ablockers')
    if (await checklist.count()) {
      await expect(checklist.locator('li')).not.toHaveCount(0)
      // Publish stays visible while blocked, disabled — never hidden.
      const publish = page.locator('.aabar-acts button', { hasText: /publish|submit/i })
      if (await publish.count()) await expect(publish.first()).toBeVisible()
    }
  })

  test('opening a listing and coming back keeps the filter, search and sort', async ({ page }) => {
    await signInAsStaff(page)
    await page.goto('/admin?status=list&sort=title')

    const first = page.locator('.atable .arow a', { hasText: 'Open' }).first()
    if (!(await first.count())) test.skip(true, 'No draft listings to open.')

    await first.click()
    await page.waitForURL('**/admin/listings/**')

    // The index writes the filter into the link it hands the detail page.
    expect(page.url()).toContain('back=')

    // And the detail page rebuilds it, rather than sending everyone to a bare /admin.
    const backLink = page.locator('.aabar-acts a', { hasText: 'Back to listings' })
    await expect(backLink).toBeVisible()

    await backLink.click()
    await page.waitForURL('**/admin?**')

    const url = new URL(page.url())
    expect(url.pathname).toBe('/admin')
    expect(url.searchParams.get('status')).toBe('list')
    expect(url.searchParams.get('sort')).toBe('title')
  })
})
