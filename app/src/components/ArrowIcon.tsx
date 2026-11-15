/**
 * An arrow in the app's line-icon style (blind test round 2, L7). The text arrows
 * "↗ → ↑ ↓" can show as colored emoji on iOS; this stroke icon follows the text color.
 */
const PATHS = {
  'up-right': 'M7 17 17 7M9 7h8v8',
  right: 'M5 12h14m-6-6 6 6-6 6',
  up: 'M12 19V5m-6 6 6-6 6 6',
  down: 'M12 5v14m-6-6 6 6 6-6',
} as const

export type ArrowDirection = keyof typeof PATHS

export function ArrowIcon({ direction = 'up-right', size = '1em' }: { direction?: ArrowDirection; size?: number | string }) {
  return (
    <svg
      className="arrow-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'inline-block', verticalAlign: '-0.125em', flex: '0 0 auto' }}
    >
      <path d={PATHS[direction]} />
    </svg>
  )
}
