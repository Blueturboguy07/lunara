export function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function formatShort(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/**
 * A day range for a person: "Nov 26 – Dec 10", never "2026-11-26-2026-12-10"
 * (blind test round 2, L5). The year shows only when a day is not in this year.
 */
export function formatRange(start: string, end: string, today: string = localToday(), locale?: string): string {
  const show = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
    if (iso.slice(0, 4) !== today.slice(0, 4)) options.year = 'numeric'
    return new Date(y, m - 1, d).toLocaleDateString(locale, options)
  }
  return start === end ? show(start) : `${show(start)} – ${show(end)}`
}
