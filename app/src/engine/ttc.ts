import type { DailyLog } from '../db/schema'
import {
  addDays,
  daysBetween,
  detectBbtShiftEstimates,
  isForecastAnchorLive,
  toEpochDay,
  type ISODate,
  type Prediction,
} from './cycle'
import { formatRange } from '../lib/dates'

export type FertilityBand = 'unknown' | 'lower-estimate' | 'possible' | 'higher'

export interface FertilityDayGuide {
  band: FertilityBand
  label: string
  relativeDay: number | null
  rationale: string
}

export interface PregnancyTestPlan {
  /**
   * @deprecated Lunara does not calculate an app-authored "early" test date.
   * Kept as null while UI callers migrate to suggestedDate.
   */
  earliestDate: ISODate | null
  expectedPeriodDate: ISODate | null
  suggestedDate: ISODate | null
  status: 'unknown' | 'wait' | 'test-window'
  message: string
}

export interface BbtSummary {
  readingsLast30Days: number
  trackingCoverage: number
  shiftEstimateDates: ISODate[]
  latestShiftEstimate: ISODate | null
  /** @deprecated Use shiftEstimateDates; BBT does not confirm ovulation. */
  confirmedShiftDates: ISODate[]
  /** @deprecated Use latestShiftEstimate; BBT does not confirm ovulation. */
  latestConfirmedOvulation: ISODate | null
  status: 'not-started' | 'building-baseline' | 'no-sustained-shift' | 'shift-found'
  explanation: string
}

export interface OpkSummary {
  testsThisCycle: number
  latestPositiveDate: ISODate | null
  likelyWindow: { start: ISODate; end: ISODate } | null
  explanation: string
}

export interface TtcOverview {
  day: FertilityDayGuide
  testPlan: PregnancyTestPlan
  bbt: BbtSummary
  opk: OpkSummary
  fertileWindowSexDays: number
  prenatalVitaminDaysLast14: number
  notes: string[]
}

/**
 * A qualitative calendar guide. It deliberately avoids presenting a numeric
 * chance of conception because calendar estimates cannot know whether or
 * exactly when ovulation occurred.
 */
export function fertilityDayGuide(
  date: ISODate,
  prediction: Pick<Prediction, 'ovulationDate' | 'fertileWindow'>,
): FertilityDayGuide {
  if (!prediction.ovulationDate || !prediction.fertileWindow) {
    return {
      band: 'unknown',
      label: 'More data needed',
      relativeDay: null,
      rationale: 'Lunara needs enough cycle history to estimate an ovulation window.',
    }
  }

  const relativeDay = daysBetween(prediction.ovulationDate, date)
  if (
    toEpochDay(date) < toEpochDay(prediction.fertileWindow.start) ||
    toEpochDay(date) > toEpochDay(prediction.fertileWindow.end)
  ) {
    return {
      band: 'lower-estimate',
      label: 'Outside the estimated window',
      relativeDay,
      rationale:
        'This date sits outside the six-day calendar estimate. Ovulation can move, so this does not mean pregnancy is impossible.',
    }
  }

  if (relativeDay >= -3 && relativeDay <= 0) {
    return {
      band: 'higher',
      label: 'Higher-fertility estimate',
      relativeDay,
      rationale:
        'This date is close to estimated ovulation. The estimate becomes more useful when paired with OPK or sustained BBT data.',
    }
  }

  return {
    band: 'possible',
    label: 'Within the estimated window',
    relativeDay,
    rationale:
      'This date is inside the calendar window, but the exact timing of ovulation can vary from cycle to cycle.',
  }
}

/**
 * Plans dates without interpreting a test result. Lunara deliberately does
 * not invent an O+10 "early test" promise. “Suggested” means on or after the
 * expected period (or 14 days after an ovulation estimate when no period
 * estimate exists); package instructions and clinical advice prevail.
 */
export function pregnancyTestPlan(
  today: ISODate,
  ovulationDate: ISODate | null,
  nextPeriodStart: ISODate | null,
): PregnancyTestPlan {
  if (!ovulationDate && !nextPeriodStart) {
    return {
      earliestDate: null,
      expectedPeriodDate: null,
      suggestedDate: null,
      status: 'unknown',
      message: 'There is not enough cycle information to place a test on the calendar yet.',
    }
  }

  const candidate = nextPeriodStart ?? (ovulationDate ? addDays(ovulationDate, 14) : null)
  // A marker derived from an ovulation estimate that has itself gone stale is
  // not actionable: it would announce a test window based on a months-old
  // temperature shift. Withhold it rather than date it from expired evidence.
  const suggestedDate =
    candidate !== null && isForecastAnchorLive(candidate, today, 0) ? candidate : null
  if (suggestedDate === null) {
    return {
      earliestDate: null,
      expectedPeriodDate: null,
      suggestedDate: null,
      status: 'unknown',
      message:
        'The last cycle estimate is too old to place a test on the calendar. Log a recent period to refresh it.',
    }
  }

  let status: PregnancyTestPlan['status'] = 'unknown'
  let message = 'Follow the instructions that come with your test.'

  if (suggestedDate && toEpochDay(today) < toEpochDay(suggestedDate)) {
    status = 'wait'
    message = `Testing now may be too early for this estimate. The expected-period marker is ${formatRange(suggestedDate, suggestedDate, today)}. Follow your test's instructions if they differ.`
  } else {
    status = 'test-window'
    message =
      'You are at or beyond the expected-period marker. Follow the test instructions and contact a clinician about concerning symptoms or repeated uncertainty.'
  }

  return {
    earliestDate: null,
    expectedPeriodDate: nextPeriodStart,
    suggestedDate,
    status,
    message,
  }
}

