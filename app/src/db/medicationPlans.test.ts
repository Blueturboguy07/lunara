import { describe, expect, it } from 'vitest'
import {
  daysToCheck,
  nextRenewalDay,
  pausesFertilityForecast,
  planInEffect,
  planProblems,
  scheduleOn,
  type DoseEntry,
  type MedicationPlan,
} from './medicationPlans'
import { db } from './schema'

const pack: MedicationPlan = {
  id: 'p1',
  method: 'pill',
  firstDay: '2026-01-01',
  schedule: { daysOn: 21, daysOff: 7 },
  createdAt: '2026-01-01T08:00:00.000Z',
}

describe('birth control and medication plans', () => {
  it('finds the plan of a past day, so old logs are read with the plan of their time', () => {
    const before: MedicationPlan = { ...pack, id: 'old', firstDay: '2025-06-01', lastDay: '2025-12-31' }
    const ringPlan: MedicationPlan = { ...pack, id: 'new', method: 'ring', firstDay: '2026-03-01' }
    const plans = [before, pack, ringPlan]
    expect(planInEffect(plans, '2025-05-31')).toBeUndefined()
    expect(planInEffect(plans, '2025-09-10')?.id).toBe('old')
    expect(planInEffect(plans, '2026-02-10')?.id).toBe('p1')
    // Two plans on one day: the plan that started last wins.
    expect(planInEffect(plans, '2026-03-05')?.id).toBe('new')
  })

  it('a 21/7 pack: day in the round and break days', () => {
    expect(scheduleOn(pack, '2026-01-01')).toEqual({ dayInRound: 1, inUse: true })
    expect(scheduleOn(pack, '2026-01-21')).toEqual({ dayInRound: 21, inUse: true })
    expect(scheduleOn(pack, '2026-01-22')).toEqual({ dayInRound: 22, inUse: false })
    expect(scheduleOn(pack, '2026-01-29')).toEqual({ dayInRound: 1, inUse: true }) // the next pack
    expect(scheduleOn(pack, '2025-12-31')).toBeNull()
    expect(scheduleOn({ ...pack, schedule: undefined }, '2026-01-05')).toBeNull()
  })

  it('renewal: injection every 84 days, never after the last day', () => {
    const shot: MedicationPlan = { id: 's', method: 'injection', firstDay: '2026-01-01', renewAfterDays: 84, createdAt: '' }
    expect(nextRenewalDay(shot, '2025-12-01')).toBe('2026-03-26')
    expect(nextRenewalDay(shot, '2026-02-01')).toBe('2026-03-26')
    expect(nextRenewalDay(shot, '2026-03-26')).toBe('2026-06-18')
    expect(nextRenewalDay({ ...shot, lastDay: '2026-05-01' }, '2026-04-01')).toBeNull()
    expect(nextRenewalDay({ ...shot, lastDay: '2026-02-01' }, '2026-03-01')).toBeNull()
    expect(nextRenewalDay(pack, '2026-02-01')).toBeNull()
  })

  it('days to check: missed or not entered, never a break day', () => {
    const entries: DoseEntry[] = [
      { id: 'a', planId: 'p1', day: '2026-01-15', outcome: 'taken', enteredAt: '' },
      { id: 'b', planId: 'p1', day: '2026-01-16', outcome: 'missed', enteredAt: '' },
      { id: 'c', planId: 'p1', day: '2026-01-17', outcome: 'next-day', enteredAt: '' },
      { id: 'd', planId: 'other', day: '2026-01-18', outcome: 'taken', enteredAt: '' },
    ]
    // 01-14 has no entry, 01-16 is missed, 01-18 has no entry for this plan.
    expect(daysToCheck(pack, entries, '2026-01-19', 5)).toEqual(['2026-01-14', '2026-01-16', '2026-01-18'])
    // Days 22–28 of the round are break days.
    expect(daysToCheck(pack, [], '2026-01-29', 7)).toEqual([])
  })

  it('hormonal methods pause the fertility forecast; a copper IUD does not', () => {
    expect(pausesFertilityForecast('pill')).toBe(true)
    expect(pausesFertilityForecast('hormonal-iud')).toBe(true)
    expect(pausesFertilityForecast('copper-iud')).toBe(false)
    expect(pausesFertilityForecast('other-medication')).toBe(false)
  })

  it('refuses a plan that cannot be right', () => {
    expect(planProblems(pack)).toEqual([])
    expect(planProblems({ ...pack, lastDay: '2025-12-01' })).toEqual(['The last day is before the first day.'])
    expect(planProblems({ ...pack, schedule: { daysOn: 0, daysOff: -1 } })).toHaveLength(2)
    expect(planProblems({ ...pack, renewAfterDays: 0 })).toEqual(['The renewal interval must be 1 day or more.'])
    expect(planProblems({ ...pack, label: 'x'.repeat(81) })).toHaveLength(1)
  })

  it('the database is version 4 with the plan tables and without the version 3 tables', () => {
    expect(db.verno).toBe(4)
    // Exactly these tables: a table from version 3 is not listed, so Dexie deletes it on the upgrade.
    expect(db.tables.map((table) => table.name).sort()).toEqual(
      ['contentBookmarks', 'cycles', 'dailyLogs', 'doseEntries', 'healthProfiles', 'medicationPlans', 'settings'],
    )
  })
})
