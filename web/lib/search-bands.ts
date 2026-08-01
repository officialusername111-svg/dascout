/**
 * The size bands offered in the search bar. They live outside the client component
 * because the server also needs them, to write the "12 properties · 200 – 500 sqm"
 * status line — values imported across the client boundary arrive as proxies, not data.
 * (Deliberately no price bands: amounts are an admin-only surface on this site.)
 */

export const SIZE_BANDS = [
  { value: '0-200', label: 'Under 200 sqm' },
  { value: '200-500', label: '200 – 500 sqm' },
  { value: '500-2000', label: '500 – 2,000 sqm' },
  { value: '2000-10000', label: '2,000 sqm – 1 ha' },
  { value: '10000-', label: '1 hectare+' },
]
