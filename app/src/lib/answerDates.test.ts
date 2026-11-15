import { describe, expect, it } from 'vitest'
import {
  answerForDisplay,
  DATE_LEFT_OUT,
  DATE_RULES,
  DATES_LEFT_OUT_NOTE,
  guardAnswerDates,
  renderAnswerDates,
} from './answerDates'

const TODAY = '2026-11-15'

describe('AI answer dates: placeholders become local dates on the phone (blind test round 2, H1)', () => {
  it('replaces [[day:+N]] with the local date', () => {
    expect(renderAnswerDates('Your next period may start around [[day:+18]].', TODAY, 'en-US')).toBe(
      'Your next period may start around Dec 3.',
    )
    expect(renderAnswerDates('[[day:0]] and [[day:-3]] and [[day: 2]]', TODAY, 'en-US')).toBe('Nov 15 and Nov 12 and Nov 17')
  })

  it('replaces [[range:+A..+B]] with "Nov 28 – Dec 8"', () => {
    expect(renderAnswerDates('Fertile window: [[range:+13..+23]].', TODAY, 'en-US')).toBe('Fertile window: Nov 28 – Dec 8.')
    expect(renderAnswerDates('[[range:+23..+13]] [[range:+5..+5]] [[range: -2 - +1]]', TODAY, 'en-US')).toBe(
      'Nov 28 – Dec 8 Nov 20 Nov 13 – Nov 16',
    )
  })

  it('adds the year only when the date is in another year', () => {
    expect(renderAnswerDates('[[day:+50]]', TODAY, 'en-US')).toBe('Jan 4, 2027')
  })

  it('the system prompt rule has no calendar date and no month name', () => {
    expect(DATE_RULES).toContain('[[day:+18]]')
    expect(DATE_RULES).toContain('[[range:+13..+23]]')
    expect(DATE_RULES).not.toMatch(/\b(19|20)\d{2}\b|January|February|March|April|June|July|August|September|October|November|December|\bMay \d/)
  })
})

describe('AI answer dates: guessed dates are left out (the guard)', () => {
  it('removes a date in brackets after a relative day without a note', () => {
    const guarded = guardAnswerDates('Your period may start 18 days from today (roughly May 11–12).')
    expect(guarded).toEqual({ text: 'Your period may start 18 days from today.', leftOut: false })
  })

  it('replaces any other guessed date and adds one note', () => {
    const guarded = guardAnswerDates('Your fertile window is about May 6 to May 16. Test from mid-December, or on Monday.')
    expect(guarded.leftOut).toBe(true)
    expect(guarded.text).toBe(
      `Your fertile window is about ${DATE_LEFT_OUT}. Test from ${DATE_LEFT_OUT}, or on ${DATE_LEFT_OUT}.\n\n${DATES_LEFT_OUT_NOTE}`,
    )
  })

  it('finds every form: day first, ordinals, years, ISO, numeric with a year, a bare month', () => {
    for (const answer of [
      'around 11 May',
      'on the 3rd of December 2026',
      'Nov 26, 2026',
      'from 2026-11-26-2026-12-10',
      'on 11/26/2026',
      'in December',
      'by Sept 4',
      'late Jan',
    ]) {
      const guarded = guardAnswerDates(answer)
      expect(guarded.leftOut, answer).toBe(true)
      expect(guarded.text, answer).not.toMatch(/\b(19|20)\d{2}\b|December|Sept|Jan\b|May \d|\d May|Nov \d/)
    }
  })

  it('keeps ordinary words and numbers: "you may", "24/7", "1/2", "on Mondays", durations', () => {
    const answer = 'You may bleed for 5 days. Cramps can last 1/2 a day; support is 24/7. Rest on Mondays. A cycle of 28 days is common.'
    expect(guardAnswerDates(answer)).toEqual({ text: answer, leftOut: false })
  })

  it('keeps the placeholders, so the history sends no real date', () => {
    const answer = 'Around [[day:+18]]; window [[range:+13..+23]].'
    expect(guardAnswerDates(answer).text).toBe(answer)
  })

  it('what the chat shows: guard first, then the local dates', () => {
    expect(answerForDisplay('Next period: [[day:+18]] (about May 11).', TODAY, 'en-US')).toBe('Next period: Dec 3.')
  })
})
