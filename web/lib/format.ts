const PESO = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
})

/** ₱2,900,000 — the full price, as the listing pages show it. */
export function peso(amount: number): string {
  return PESO.format(amount).replace('PHP', '₱')
}

/** ₱2.9M — the compact price used in the hero card and the ranked rows. */
export function shortPeso(amount: number): string {
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000
    return `₱${millions.toFixed(amount % 1_000_000 === 0 ? 0 : 1)}M`
  }
  if (amount >= 1_000) return `₱${Math.round(amount / 1_000)}K`
  return peso(amount)
}

const SQM = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 })

/** Areas read in hectares once they pass a hectare, the way the listings are written. */
export function area(sqm: number): string {
  if (sqm >= 10_000) {
    const ha = sqm / 10_000
    return `${ha.toFixed(ha % 1 === 0 ? 0 : 1)} ha`
  }
  return `${SQM.format(sqm)} sqm`
}

/** "3 minutes ago" / "2 days ago" for the browsing history. */
export function timeAgo(timestamp: number): string {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

/** 4.2k views — view counts stay readable once they run into the thousands. */
export function compactCount(n: number): string {
  if (n >= 1_000) {
    const k = n / 1_000
    return `${k.toFixed(k >= 10 || k % 1 === 0 ? 0 : 1)}k`
  }
  return String(n)
}

/**
 * "001 - Dacera Heights Corner Lot" — the property number leads the title wherever a
 * listing names itself, so the reference is the first thing read and the first thing
 * quoted back. A listing without a number just shows its title; no separator is left
 * dangling, and no placeholder stands in for a number that does not exist.
 *
 * Deliberately NOT applied on the admin listings index, which has a property-number
 * column of its own — prefixing there would print the same reference twice on one row.
 */
export function displayTitle(propertyNo: string | null | undefined, title: string): string {
  return propertyNo ? `${propertyNo} - ${title}` : title
}
