/**
 * The price and size bands offered in the search bar. They live outside the client
 * component because the server also needs them, to write the "12 properties · ₱2M – ₱5M"
 * status line — values imported across the client boundary arrive as proxies, not data.
 */

export const PRICE_BANDS = [
  { value: '0-2000000', label: 'Under ₱2M' },
  { value: '2000000-5000000', label: '₱2M – ₱5M' },
  { value: '5000000-15000000', label: '₱5M – ₱15M' },
  { value: '15000000-40000000', label: '₱15M – ₱40M' },
  { value: '40000000-', label: '₱40M+' },
]

export const SIZE_BANDS = [
  { value: '0-200', label: 'Under 200 sqm' },
  { value: '200-500', label: '200 – 500 sqm' },
  { value: '500-2000', label: '500 – 2,000 sqm' },
  { value: '2000-10000', label: '2,000 sqm – 1 ha' },
  { value: '10000-', label: '1 hectare+' },
]
