import '../styles/brand.css'
import { APP_NAME } from '../lib/appName'

export const LUNARA_CRESCENT_PATH =
  'M49.2 5.8C39.1 9.4 31.9 19.1 31.9 30.5c0 12.3 8.7 22.6 20.3 25A28.8 28.8 0 0 1 32 63C14.9 63 1 49.1 1 32S14.9 1 32 1c6.3 0 12.2 1.9 17.2 4.8Z'

interface LunaraMarkProps {
  className?: string
  decorative?: boolean
  label?: string
  size?: number
}

/**
 * The canonical Lunara brand mark.
 *
 * Keep the geometry in sync with the source SVGs under app/brand when native
 * launcher or splash assets are regenerated.
 */
export function LunaraMark({
  className = '',
  decorative = false,
  label = APP_NAME,
  size = 32,
}: LunaraMarkProps) {
  return (
    <svg
      className={`lunara-crescent${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      focusable="false"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
    >
      <path d={LUNARA_CRESCENT_PATH} fill="currentColor" />
    </svg>
  )
}
