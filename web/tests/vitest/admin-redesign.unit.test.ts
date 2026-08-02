import { describe, it, expect } from 'vitest'
import { backHrefFrom, filterQuery, pageWindow, withParams } from '@/lib/admin/navigation'
import { checklistChips, publishBlockersFor, publishChecklistFor } from '@/lib/admin/queries'

/**
 * The admin v1 redesign — the three pieces of logic behind it that are easy to get quietly
 * wrong, and one invariant that must survive every future change to the checklist.
 *
 * Pure functions only. Nothing here touches the database.
 */

describe('backHrefFrom — "Back to listings" keeps the filter', () => {
  it('restores the filter, search, sort and page it was given', () => {
    expect(backHrefFrom('status=draft&q=dacera&sort=title&page=3')).toBe(
      '/admin?status=draft&q=dacera&sort=title&page=3'
    )
  })

  it('falls back to the bare list when there is nothing to restore', () => {
    expect(backHrefFrom(undefined)).toBe('/admin')
    expect(backHrefFrom('')).toBe('/admin')
  })

  it('keeps the attention filter, which is a filter like any other', () => {
    expect(backHrefFrom('attn=1')).toBe('/admin?attn=1')
  })

  /**
   * The open-redirect case. `back` arrives in a URL and is therefore attacker-controlled:
   * a link to /admin/listings/<id>?back=//evil.example.com would put a link to someone
   * else's site inside the admin panel under our own "Back to listings" label. The result
   * must be a path under /admin whatever arrives, which is why the implementation rebuilds
   * from an allowlist instead of validating a string.
   */
  it.each([
    '//evil.example.com',
    'https://evil.example.com',
    '/../../etc/passwd',
    'status=draft&next=https://evil.example.com',
    'javascript:alert(1)',
  ])('never emits anything outside /admin for %s', (hostile) => {
    const href = backHrefFrom(hostile)
    expect(href.startsWith('/admin')).toBe(true)
    expect(href).not.toContain('evil.example.com')
    expect(href).not.toContain('javascript:')
  })

  it('drops unknown keys rather than passing them through', () => {
    expect(backHrefFrom('status=live&role=admin&debug=1')).toBe('/admin?status=live')
  })
})

describe('pageWindow — pagination is truncated, not one link per page', () => {
  it('lists every page while they still fit', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3])
  })

  it('collapses the middle of a long list', () => {
    // The defect this replaces: 40 pages used to render 40 links.
    expect(pageWindow(1, 40)).toEqual([1, 2, 'gap', 40])
    expect(pageWindow(20, 40)).toEqual([1, 'gap', 19, 20, 21, 'gap', 40])
    expect(pageWindow(40, 40)).toEqual([1, 'gap', 39, 40])
  })

  it('never emits a gap that hides a single page', () => {
    // 1 … 3 would be silly when 2 is the only thing behind the ellipsis.
    expect(pageWindow(3, 4)).toEqual([1, 2, 3, 4])
  })

  it('copes with a single page and with the count being the current page', () => {
    expect(pageWindow(1, 1)).toEqual([1])
    expect(pageWindow(5, 5)).toEqual([1, 'gap', 4, 5])
  })
})

describe('filterQuery / withParams', () => {
  it('keeps the other filters when one of them changes', () => {
    const current = { status: 'draft', q: 'lot', sort: 'title', page: '2' }
    expect(withParams(current, { page: '3' })).toBe('/admin?status=draft&q=lot&sort=title&page=3')
  })

  it('drops a filter asked to be dropped', () => {
    expect(withParams({ status: 'draft', page: '2' }, { status: undefined })).toBe('/admin?page=2')
  })

  it('ignores blank and array-valued params rather than emitting empty keys', () => {
    expect(filterQuery({ status: '  ', q: undefined, sort: ['title', 'x'] })).toBe('sort=title')
  })
})

describe('the publish checklist', () => {
  const complete = { titleChecks: 1, groundValidations: 1, photoCount: 3, primaryCount: 1 }

  it('marks every hard item done on a complete listing', () => {
    const items = publishChecklistFor({ ...complete, propertyNo: 'DS-0142' })
    expect(items.every((item) => item.done)).toBe(true)
    expect(checklistChips(items)).toEqual([])
  })

  it('reports a missing cover photo but not "no photos" when photos exist', () => {
    const items = publishChecklistFor({ ...complete, primaryCount: 0, propertyNo: 'DS-1' })
    expect(checklistChips(items)).toEqual(['No cover photo'])
  })

  it('reports one gap, not two, when there are no photos at all', () => {
    // With nothing uploaded, "no cover photo" is the same fact said twice.
    const items = publishChecklistFor({
      ...complete,
      photoCount: 0,
      primaryCount: 0,
      propertyNo: 'DS-1',
    })
    expect(checklistChips(items)).toEqual(['No photos'])
  })

  it('surfaces a missing property number', () => {
    const items = publishChecklistFor({ ...complete, propertyNo: null })
    expect(checklistChips(items)).toEqual(['No property number'])
  })

  it('does not ask about a cover photo before any photo exists', () => {
    // The first build listed "☐ At least one photo uploaded" beside "☑ Cover photo
    // chosen", which is nonsense on a listing with nothing uploaded.
    const items = publishChecklistFor({
      ...complete,
      photoCount: 0,
      primaryCount: 0,
      propertyNo: 'DS-1',
    })
    expect(items.map((item) => item.id)).not.toContain('cover-photo')

    const withPhotos = publishChecklistFor({ ...complete, primaryCount: 0, propertyNo: 'DS-1' })
    expect(withPhotos.map((item) => item.id)).toContain('cover-photo')
  })

  /**
   * THE INVARIANT. The owner's decision is that a missing property number is a prompt, not
   * a gate: it shows in the checklist and it must never stop a listing going live. The
   * checklist and the blockers are two functions on purpose so this cannot drift, and this
   * test is what catches it if someone later "tidies" them back together.
   *
   * `guard_listing_publish` in the database enforces the same set a third time — see §2 of
   * 20260802131500_property_number_and_role_audit.sql for why it was left out there too.
   */
  it('never lets a soft item become a publish blocker', () => {
    const noNumber = { ...complete, propertyNo: null }

    expect(publishBlockersFor(complete)).toEqual([])
    expect(publishBlockersFor(noNumber)).toEqual([])

    const soft = publishChecklistFor(noNumber).filter((item) => !item.required)
    expect(soft).toHaveLength(1)
    expect(soft[0].id).toBe('property-no')
    expect(soft[0].done).toBe(false)

    // Nothing advisory may ever appear in the list that disables the publish button.
    const blockers = publishBlockersFor(noNumber).join(' ')
    for (const item of soft) expect(blockers).not.toContain(item.label)
  })

  it('still blocks on every hard item, so the redesign did not loosen the gate', () => {
    expect(
      publishBlockersFor({ titleChecks: 0, groundValidations: 0, photoCount: 0, primaryCount: 0 })
    ).toEqual([
      'No title check has been recorded.',
      'No ground validation has been recorded.',
      'The listing has no photos.',
    ])
  })
})
