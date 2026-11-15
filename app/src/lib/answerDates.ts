import { addDays, type ISODate } from '../engine/cycle'

/**
 * Dates in AI answers (blind test round 2, H1).
 *
 * Lunara never sends today's date: the tracker summary has only relative days
 * (lib/aiPayload.ts). So a model that writes a calendar date guesses it. The
 * system prompt (DATE_RULES) asks for placeholders instead:
 *   [[day:+18]]          one day, 18 days from today ([[day:0]] today, [[day:-3]] 3 days ago)
 *   [[range:+13..+23]]   the days from 13 to 23 days from today
 * The app replaces them on the phone with the person's local dates (renderAnswerDates).
 * The chat history keeps the placeholders, so no real date leaves the phone.
 *
 * A date that the model writes anyway (a month name with a day, a month after
 * "in"/"by"/..., an ISO or numeric date with a year, "on Monday") is a guess:
 * guardAnswerDates() removes it. A date in brackets after a relative phrase
 * ("in 18 days (about May 11)") goes away without a trace; any other date becomes
 * "[date left out]" and the answer gets one note that says why.
 */

/** Added to the system prompt. It has no calendar date and no month name. */
export const DATE_RULES = `Dates:
- You do not know today's date. Never write a calendar date, a month name, a weekday name or a year.
- Write each point in time relative to today with these exact forms, which Lunara replaces with the person's local dates: [[day:+18]] for one day (18 days from today), [[day:0]] for today, [[day:-3]] for 3 days ago, and [[range:+13..+23]] for a span of days (13 to 23 days from today).
- For a length of time, write a number of days or weeks, for example "about 5 days".`

export const DATE_LEFT_OUT = '[date left out]'

export const DATES_LEFT_OUT_NOTE =
  'Lunara AI does not know today’s date, so Lunara left out the dates that it guessed. Your dates are on Today and in the Calendar.'

const MAX_OFFSET = 3660

const MONTH =
  '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\\.?'
const FULL_MONTH_NOT_MAY =
  '(?:January|February|March|April|June|July|August|September|October|November|December)'
const DAY = '\\d{1,2}(?:st|nd|rd|th)?'
const YEAR = '(?:,?\\s+(?:19|20)\\d{2})?'
const SEP = '\\s*(?:–|—|-|to|through|until|and)\\s*'
const WEEKDAY = '(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)'
const ISO = '(?:19|20)\\d{2}-\\d{2}-\\d{2}'

/** Every form of a guessed date. Case-sensitive: "you may" is not the month. */
const DATE_FORMS = [
  // May 11, May 11–12, May 6 to May 16, May 11th, 2026
  `\\b${MONTH}\\s+${DAY}(?:${SEP}(?:${MONTH}\\s+)?${DAY})?${YEAR}\\b`,
  // 11 May, 11–12 May, 11th of May 2026
  `\\b${DAY}(?:${SEP}${DAY})?\\s+(?:of\\s+)?${MONTH}${YEAR}\\b`,
  // 2026-11-26, 2026-11-26-2026-12-10, 2026-11-26 to 2026-12-10
  `\\b${ISO}(?:${SEP}${ISO})?\\b`,
  // 11/26/2026, 26.11.2026 (a numeric date only with a year: "24/7" and "1/2" stay)
  `\\b\\d{1,2}[/.]\\d{1,2}[/.](?:19|20)?\\d{2}\\b`,
  // mid-December, early May, in December, by Nov, until next March
  `\\b(?:(?:in|by|until|around|before|after|during|since|from|through|of)\\s+(?:next\\s+|this\\s+|early\\s+|late\\s+|mid-?\\s*)?|(?:early|late|mid)-?\\s*)${MONTH}(?:${YEAR})\\b`,
  // a full month name alone (not "May", which is also a verb)
  `\\b${FULL_MONTH_NOT_MAY}\\b`,
  // on Monday, by Friday, next Tuesday (not "on Mondays": that is a habit, not a date)
  `\\b(?:on|by|until|next|this|coming)\\s+${WEEKDAY}(?!s)\\b`,
]
const DATE = new RegExp(DATE_FORMS.join('|'), 'g')
const HAS_DATE = new RegExp(DATE_FORMS.join('|'))
const BRACKETED = /\s*\(([^()]*)\)/g

const DAY_PLACEHOLDER = /\[\[\s*day\s*:\s*([+-]?\s*\d{1,4})\s*\]\]/gi
const RANGE_PLACEHOLDER = /\[\[\s*range\s*:\s*([+-]?\s*\d{1,4})\s*(?:\.\.|–|—|-|to)\s*([+-]?\s*\d{1,4})\s*\]\]/gi

export interface GuardedAnswer {
  text: string
  /** True when a guessed date was replaced with DATE_LEFT_OUT (the note was added). */
  leftOut: boolean
}

/** Removes the calendar dates that a model guessed. Placeholders stay. */
export function guardAnswerDates(answer: string): GuardedAnswer {
  // A date in brackets ("in 18 days (roughly May 11–12)") only repeats the relative day: remove the brackets.
  let text = answer.replace(BRACKETED, (all, inside: string) => (HAS_DATE.test(inside) ? '' : all))
  let leftOut = false
  text = text.replace(DATE, (match: string) => {
    leftOut = true
    // Keep a leading preposition, so the sentence still reads: "from [date left out]".
    const keep = /^(?:in|by|until|around|before|after|during|since|from|through|of|on)\s+/.exec(match)?.[0] ?? ''
    return `${keep}${DATE_LEFT_OUT}`
  })
  if (leftOut && !text.includes(DATES_LEFT_OUT_NOTE)) text = `${text.trimEnd()}\n\n${DATES_LEFT_OUT_NOTE}`
  return { text, leftOut }
}

function offsetOf(raw: string): number | null {
  const value = Number(raw.replace(/\s+/g, ''))
  return Number.isInteger(value) && Math.abs(value) <= MAX_OFFSET ? value : null
}

/** A local date for an answer: "Dec 3", with the year when it is not this year. */
export function answerDate(day: ISODate, today: ISODate, locale?: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (day.slice(0, 4) !== today.slice(0, 4)) options.year = 'numeric'
  return new Date(y, m - 1, d).toLocaleDateString(locale, options)
}

/** Replaces [[day:+N]] and [[range:+A..+B]] with the local dates, counted from `today`. */
export function renderAnswerDates(answer: string, today: ISODate, locale?: string): string {
  return answer
    .replace(RANGE_PLACEHOLDER, (_all, a: string, b: string) => {
      const first = offsetOf(a)
      const last = offsetOf(b)
      if (first === null || last === null) return 'days that Lunara could not read'
      const [from, to] = first <= last ? [first, last] : [last, first]
      if (from === to) return answerDate(addDays(today, from), today, locale)
      return `${answerDate(addDays(today, from), today, locale)} – ${answerDate(addDays(today, to), today, locale)}`
    })
    .replace(DAY_PLACEHOLDER, (_all, raw: string) => {
      const offset = offsetOf(raw)
      return offset === null ? 'a day that Lunara could not read' : answerDate(addDays(today, offset), today, locale)
    })
}

/** What the chat shows for an answer: guessed dates removed, placeholders replaced. */
export function answerForDisplay(answer: string, today: ISODate, locale?: string): string {
  return renderAnswerDates(guardAnswerDates(answer).text, today, locale)
}
