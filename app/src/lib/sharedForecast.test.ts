import { describe, expect, it } from 'vitest'
import { createDefaultHealthProfile } from '../db/schema'
import { addDays, predict } from '../engine/cycle'
import { forecastDayKind, forecastOn, type ForecastSource } from './sharedForecast'

const TODAY = '2026-11-15'

function source(periodStarts: string[]): ForecastSource {
  const profile = createDefaultHealthProfile('2026-11-01T12:00:00.000Z')
  profile.cycle.typicalCycleLength = 28
  return { periodStarts, ovulations: [], positiveOpkDates: [], profile }
}

/** What the Calendar marks for the days around today. */
function calendarMarks(source: ForecastSource) {
  const prediction = forecastOn(source, TODAY).prediction
  return Array.from({ length: 70 }, (_, index) => addDays(TODAY, index - 20)).map((day) => ({
    day,
    kind: forecastDayKind(prediction, day, 5),
  }))
}

describe('one forecast for Today and the Calendar (blind test round 2, M3)', () => {
  it('log a period start today: Today and the Calendar agree', () => {
    // The onboarding period start was 10 days ago; the person logs a new period start today.
    const before = source(['2026-11-05'])
    const after = source(['2026-11-05', TODAY])

    // Today reads the forecast for the selected day (today); the Calendar reads it for today.
    // Each screen reads the database on its own, so each one has its own copy of the inputs.
    const todayScreen = forecastOn(after, TODAY)
    const calendarScreen = forecastOn(source([...after.periodStarts]), TODAY)
    expect(calendarScreen.prediction).toEqual(todayScreen.prediction)

    // The Calendar's first predicted period day is the day Today names.
    const marks = calendarMarks(after)
    expect(todayScreen.prediction.nextPeriodStart).not.toBeNull()
    expect(marks.find((mark) => mark.kind === 'predicted')?.day).toBe(todayScreen.prediction.nextPeriodStart)
    // No fertile window in the past: after a period start today, the fertile days come later.
    const fertile = marks.filter((mark) => mark.kind === 'fertile' || mark.kind === 'ovulation')
    expect(fertile.length).toBeGreaterThan(0)
    for (const mark of fertile) expect(mark.day > TODAY).toBe(true)

    // The new log changed the forecast for both screens.
    expect(forecastOn(before, TODAY).prediction.nextPeriodStart).not.toBe(todayScreen.prediction.nextPeriodStart)
  })

  it('the old Calendar engine disagreed with Today in this case (the bug)', () => {
    const after = source(['2026-11-05', TODAY])
    const old = predict({ periodStarts: [...after.periodStarts], ovulations: [], today: TODAY }, { baselineCycleLength: 28 })
    expect(old.nextPeriodStart).not.toBe(forecastOn(after, TODAY).prediction.nextPeriodStart)
  })

  it('one cache: the same inputs give the same result object; changed inputs compute again', () => {
    const first = forecastOn(source(['2026-10-18', TODAY]), TODAY)
    expect(forecastOn(source(['2026-10-18', TODAY]), TODAY)).toBe(first)
    expect(forecastOn(source(['2026-10-18', '2026-11-14']), TODAY)).not.toBe(first)
  })

  it('a day counts only the data on or before it', () => {
    const all = source(['2026-10-18', TODAY])
    expect(forecastOn(all, '2026-11-10').prediction).toEqual(forecastOn(source(['2026-10-18']), '2026-11-10').prediction)
  })
})
