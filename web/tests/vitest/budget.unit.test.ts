import { describe, it, expect } from 'vitest'
import { describeBudget, parsePesoBudget } from '@/lib/budget'

/**
 * Pure unit tests — no DB, no network. `lib/budget.ts` is what stands between what a
 * visitor types in the budget box and the two numeric columns the match filter compares,
 * so the interesting cases here are the ones a person actually types.
 */

describe('parsePesoBudget — blank', () => {
  it.each(['', '   ', '\t\n'])('%j is not an error, it is "no budget stated"', (input) => {
    expect(parsePesoBudget(input)).toEqual({ min: null, max: null })
  })
})

describe('parsePesoBudget — a single value is a ceiling', () => {
  it.each([
    ['5000000', 5_000_000],
    ['5,000,000', 5_000_000],
    ['₱5,000,000', 5_000_000],
    ['PHP 5000000', 5_000_000],
    ['php5000000', 5_000_000],
    ['5m', 5_000_000],
    ['5M', 5_000_000],
    ['5 M', 5_000_000],
    ['₱2.5M', 2_500_000],
    ['800k', 800_000],
    ['800K', 800_000],
    ['1.2b', 1_200_000_000],
    ['  ₱ 1.5 m  ', 1_500_000],
    ['0', 0],
  ])('%s -> max %d', (input, expected) => {
    expect(parsePesoBudget(input)).toEqual({ min: null, max: expected })
  })
})

describe('parsePesoBudget — a trailing plus is a floor', () => {
  it.each([
    ['2M+', 2_000_000],
    ['2,000,000+', 2_000_000],
    ['₱2m +', 2_000_000],
    ['500k+', 500_000],
  ])('%s -> min %d', (input, expected) => {
    expect(parsePesoBudget(input)).toEqual({ min: expected, max: null })
  })
})

describe('parsePesoBudget — ranges', () => {
  it.each([
    ['₱2M – ₱6M', 2_000_000, 6_000_000],
    ['2M-6M', 2_000_000, 6_000_000],
    ['2M — 6M', 2_000_000, 6_000_000],
    ['2m to 6m', 2_000_000, 6_000_000],
    ['2M TO 6M', 2_000_000, 6_000_000],
    ['1,500,000 - 2,500,000', 1_500_000, 2_500_000],
    ['800k–1.2m', 800_000, 1_200_000],
    ['PHP 3M to PHP 4M', 3_000_000, 4_000_000],
    ['5M - 5M', 5_000_000, 5_000_000],
  ])('%s -> %d..%d', (input, min, max) => {
    expect(parsePesoBudget(input)).toEqual({ min, max })
  })
})

describe('parsePesoBudget — refusals', () => {
  it.each([
    'about five million',
    'ASAP',
    'up to 5M', // "up" is not an amount — the caller shows a field error
    '5M - ',
    '- 5M',
    '1M - 2M - 3M',
    '5M+ - 8M', // a plus only means "and up" on a single value
    '-5M',
    '5x',
    '5mm',
    '₱',
    'PHP',
    '2..5M',
    '1e9',
  ])('%j is refused', (input) => {
    expect(parsePesoBudget(input)).toBeNull()
  })

  it('refuses a range whose low end is above its high end — it never swaps them', () => {
    expect(parsePesoBudget('6M – 2M')).toBeNull()
    expect(parsePesoBudget('6,000,000 to 2,000,000')).toBeNull()
  })

  // Gap found in the BD suite (R13: "at least/up to" phrases are refused, not parsed as
  // min/max-only) — "up to 5M" was covered but its "at least" counterpart was not, and it
  // is the more tempting one to accidentally special-case since "5M+" already means the
  // same thing structurally.
  it.each(['at least 5M', 'at least ₱5M', 'minimum 5M', 'atleast5M'])(
    '%j is refused — only a trailing "+" is the min-only spelling, not a leading phrase',
    (input) => {
      expect(parsePesoBudget(input)).toBeNull()
    }
  )
})

describe('parsePesoBudget — decimals land on whole centavos', () => {
  it('1.1m does not carry float noise into the numeric column', () => {
    expect(parsePesoBudget('1.1m')).toEqual({ min: null, max: 1_100_000 })
  })

  it('keeps two decimal places and no more', () => {
    expect(parsePesoBudget('1234.567')).toEqual({ min: null, max: 1234.57 })
  })
})

describe('describeBudget', () => {
  const money = (amount: number) => `P${amount}`

  it('reads both ends when both are stated', () => {
    expect(describeBudget(1, 2, money)).toBe('P1 – P2')
  })

  it('reads open-ended in either direction', () => {
    expect(describeBudget(1, null, money)).toBe('P1 and up')
    expect(describeBudget(null, 2, money)).toBe('up to P2')
  })

  it('says so plainly when there is no budget', () => {
    expect(describeBudget(null, null, money)).toBe('not stated')
  })
})
