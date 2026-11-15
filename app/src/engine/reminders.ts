/**
 * Local-first reminder planning.
 *
 * This module deliberately has no database or Capacitor dependency. A caller
 * can persist ReminderPlan records wherever appropriate, then materialize a
 * bounded set of one-time native requests. One-time requests are preferable to
 * repeating OS alarms here because they make timezone/DST changes, quiet
 * hours, snoozes, and cycle-estimate revisions deterministic.
 */
import { APP_NAME } from '../lib/appName'

export type ReminderKind =
  | 'cycle-estimate'
  | 'period-log'
  | 'pregnancy-week'
  | 'bbt'
  | 'opk'
  | 'pregnancy-test'
  | 'medication'
  | 'contraception-pill'
  | 'contraception-ring'
  | 'contraception-patch'
  | 'contraception-injection'
  | 'contraception-iud'
  | 'contraception-implant'
  | 'prenatal-vitamin'
  | 'water'
  | 'sleep'
  | 'weight'
  | 'movement'
  | 'journaling'

export type ReminderPermission = 'not-requested' | 'granted' | 'denied'
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7
export type ReminderOccurrenceState = 'scheduled' | 'snoozed' | 'completed' | 'missed'

export interface QuietHours {
  enabled: boolean
  start: string
  end: string
}

export type ReminderRecurrence =
  | { type: 'once'; date: string }
  | { type: 'dates'; dates: string[] }
  | { type: 'daily'; startDate?: string; endDate?: string; every?: number }
  | {
      type: 'weekdays'
      weekdays: IsoWeekday[]
      startDate?: string
      endDate?: string
    }
  | {
      type: 'interval-days'
      startDate: string
      every: number
      endDate?: string
    }
  | {
      type: 'monthly'
      day: number
      startDate?: string
      endDate?: string
    }

export interface ReminderOccurrenceRecord {
  state: Exclude<ReminderOccurrenceState, 'scheduled'>
  changedAt: string
  snoozedUntil?: string
}

export interface ReminderPreview {
  /**
   * `private` never names the category. `category` uses intentionally broad
   * habit wording and still excludes symptoms, results, cycle phase, fertility
   * status, medication names, and pregnancy details.
   */
  mode: 'private' | 'category'
}

export interface ReminderPlan {
  id: string
  kind: ReminderKind
  enabled: boolean
  permission: ReminderPermission
  localTime: string
  timeZone: string
  recurrence: ReminderRecurrence
  quietHours?: QuietHours
  preview?: ReminderPreview
  route?: string
  occurrenceRecords?: Record<string, ReminderOccurrenceRecord>
}

export interface MaterializedReminderRequest {
  id: number
  reminderId: string
  occurrenceKey: string
  kind: ReminderKind
  fireAt: string
  title: string
  body: string
  route: string
  state: 'scheduled' | 'snoozed'
}

export interface MaterializeReminderOptions {
  now: Date
  horizonDays?: number
  limit?: number
}

