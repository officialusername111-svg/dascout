/**
 * The budget box on the request form, turned into two numbers.
 *
 * People do not type numbers into a budget field. They type "₱2M – ₱6M", "5m",
 * "1,500,000", "2M+". This is the one place that reads any of that, so the shape the
 * database stores and the shape the match filter compares can never drift apart.
 *
 * Three decisions are worth stating, because they are not obvious from the code:
 *
 * - A single bare value is a CEILING, not a floor: someone who writes "5M" is saying
 *   what they can spend, not what they refuse to spend below. A trailing `+` is the
 *   explicit way to say the other thing.
 * - Empty is not an error. The field is optional, so blank means "no budget stated"
 *   and comes back as two nulls.
 * - A range whose low end is above its high end is REFUSED rather than silently
 *   swapped. Swapping would quietly change what somebody asked for, and the database
 *   check constraint would refuse the row anyway; the caller turns this into a field
 *   error the person can see and fix.
 *
 * Pure — no request context, no database — so the action and the unit tests share it.
 */

export type BudgetRange = { min: number | null; max: number | null }

const MULTIPLIERS: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 }

/** One amount: an optional peso marker, digits, optional decimals, optional k/m/b. */
const AMOUNT = /^(?:₱|php)?\s*(\d+(?:\.\d+)?)\s*([kmb])?$/i

/** The three dashes people actually type, and the word. */
const RANGE_SEPARATOR = /\s*(?:–|—|-|\bto\b)\s*/i

function parseAmount(token: string): number | null {
  const match = AMOUNT.exec(token.trim())
  if (!match) return null

  const digits = Number(match[1])
  if (!Number.isFinite(digits)) return null

  const multiplier = match[2] ? MULTIPLIERS[match[2].toLowerCase()] : 1
  // Centavo rounding kills the float noise "1.1m" would otherwise store as
  // 1100000.0000000002 in a numeric column.
  const value = Math.round(digits * multiplier * 100) / 100

  return Number.isFinite(value) ? value : null
}

/**
 * `{ min, max }` for anything understood, `null` for anything not.
 *
 * `null` is the caller's signal to raise a field error. Blank input is understood and
 * returns two nulls.
 */
export function parsePesoBudget(input: string): BudgetRange | null {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return { min: null, max: null }

  // Thousands separators are noise everywhere in the grammar.
  const cleaned = trimmed.replace(/,/g, '')
  const parts = cleaned.split(RANGE_SEPARATOR)

  if (parts.length > 2) return null

  if (parts.length === 2) {
    const min = parseAmount(parts[0])
    const max = parseAmount(parts[1])
    if (min === null || max === null) return null
    if (min > max) return null
    return { min, max }
  }

  const single = parts[0]

  if (single.endsWith('+')) {
    const min = parseAmount(single.slice(0, -1))
    return min === null ? null : { min, max: null }
  }

  const max = parseAmount(single)
  return max === null ? null : { min: null, max }
}

/** How a stored range reads back to staff and in the team notification. */
export function describeBudget(
  min: number | null,
  max: number | null,
  money: (amount: number) => string
): string {
  if (min !== null && max !== null) return `${money(min)} – ${money(max)}`
  if (min !== null) return `${money(min)} and up`
  if (max !== null) return `up to ${money(max)}`
  return 'not stated'
}
