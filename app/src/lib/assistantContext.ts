import {
  db,
  getOvulations,
  getPeriodStarts,
  getSetting,
  SK,
  type DailyLog,
  type Goal,
} from '../db/schema'
import { localToday } from './dates'

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
}

/** Reads the tracker data for a message; null when nothing is ticked (nothing is read). */
export async function collectTrackerSnapshot(consent: AssistantConsent): Promise<TrackerSnapshot | null> {
  if (!Object.values(consent).some(Boolean)) return null
  const [logs, periodStarts, ovulations, goal, pregnancyLMP, cycleLength] = await Promise.all([
    db.dailyLogs.toArray(),
    getPeriodStarts(),
    getOvulations(),
    getSetting(SK.goal),
    getSetting(SK.pregnancyLMP),
    getSetting(SK.cycleLength),
  ])
  return {
    logs,
    periodStarts,
    ovulations,
    goal: (goal ?? 'cycle') as Goal,
    pregnancyLMP,
    baselineCycleLength: Number(cycleLength) || undefined,
    today: localToday(),
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