export interface ReminderOccurrenceStatus {
  state: ReminderOccurrenceState
  changedAt?: string
  snoozedUntil?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const MAX_HORIZON_DAYS = 366
const MAX_REQUESTS = 128
const ID_FLOOR = 100_000
const ID_RANGE = 2_000_000_000

interface LocalDateParts {
  year: number
  month: number
  day: number
}

function assertDate(value: string, label: string): void {
  if (!DATE_RE.test(value)) throw new Error(`${label} must use YYYY-MM-DD.`)
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} is not a valid calendar date.`)
  }
}

function parseTime(value: string, label = 'Reminder time'): [number, number] {
  const match = TIME_RE.exec(value)
  if (!match) throw new Error(`${label} must use HH:MM.`)
  return [Number(match[1]), Number(match[2])]
}

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0)
  } catch {
    throw new Error(`Unknown time zone: ${timeZone}`)
  }
}

function toDateString(parts: LocalDateParts): string {
  return `${parts.year.toString().padStart(4, '0')}-${parts.month
    .toString()
    .padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`
}

function parseDateParts(value: string): LocalDateParts {
  assertDate(value, 'Date')
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}

function addLocalDays(value: string, days: number): string {
  const { year, month, day } = parseDateParts(value)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return toDateString({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  })
}

function localDayDifference(start: string, end: string): number {
  const a = parseDateParts(start)
  const b = parseDateParts(end)
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) /
      86_400_000,
  )
}

function isoWeekday(date: string): IsoWeekday {
  const { year, month, day } = parseDateParts(date)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return (weekday === 0 ? 7 : weekday) as IsoWeekday
}

function localPartsAt(instant: Date, timeZone: string): Required<LocalDateParts> & {
  hour: number
  minute: number
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  }
}

/**
 * Convert a wall-clock time in an IANA zone to an instant. The iterative
 * offset correction handles ordinary DST transitions without a timezone
 * library. If a wall time does not exist (spring-forward), it is advanced to
 * the first representable time after the gap.
 */
export function localDateTimeToInstant(date: string, time: string, timeZone: string): Date {
  assertDate(date, 'Reminder date')
  const [hour, minute] = parseTime(time)
  assertTimeZone(timeZone)
  const { year, month, day } = parseDateParts(date)
  const desired = Date.UTC(year, month - 1, day, hour, minute)
  let guess = desired

  for (let index = 0; index < 4; index += 1) {
    const actual = localPartsAt(new Date(guess), timeZone)
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    )
    const difference = desired - represented
    if (difference === 0) return new Date(guess)
    guess += difference
  }

  const resolved = localPartsAt(new Date(guess), timeZone)
  if (
    toDateString(resolved) === date &&
    resolved.hour * 60 + resolved.minute >= hour * 60 + minute
  ) {
    return new Date(guess)
  }

  // A DST gap can make the requested local minute impossible. Search forward
  // a bounded two-hour gap and choose the first representable later minute.
  for (let minutes = 1; minutes <= 120; minutes += 1) {
    const candidate = new Date(guess + minutes * 60_000)
    const local = localPartsAt(candidate, timeZone)
    if (
      toDateString(local) === date &&
      local.hour * 60 + local.minute >= hour * 60 + minute
    ) {
      return candidate
    }
  }
  return new Date(guess)
}

function localDateAt(instant: Date, timeZone: string): string {
  return toDateString(localPartsAt(instant, timeZone))
}

function validateRecurrence(recurrence: ReminderRecurrence): void {
  switch (recurrence.type) {
    case 'once':
      assertDate(recurrence.date, 'One-time date')
      break
    case 'dates':
      recurrence.dates.forEach((date) => assertDate(date, 'Scheduled date'))
      break
    case 'daily':
      if (recurrence.startDate) assertDate(recurrence.startDate, 'Start date')
      if (recurrence.endDate) assertDate(recurrence.endDate, 'End date')
      if (recurrence.every !== undefined && (!Number.isInteger(recurrence.every) || recurrence.every < 1)) {
        throw new Error('Daily recurrence interval must be a positive integer.')
      }
      if ((recurrence.every ?? 1) > 1 && !recurrence.startDate) {
        throw new Error('Daily intervals longer than one day require a start date.')
      }
      break
    case 'weekdays':
      if (!recurrence.weekdays.length) throw new Error('Choose at least one weekday.')
      if (recurrence.weekdays.some((day) => day < 1 || day > 7)) {
        throw new Error('Weekdays must use ISO values 1–7.')
      }
      if (recurrence.startDate) assertDate(recurrence.startDate, 'Start date')
      if (recurrence.endDate) assertDate(recurrence.endDate, 'End date')
      break
    case 'interval-days':
      assertDate(recurrence.startDate, 'Start date')
      if (recurrence.endDate) assertDate(recurrence.endDate, 'End date')
      if (!Number.isInteger(recurrence.every) || recurrence.every < 1) {
        throw new Error('Interval must be a positive number of days.')
      }
      break
    case 'monthly':
      if (!Number.isInteger(recurrence.day) || recurrence.day < 1 || recurrence.day > 31) {
        throw new Error('Monthly day must be between 1 and 31.')
      }
      if (recurrence.startDate) assertDate(recurrence.startDate, 'Start date')
      if (recurrence.endDate) assertDate(recurrence.endDate, 'End date')
  }
}

export function validateReminderPlan(plan: ReminderPlan): void {
  if (!plan.id.trim()) throw new Error('Reminder ID cannot be empty.')
  parseTime(plan.localTime)
  assertTimeZone(plan.timeZone)
  validateRecurrence(plan.recurrence)
  if (plan.quietHours?.enabled) {
    parseTime(plan.quietHours.start, 'Quiet-hours start')
    parseTime(plan.quietHours.end, 'Quiet-hours end')
  }
}

function dateMatchesRecurrence(date: string, recurrence: ReminderRecurrence): boolean {
  switch (recurrence.type) {
    case 'once':
      return date === recurrence.date
    case 'dates':
      return recurrence.dates.includes(date)
    case 'daily': {
      if (recurrence.startDate && date < recurrence.startDate) return false
      if (recurrence.endDate && date > recurrence.endDate) return false
      const anchor = recurrence.startDate ?? date
      return localDayDifference(anchor, date) % (recurrence.every ?? 1) === 0
    }
    case 'weekdays':
      return (
        (!recurrence.startDate || date >= recurrence.startDate) &&
        (!recurrence.endDate || date <= recurrence.endDate) &&
        recurrence.weekdays.includes(isoWeekday(date))
      )
    case 'interval-days': {
      if (date < recurrence.startDate || (recurrence.endDate && date > recurrence.endDate)) {
        return false
      }
      return localDayDifference(recurrence.startDate, date) % recurrence.every === 0
    }
    case 'monthly': {
      if (recurrence.startDate && date < recurrence.startDate) return false
      if (recurrence.endDate && date > recurrence.endDate) return false
      return parseDateParts(date).day === recurrence.day
    }
  }
}

function shiftOutOfQuietHours(
  date: string,
  time: string,
  quietHours?: QuietHours,
): { date: string; time: string } {
  if (!quietHours?.enabled || quietHours.start === quietHours.end) return { date, time }
  const [hour, minute] = parseTime(time)
  const [startHour, startMinute] = parseTime(quietHours.start)
  const [endHour, endMinute] = parseTime(quietHours.end)
  const value = hour * 60 + minute
  const start = startHour * 60 + startMinute
  const end = endHour * 60 + endMinute

  if (start < end) {
    return value >= start && value < end ? { date, time: quietHours.end } : { date, time }
  }
  if (value >= start) return { date: addLocalDays(date, 1), time: quietHours.end }
  if (value < end) return { date, time: quietHours.end }
  return { date, time }
}

function copyFor(kind: ReminderKind, mode: ReminderPreview['mode'] = 'private'): {
  title: string
  body: string
} {
  if (mode === 'private') {
    return { title: APP_NAME, body: 'A gentle moment to check in with yourself.' }
  }
  switch (kind) {
    case 'medication':
    case 'contraception-pill':
    case 'contraception-ring':
    case 'contraception-patch':
    case 'contraception-injection':
    case 'contraception-iud':
    case 'contraception-implant':
    case 'prenatal-vitamin':
      return { title: 'Lunara reminder', body: 'It is time for a routine you scheduled.' }
    case 'water':
      return { title: 'Lunara reminder', body: 'A hydration check-in is ready.' }
    case 'sleep':
      return { title: 'Lunara reminder', body: 'Your wind-down check-in is ready.' }
    case 'weight':
    case 'movement':
      return { title: 'Lunara reminder', body: 'Your wellness check-in is ready.' }
    case 'journaling':
      return { title: 'Lunara reminder', body: 'A quiet reflection is ready when you are.' }
    case 'pregnancy-week':
      return { title: 'Lunara update', body: 'Your weekly update is ready.' }
    case 'cycle-estimate':
    case 'period-log':
    case 'bbt':
    case 'opk':
    case 'pregnancy-test':
      // This wording intentionally makes no claim about fertility, pregnancy,
      // contraception safety, test timing, or the meaning of a cycle estimate.
      return { title: 'Lunara check-in', body: 'A check-in you scheduled is ready.' }
  }
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function notificationId(key: string, used: Set<number>): number {
  let id = ID_FLOOR + (fnv1a(key) % ID_RANGE)
  while (used.has(id)) {
    id += 1
    if (id >= ID_FLOOR + ID_RANGE) id = ID_FLOOR
  }
  used.add(id)
  return id
}

function scheduledDates(
  plan: ReminderPlan,
  from: Date,
  through: Date,
): Array<{ date: string; occurrenceKey: string }> {
  let date = addLocalDays(localDateAt(from, plan.timeZone), -1)
  const endDate = addLocalDays(localDateAt(through, plan.timeZone), 1)
  const dates: Array<{ date: string; occurrenceKey: string }> = []
  while (date <= endDate) {
    if (dateMatchesRecurrence(date, plan.recurrence)) {
      dates.push({ date, occurrenceKey: `${plan.id}:${date}:${plan.localTime}` })
    }
    date = addLocalDays(date, 1)
  }
  return dates
}

/**
 * Read the explicit record first, otherwise classify an elapsed occurrence as
 * missed after the supplied grace period.
 */
export function reminderOccurrenceStatus(
  plan: ReminderPlan,
  occurrenceKey: string,
  scheduledFor: Date,
  now: Date,
  graceMinutes = 120,
): ReminderOccurrenceStatus {
  const record = plan.occurrenceRecords?.[occurrenceKey]
  if (record) return { ...record }
  return now.getTime() > scheduledFor.getTime() + graceMinutes * 60_000
    ? { state: 'missed' }
    : { state: 'scheduled' }
}

/**
 * Apply a local lifecycle action without mutating the original plan. Snoozes
 * are bounded to 5 minutes–24 hours and materialization still applies quiet
 * hours to the resulting instant.
 */
export function updateReminderOccurrence(
  plan: ReminderPlan,
  occurrenceKey: string,
  action: 'complete' | 'miss' | 'snooze' | 'reset',
  changedAt: Date,
  snoozeMinutes = 15,
): ReminderPlan {
  const occurrenceRecords = { ...(plan.occurrenceRecords ?? {}) }
  if (action === 'reset') {
    delete occurrenceRecords[occurrenceKey]
  } else if (action === 'snooze') {
    const minutes = Math.max(5, Math.min(24 * 60, Math.round(snoozeMinutes)))
    occurrenceRecords[occurrenceKey] = {
      state: 'snoozed',
      changedAt: changedAt.toISOString(),
      snoozedUntil: new Date(changedAt.getTime() + minutes * 60_000).toISOString(),
    }
  } else {
    occurrenceRecords[occurrenceKey] = {
      state: action === 'complete' ? 'completed' : 'missed',
      changedAt: changedAt.toISOString(),
    }
  }
  return { ...plan, occurrenceRecords }
}

function quietAdjustedSnooze(plan: ReminderPlan, snoozedUntil: string): Date {
  const instant = new Date(snoozedUntil)
  if (Number.isNaN(instant.getTime())) throw new Error('Snoozed time is invalid.')
  const local = localPartsAt(instant, plan.timeZone)
  const shifted = shiftOutOfQuietHours(
    toDateString(local),
    `${local.hour.toString().padStart(2, '0')}:${local.minute.toString().padStart(2, '0')}`,
    plan.quietHours,
  )
  return localDateTimeToInstant(shifted.date, shifted.time, plan.timeZone)
}

/**
 * Expand plans into a deterministic, sorted, bounded list of one-time
 * notification requests.
 */
export function materializeReminderRequests(
  plans: ReminderPlan[],
  options: MaterializeReminderOptions,
): MaterializedReminderRequest[] {
  const horizonDays = Math.max(
    1,
    Math.min(MAX_HORIZON_DAYS, Math.round(options.horizonDays ?? 60)),
  )
  const limit = Math.max(1, Math.min(MAX_REQUESTS, Math.round(options.limit ?? 64)))
  const fromMs = options.now.getTime()
  const through = new Date(fromMs + horizonDays * 86_400_000)
  const candidates: Omit<MaterializedReminderRequest, 'id'>[] = []

  for (const plan of [...plans].sort((a, b) => a.id.localeCompare(b.id))) {
    validateReminderPlan(plan)
    if (!plan.enabled || plan.permission !== 'granted') continue
    for (const scheduled of scheduledDates(plan, options.now, through)) {
      const shifted = shiftOutOfQuietHours(scheduled.date, plan.localTime, plan.quietHours)
      let fireAt = localDateTimeToInstant(shifted.date, shifted.time, plan.timeZone)
      const record = plan.occurrenceRecords?.[scheduled.occurrenceKey]
      let state: MaterializedReminderRequest['state'] = 'scheduled'
      if (record?.state === 'completed' || record?.state === 'missed') continue
      if (record?.state === 'snoozed') {
        if (!record.snoozedUntil) continue
        fireAt = quietAdjustedSnooze(plan, record.snoozedUntil)
        state = 'snoozed'
      }
      if (fireAt.getTime() <= fromMs || fireAt.getTime() > through.getTime()) continue
      const copy = copyFor(plan.kind, plan.preview?.mode)
      candidates.push({
        reminderId: plan.id,
        occurrenceKey: scheduled.occurrenceKey,
        kind: plan.kind,
        fireAt: fireAt.toISOString(),
        title: copy.title,
        body: copy.body,
        route: plan.route ?? 'today',
        state,
      })
    }
  }

  const used = new Set<number>()
  return candidates
    .sort(
      (a, b) =>
        a.fireAt.localeCompare(b.fireAt) ||
        a.reminderId.localeCompare(b.reminderId) ||
        a.occurrenceKey.localeCompare(b.occurrenceKey),
    )
    .slice(0, limit)
    .map((request) => ({
      ...request,
      id: notificationId(`${request.reminderId}|${request.occurrenceKey}|${request.fireAt}`, used),
    }))
}
