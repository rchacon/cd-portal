// Small line icons shared by the user menu and the settings nav. Each
// takes a `className` for sizing/colour; stroke is `currentColor`, so
// leaving colour off lets it inherit from the surrounding text.

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

export function UsageIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <path d="M4 20V10M12 20V4M20 20v-7" />
    </svg>
  )
}

export function LogOutIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  )
}
