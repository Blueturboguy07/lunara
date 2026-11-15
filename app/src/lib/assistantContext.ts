import {
  db,
  getOvulations,
  getPeriodStarts,
  getSetting,
  SK,
  type DailyLog,
  type Goal,
} from '../db/schema'
import type { Prediction } from '../engine/cycle'
import { localToday } from './dates'
import { forecastOn, readForecastSource } from './sharedForecast'

/**
 * The tracker categories the person ticks for Lunara AI. Notes are not a
 * category: free text from the tracker never goes to AI chat (lib/aiPayload.ts).
 */
export interface AssistantConsent {
  cycle: boolean
  symptoms: boolean
  fertility: boolean
}

export const NO_ASSISTANT_CONSENT: AssistantConsent = {
  cycle: false,
  symptoms: false,
  fertility: false,
}

/** Before the person changes a tick: the anonymized cycle summary is on (the AI chat screen says so). */
export const DEFAULT_ASSISTANT_CONSENT: AssistantConsent = {
  cycle: true,
  symptoms: false,
  fertility: false,
}

/** The tracker data that lib/aiPayload.ts turns into an anonymized summary. */
export interface TrackerSnapshot {
  logs: DailyLog[]
  periodStarts: string[]
  ovulations: string[]
  goal: Goal
  pregnancyLMP?: string
  baselineCycleLength?: number
  today: string
  /**
   * The forecast that Today and the Calendar show (lib/sharedForecast.ts), so the
   * AI summary names the same next period. Never sent as it is: lib/aiPayload.ts
   * turns its days into relative days.
   */
  prediction?: Prediction
}

/** Reads the tracker data for a message; null when nothing is ticked (nothing is read). */
export async function collectTrackerSnapshot(consent: AssistantConsent): Promise<TrackerSnapshot | null> {
  if (!Object.values(consent).some(Boolean)) return null
  const today = localToday()
  const [logs, periodStarts, ovulations, goal, pregnancyLMP, cycleLength, source] = await Promise.all([
    db.dailyLogs.toArray(),
    getPeriodStarts(),
    getOvulations(),
    getSetting(SK.goal),
    getSetting(SK.pregnancyLMP),
    getSetting(SK.cycleLength),
    readForecastSource(),
  ])
  return {
    logs,
    periodStarts,
    ovulations,
    goal: (goal ?? 'cycle') as Goal,
    pregnancyLMP,
    baselineCycleLength: Number(cycleLength) || undefined,
    today,
    prediction: forecastOn(source, today).prediction,
  }
}

export function parseAssistantConsent(value?: string): AssistantConsent {
  if (!value) return { ...DEFAULT_ASSISTANT_CONSENT }
  try {
    const parsed = JSON.parse(value) as Partial<AssistantConsent>
    return {
      cycle: parsed.cycle === true,
      symptoms: parsed.symptoms === true,
      fertility: parsed.fertility === true,
    }
  } catch {
    return { ...NO_ASSISTANT_CONSENT }
  }
}
