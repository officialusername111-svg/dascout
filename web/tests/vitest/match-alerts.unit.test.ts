import { describe, it, expect } from 'vitest'
import { townMatches, priceMatches, categoryMatches } from '@/lib/match-alerts'

/**
 * Pure unit tests for the three match predicates `sendMatchAlerts` filters candidate
 * requests with (AC-12). No DB, no network — the interesting behaviour here is entirely
 * in the string/number comparisons, not in Supabase.
 */

describe('categoryMatches', () => {
  it('a null (wildcard) request category admits any listing category', () => {
    expect(categoryMatches(null, 'residential_lot')).toBe(true)
    expect(categoryMatches(null, 'farm_land')).toBe(true)
  })

  it('a stated category only admits an exact match', () => {
    expect(categoryMatches('residential_lot', 'residential_lot')).toBe(true)
    expect(categoryMatches('residential_lot', 'farm_land')).toBe(false)
  })
})

describe('priceMatches', () => {
  it('both bounds null (no budget stated) admits any price', () => {
    expect(priceMatches(0, null, null)).toBe(true)
    expect(priceMatches(999_999_999, null, null)).toBe(true)
  })

  it('a floor with no ceiling admits anything at or above it', () => {
    expect(priceMatches(5_000_000, 5_000_000, null)).toBe(true)
    expect(priceMatches(4_999_999, 5_000_000, null)).toBe(false)
  })

  it('a ceiling with no floor admits anything at or below it, floor treated as zero', () => {
    expect(priceMatches(0, null, 6_000_000)).toBe(true)
    expect(priceMatches(6_000_000, null, 6_000_000)).toBe(true)
    expect(priceMatches(6_000_001, null, 6_000_000)).toBe(false)
  })

  it('bounds are inclusive at both ends of a stated range', () => {
    expect(priceMatches(2_000_000, 2_000_000, 6_000_000)).toBe(true)
    expect(priceMatches(6_000_000, 2_000_000, 6_000_000)).toBe(true)
    expect(priceMatches(1_999_999, 2_000_000, 6_000_000)).toBe(false)
    expect(priceMatches(6_000_001, 2_000_000, 6_000_000)).toBe(false)
  })
})

describe('townMatches', () => {
  const polomolok = { name: 'Polomolok', province: 'South Cotabato' }

  it('a null or blank preference is a wildcard — matches everywhere, including no town at all', () => {
    expect(townMatches(null, polomolok)).toBe(true)
    expect(townMatches('', polomolok)).toBe(true)
    expect(townMatches('   ', polomolok)).toBe(true)
    expect(townMatches(null, null)).toBe(true)
  })

  it('an empty-string preference does NOT match everywhere by accident of a bug — it is the deliberate wildcard, still requires the trim/blank check to hold even with no town row', () => {
    // A blank preference must not depend on `town` being non-null; this is the case
    // most likely to regress into "blank matches nothing" if the trim() check moves
    // after a null-town short-circuit.
    expect(townMatches('', null)).toBe(true)
  })

  it('a bare town name matches', () => {
    expect(townMatches('Polomolok', polomolok)).toBe(true)
    expect(townMatches('polomolok', polomolok)).toBe(true) // case-blind
  })

  it('"Town, Province" as typed by a visitor matches', () => {
    expect(townMatches('Polomolok, South Cotabato', polomolok)).toBe(true)
  })

  it('a province-only preference matches every town in that province', () => {
    expect(townMatches('South Cotabato', polomolok)).toBe(true)
    expect(townMatches('south cotabato', polomolok)).toBe(true)
  })

  it('a preference that is a superstring of the town name matches ("gensan area")', () => {
    const gensan = { name: 'General Santos City', province: 'South Cotabato' }
    // town.name is NOT literally contained in "gensan area", but the preference IS
    // (deliberately) a substring the OTHER direction only when town.name contains it —
    // exercise the actual documented case: town name contained in what was typed.
    expect(townMatches('General Santos City area', gensan)).toBe(true)
  })

  it('a short preference that the town name contains also matches (name.includes(wanted))', () => {
    // Someone types "Gensan" for "General Santos City" — neither is a substring of the
    // other under the documented rules, so this must NOT match; it is here to pin the
    // boundary of the fuzzy rule, not to claim it should.
    expect(townMatches('Gensan', { name: 'General Santos City', province: 'South Cotabato' })).toBe(false)
  })

  it('an unrelated town does not match', () => {
    expect(townMatches('Davao City', polomolok)).toBe(false)
  })

  it('a stated preference with no town on the listing does not match (no town = no address to compare)', () => {
    expect(townMatches('Polomolok', null)).toBe(false)
  })
})
