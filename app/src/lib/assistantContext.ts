import {
  db,
  getOvulations,
  getPeriodStarts,
  getSetting,
  SK,
  type DailyLog,
  type Goal,
} from '../db/schema'
import { predict } from '../engine/cycle'
import { AI_LIMITS } from './aiLimits'
import { localToday } from './dates'
import type { ApprovedAssistantContext } from './assistant'

export interface AssistantConsent {
  cycle: boolean
  symptoms: boolean
  fertility: boolean
  notes: boolean
}

export const NO_ASSISTANT_CONSENT: AssistantConsent = {
  cycle: false,
  symptoms: false,
  fertility: false,
  notes: false,
}

export interface AssistantContextSource {
  logs: DailyLog[]
  periodStarts: string[]
  ovulations: string[]
  goal: Goal
  pregnancyLMP?: string
  baselineCycleLength?: number
  today: string
}

function recent<T extends { date: string }>(items: T[], limit: number): T[] {
  return [...items].sort((a, b) => a.date.localeCompare(b.date)).slice(-limit)
}

/**
 * Pure boundary used by tests and the UI. Every field is guarded by the
 * corresponding explicit toggle; adding a new tracker field here therefore
 * requires adding it to a named consent category too.
 */
export function buildApprovedAssistantContext(
  source: AssistantContextSource,
  consent: AssistantConsent,
): ApprovedAssistantContext {
  const sharedCategories = (Object.keys(consent) as Array<keyof AssistantConsent>).filter(
    (key) => consent[key],
  )
  if (sharedCategories.length === 0) return {}

  const result: ApprovedAssistantContext = {
    asOf: source.today,
    sharedCategories,
  }

  const prediction = predict(
    {
      periodStarts: source.periodStarts,
      ovulations: source.ovulations,
      today: source.today,
    },
    { baselineCycleLength: source.baselineCycleLength },
  )

  if (consent.cycle) {
    result.cycle = {
      trackingMode: source.goal,
      recentPeriodStarts: source.periodStarts.slice(-AI_LIMITS.periodStarts),
      prediction: {
        cycleDay: prediction.cycleDay,
        averageCycleLength: prediction.averageCycleLength || null,
        nextPeriodStart: prediction.nextPeriodStart,
        uncertaintyDays: prediction.uncertaintyDays,
        method: prediction.source,
      },
    }
  }

  if (consent.symptoms) {
    result.symptoms = recent(
      source.logs
        .filter(
          (log) =>
            (log.symptoms?.length ?? 0) > 0 ||
            (log.moods?.length ?? 0) > 0 ||
            (log.events?.length ?? 0) > 0,
        )
        .map((log) => ({
          date: log.date,
          symptoms: log.symptoms,
          moods: log.moods,
          events: log.events,
        })),
      AI_LIMITS.loggedDays,
    )
  }

  if (consent.fertility) {
    result.fertilityAndPregnancy = {
      trackingMode: source.goal,
      pregnancyLMP: source.goal === 'pregnancy' ? source.pregnancyLMP : undefined,
      prediction: {
        ovulationDate: prediction.ovulationDate,
        fertileWindow: prediction.fertileWindow,
      },
      recentObservations: recent(
        source.logs
          .filter(
            (log) =>
              log.bbt !== undefined ||
              log.opk !== undefined ||
              log.discharge !== undefined ||
              log.sex !== undefined,
          )
          .map((log) => ({
            date: log.date,
            bbtCelsius: log.bbt === undefined ? undefined : log.bbt / 100,
            ovulationTest: log.opk,
            discharge: log.discharge,
            intimacy: log.sex,
          })),
        AI_LIMITS.loggedDays,
      ),
    }
  }

  if (consent.notes) {
    result.notes = recent(
      source.logs
        .filter((log) => Boolean(log.notes?.trim()))
        .map((log) => ({ date: log.date, text: log.notes!.trim().slice(0, AI_LIMITS.noteChars) })),
      AI_LIMITS.notes,
    )
  }

  return result
}

export async function collectApprovedAssistantContext(
  consent: AssistantConsent,
): Promise<ApprovedAssistantContext> {
  if (!Object.values(consent).some(Boolean)) return {}
  const [logs, periodStarts, ovulations, goal, pregnancyLMP, cycleLength] = await Promise.all([
    db.dailyLogs.toArray(),
    getPeriodStarts(),
    getOvulations(),
    getSetting(SK.goal),
    getSetting(SK.pregnancyLMP),
    getSetting(SK.cycleLength),
  ])

  return buildApprovedAssistantContext(
    {
      logs,
      periodStarts,
      ovulations,
      goal: (goal ?? 'cycle') as Goal,
      pregnancyLMP,
      baselineCycleLength: Number(cycleLength) || undefined,
      today: localToday(),
    },
    consent,
  )
}

export function parseAssistantConsent(value?: string): AssistantConsent {
  if (!value) return { ...NO_ASSISTANT_CONSENT }
  try {
    const parsed = JSON.parse(value) as Partial<AssistantConsent>
    return {
      cycle: parsed.cycle === true,
      symptoms: parsed.symptoms === true,
      fertility: parsed.fertility === true,
      notes: parsed.notes === true,
    }
  } catch {
    return { ...NO_ASSISTANT_CONSENT }
  }
}
