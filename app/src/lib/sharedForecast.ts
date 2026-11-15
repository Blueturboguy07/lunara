import { db, getHealthProfile, getOvulations, getPeriodStarts, type HealthProfile } from '../db/schema'
import { addDays, toEpochDay, type ISODate, type Prediction } from '../engine/cycle'
import { buildCycleForecast, type CycleForecastDiagnostics } from '../engine/cycleForecast'
import { applyPredictionContext, type PersonalizedPrediction } from '../engine/predictionContext'

/**
 * ONE forecast for every screen (blind test round 2, M3).
 *
 * Today and the Calendar used two engines: Today used buildCycleForecast (it
 * leaves out intervals under 15 or over 90 days) plus the profile context, and
 * the Calendar used the older predict() with every interval. After a period
 * start logged today, the two screens showed different next periods and the
 * Calendar showed a fertile window in the past.
 *
 * Now both screens call forecastOn(): the same inputs give the same forecast,
 * from one cache. Each screen reads the inputs with a Dexie live query
 * (readForecastSource), so a changed log changes the inputs, and both screens
 * compute again.
 */

/** What the forecast is made from. */
export interface ForecastSource {
  periodStarts: readonly ISODate[]
  /** Retrospective BBT-shift estimates (getOvulations). */
  ovulations: readonly ISODate[]
  /** Days with a positive ovulation test. */
  positiveOpkDates: readonly ISODate[]
  profile: HealthProfile
}

export interface SharedForecast {
  /** The forecast after the profile context: what every screen shows. */
  prediction: Prediction
  predictionContext: PersonalizedPrediction
  diagnostics: CycleForecastDiagnostics
}

/** A positive ovulation test counts for 28 days, as on Today before. */
const OPK_DAYS = 27
const CACHE_SIZE = 24
const cache = new Map<string, SharedForecast>()

function keyOf(source: ForecastSource, date: ISODate): string {
  return JSON.stringify([date, source.periodStarts, source.ovulations, source.positiveOpkDates, source.profile])
}

/** The forecast on `date`: only the data on or before that day counts. Pure, and cached. */
export function forecastOn(source: ForecastSource, date: ISODate): SharedForecast {
  const key = keyOf(source, date)
  const kept = cache.get(key)
  if (kept) return kept
  const periodStarts = source.periodStarts.filter((day) => day <= date)
  const ovulations = source.ovulations.filter((day) => day <= date)
  const firstOpkDay = addDays(date, -OPK_DAYS)
  const forecast = buildCycleForecast(
    { periodStarts, ovulations, today: date },
    {
      baselineCycleLength: source.profile.cycle.typicalCycleLength,
      positiveOpkDates: source.positiveOpkDates.filter((day) => day >= firstOpkDay && day <= date),
      bbtShiftDates: ovulations,
    },
  )
  const personalized = applyPredictionContext(forecast.prediction, source.profile, {
    completedCycles: forecast.diagnostics.completedCycleCount,
    bbtShiftEstimateCount: ovulations.length,
    positiveOpkThisCycle: forecast.diagnostics.evidence.some((item) => item.kind === 'opk-suggestive'),
  })
  const result: SharedForecast = {
    prediction: personalized.prediction,
    predictionContext: personalized,
    diagnostics: forecast.diagnostics,
  }
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string)
  cache.set(key, result)
  return result
}

/** Reads the inputs from the database. Call it inside a live query, so a changed log runs it again. */
export async function readForecastSource(): Promise<ForecastSource> {
  const [periodStarts, ovulations, positiveOpkDates, profile] = await Promise.all([
    getPeriodStarts(),
    getOvulations(),
    db.dailyLogs.filter((log) => log.opk === 'positive').primaryKeys(),
    getHealthProfile(),
  ])
  return { periodStarts, ovulations, positiveOpkDates: (positiveOpkDates as string[]).sort(), profile }
}

/** The shared forecast for one day, read from the database. */
export async function loadForecast(date: ISODate): Promise<SharedForecast> {
  return forecastOn(await readForecastSource(), date)
}

export type ForecastDayKind = 'predicted' | 'ovulation' | 'fertile' | null

/** How the Calendar marks a day that has no logged period: from the shared forecast only. */
export function forecastDayKind(prediction: Prediction | null, date: ISODate, periodDays: number): ForecastDayKind {
  if (!prediction) return null
  const day = toEpochDay(date)
  if (prediction.nextPeriodStart) {
    const start = toEpochDay(prediction.nextPeriodStart)
    if (day >= start && day < start + periodDays) return 'predicted'
  }
  // No fertile window (for example with hormonal contraception): no ovulation mark either.
  if (!prediction.fertileWindow) return null
  if (prediction.ovulationDate === date) return 'ovulation'
  if (day >= toEpochDay(prediction.fertileWindow.start) && day <= toEpochDay(prediction.fertileWindow.end)) return 'fertile'
  return null
}