export function summarizeBbt(
  logs: DailyLog[],
  today: ISODate,
): BbtSummary {
  const windowStart = addDays(today, -29)
  const readings = logs
    .filter(
      (log): log is DailyLog & { bbt: number } =>
        log.bbt !== undefined &&
        toEpochDay(log.date) >= toEpochDay(windowStart) &&
        toEpochDay(log.date) <= toEpochDay(today),
    )
    .map((log) => ({ date: log.date, bbt: log.bbt }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const shifts = detectBbtShiftEstimates(readings)

  if (readings.length === 0) {
    return {
      readingsLast30Days: 0,
      trackingCoverage: 0,
      shiftEstimateDates: [],
      latestShiftEstimate: null,
      confirmedShiftDates: [],
      latestConfirmedOvulation: null,
      status: 'not-started',
      explanation: 'No temperatures are logged in the past 30 days.',
    }
  }
  if (readings.length < 7) {
    return {
      readingsLast30Days: readings.length,
      trackingCoverage: Math.round((readings.length / 30) * 100),
      shiftEstimateDates: shifts,
      latestShiftEstimate: shifts.at(-1) ?? null,
      confirmedShiftDates: shifts,
      latestConfirmedOvulation: shifts.at(-1) ?? null,
      status: 'building-baseline',
      explanation:
        'A few more readings are needed before Lunara can look for a sustained rise against your own baseline.',
    }
  }
  return {
    readingsLast30Days: readings.length,
    trackingCoverage: Math.round((readings.length / 30) * 100),
    shiftEstimateDates: shifts,
    latestShiftEstimate: shifts.at(-1) ?? null,
    confirmedShiftDates: shifts,
    latestConfirmedOvulation: shifts.at(-1) ?? null,
    status: shifts.length ? 'shift-found' : 'no-sustained-shift',
    explanation: shifts.length
      ? 'Three higher readings followed your recent baseline; BBT supports ovulation only in retrospect.'
      : 'No conservative three-reading temperature shift was found in this window. Missing or irregular readings can hide a shift.',
  }
}

export function summarizeOpk(
  logs: DailyLog[],
  currentCycleStart: ISODate | null,
): OpkSummary {
  const tests = logs
    .filter(
      (log) =>
        log.opk &&
        (!currentCycleStart || toEpochDay(log.date) >= toEpochDay(currentCycleStart)),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
  const latestPositiveDate =
    tests.filter((log) => log.opk === 'positive').map((log) => log.date).at(-1) ?? null

  return {
    testsThisCycle: tests.length,
    latestPositiveDate,
    likelyWindow: latestPositiveDate
      ? { start: latestPositiveDate, end: addDays(latestPositiveDate, 2) }
      : null,
    explanation: latestPositiveDate
      ? 'A positive OPK detects an LH rise and can suggest ovulation may follow soon; it does not confirm that ovulation happened.'
      : tests.length
        ? 'No positive OPK is logged in this cycle. A missed surge or an anovulatory cycle cannot be distinguished here.'
        : 'No OPKs are logged in this cycle.',
  }
}

export function buildTtcOverview(
  today: ISODate,
  prediction: Prediction,
  logs: DailyLog[],
): TtcOverview {
  const flowDates = logs
    .filter((log) => log.flow && toEpochDay(log.date) <= toEpochDay(today))
    .map((log) => log.date)
    .sort()
  let currentCycleStart: ISODate | null = null
  let previousFlowDate: ISODate | null = null
  for (const date of flowDates) {
    if (!previousFlowDate || daysBetween(previousFlowDate, date) > 1) currentCycleStart = date
    previousFlowDate = date
  }
  const sexDays = prediction.fertileWindow
    ? new Set(
        logs
          .filter(
            (log) =>
              (log.sex === 'protected' || log.sex === 'unprotected') &&
              toEpochDay(log.date) >= toEpochDay(prediction.fertileWindow!.start) &&
              toEpochDay(log.date) <= toEpochDay(prediction.fertileWindow!.end),
          )
          .map((log) => log.date),
      ).size
    : 0
  const prenatalStart = addDays(today, -13)
  const prenatalVitaminDaysLast14 = new Set(
    logs
      .filter(
        (log) =>
          log.events?.includes('Prenatal vitamin') &&
          toEpochDay(log.date) >= toEpochDay(prenatalStart) &&
          toEpochDay(log.date) <= toEpochDay(today),
      )
      .map((log) => log.date),
  ).size

  return {
    day: fertilityDayGuide(today, prediction),
    testPlan: pregnancyTestPlan(today, prediction.ovulationDate, prediction.nextPeriodStart),
    bbt: summarizeBbt(logs, today),
    opk: summarizeOpk(logs, currentCycleStart),
    fertileWindowSexDays: sexDays,
    prenatalVitaminDaysLast14,
    notes: [
      'Fertility dates are estimates, even with regular cycles.',
      'BBT can support an ovulation estimate after the shift; OPKs can suggest an approaching surge.',
      'This view is educational and cannot confirm ovulation, pregnancy, or infertility.',
    ],
  }
}
