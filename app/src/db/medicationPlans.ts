import { addDays, daysBetween, type ISODate } from '../engine/cycle'

/**
 * Birth control and medication plans with dates.
 *
 * Written from the requirements in docs/CURRENT_PROGRESS_AND_ROADMAP.md
 * ("Contraception and medication regimen"): the method, the first and last day, a label the person typed (product or
 * dose), an on/off schedule (pill pack, patch, ring), a renewal interval
 * (injection, implant, IUD), dose entries (taken, late, missed, taken the next
 * day), and which plan was in effect on a past day, so that old logs are read
 * with the plan of their time.
 *
 * Data model and pure helpers only. All of it stays on the phone.
 */

export type PlanMethod =
  | 'pill'
  | 'patch'
  | 'ring'
  | 'injection'
  | 'implant'
  | 'hormonal-iud'
  | 'copper-iud'
  | 'other-medication'

export interface OnOffSchedule {
  /** Days with the pill, patch or ring in use. */
  daysOn: number
  /** Break days after them (0 = continuous use). */
  daysOff: number
}

export interface MedicationPlan {
  id: string
  method: PlanMethod
  /** As the person typed it: a product name or a dose. Optional. */
  label?: string
  /** First day of the plan. */
  firstDay: ISODate
  /** Last day of the plan. Not set: still in use. */
  lastDay?: ISODate
  schedule?: OnOffSchedule
  /** Injection, implant or IUD: renew or replace after this many days. */
  renewAfterDays?: number
  createdAt: string
}

/**
 * One dose day. `next-day` is a dose taken a day late, entered as a
 * correction on the following day.
 */
export type DoseOutcome = 'taken' | 'late' | 'missed' | 'next-day'

export interface DoseEntry {
  id: string
  planId: string
  day: ISODate
  outcome: DoseOutcome
  enteredAt: string
}

/** Dexie stores for these records (db/schema.ts, version 4). */
export const MEDICATION_PLAN_STORES = {
  medicationPlans: 'id, method, firstDay',
  doseEntries: 'id, planId, day, [planId+day]',
} as const

const HORMONE_METHODS: ReadonlySet<PlanMethod> = new Set(['pill', 'patch', 'ring', 'injection', 'implant', 'hormonal-iud'])

/** Hormonal methods pause the fertile-window and ovulation forecast. A copper IUD does not. */
export function pausesFertilityForecast(method: PlanMethod): boolean {
  return HORMONE_METHODS.has(method)
}

function includesDay(plan: MedicationPlan, day: ISODate): boolean {
  return plan.firstDay <= day && (plan.lastDay === undefined || day <= plan.lastDay)
}

/**
 * The plan in effect on `day`. When two plans share a day (a change entered late),
 * the plan with the latest first day wins.
 */
export function planInEffect(plans: readonly MedicationPlan[], day: ISODate): MedicationPlan | undefined {
  let best: MedicationPlan | undefined
  for (const plan of plans) {
    if (includesDay(plan, day) && (!best || plan.firstDay > best.firstDay)) best = plan
  }
  return best
}

export interface ScheduleDay {
  /** 1-based day in the current round (pack, patch or ring round). */
  dayInRound: number
  inUse: boolean
}

/** Where `day` falls in an on/off schedule. Null without a schedule or outside the plan. */
export function scheduleOn(plan: MedicationPlan, day: ISODate): ScheduleDay | null {
  if (!plan.schedule || !includesDay(plan, day)) return null
  const roundLength = plan.schedule.daysOn + plan.schedule.daysOff
  if (roundLength <= 0) return null
  const offset = daysBetween(plan.firstDay, day) % roundLength
  return { dayInRound: offset + 1, inUse: offset < plan.schedule.daysOn }
}

/** The next renew or replace day on or after `today`, or null when the plan has no interval or has ended. */
export function nextRenewalDay(plan: MedicationPlan, today: ISODate): ISODate | null {
  const every = plan.renewAfterDays
  if (!every || every <= 0) return null
  if (plan.lastDay !== undefined && plan.lastDay < today) return null
  if (today <= plan.firstDay) return addDays(plan.firstDay, every)
  const done = Math.floor(daysBetween(plan.firstDay, today) / every)
  const due = addDays(plan.firstDay, (done + 1) * every)
  return plan.lastDay !== undefined && due > plan.lastDay ? null : due
}

/** Doses that need attention: missed, or not entered on an in-use day before `today`. */
export function daysToCheck(plan: MedicationPlan, entries: readonly DoseEntry[], today: ISODate, lookBackDays = 7): ISODate[] {
  const entered = new Map(entries.filter((entry) => entry.planId === plan.id).map((entry) => [entry.day, entry.outcome]))
  const out: ISODate[] = []
  for (let back = lookBackDays; back >= 1; back--) {
    const day = addDays(today, -back)
    if (!includesDay(plan, day)) continue
    const position = scheduleOn(plan, day)
    if (position && !position.inUse) continue
    const outcome = entered.get(day)
    if (outcome === undefined || outcome === 'missed') out.push(day)
  }
  return out
}

/** Problems that stop a plan from being saved. Empty: the plan is valid. */
export function planProblems(plan: MedicationPlan): string[] {
  const problems: string[] = []
  if (plan.lastDay !== undefined && plan.lastDay < plan.firstDay) problems.push('The last day is before the first day.')
  if (plan.schedule) {
    const { daysOn, daysOff } = plan.schedule
    if (!Number.isInteger(daysOn) || daysOn < 1) problems.push('Days in use must be 1 or more.')
    if (!Number.isInteger(daysOff) || daysOff < 0) problems.push('Break days must be 0 or more.')
  }
  if (plan.renewAfterDays !== undefined && (!Number.isInteger(plan.renewAfterDays) || plan.renewAfterDays < 1)) {
    problems.push('The renewal interval must be 1 day or more.')
  }
  if (plan.label !== undefined && plan.label.length > 80) problems.push('The label can have 80 characters at most.')
  return problems
}
