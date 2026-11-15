import type { DailyLog } from '../db/schema'
import {
  ACTIVITY_EVENTS,
  DIGESTION_EVENTS,
  DISCHARGES,
  LIFESTYLE_EVENTS,
  MOODS,
  PERI_SYMPTOMS,
  SEX_OPTIONS,
  SYMPTOMS,
  TRACKER_GROUPS,
} from '../db/taxonomy'
import { daysBetween, predict, type ISODate } from '../engine/cycle'
import { AI_LIMITS } from './aiLimits'
import { DATE_RULES, guardAnswerDates } from './answerDates'
import type { ChatMessage } from './assistant'
import type { AssistantConsent, TrackerSnapshot } from './assistantContext'

/**
 * The ONE place that makes what Lunara AI sends (founder decision, Nov 14 2026).
 * lib/assistant.ts sends an AiPayload as it is and accepts nothing else, on the
 * publik path and on the own-key path.
 *
 * Anonymized entirely:
 *   - no name, no email, no birth date or age, no location, no device or
 *     account ID: the input has no field for them;
 *   - no free text from the tracker: notes are never read, and symptom, mood
 *     and event values must be in Lunara's fixed lists (anything else is dropped);
 *   - no absolute dates: every day becomes a relative value ("cycle day 14",
 *     "3 days ago", "in 5 days"), and today's date is not sent;
 *   - the only free text is the chat itself: what the person typed into AI chat
 *     and the earlier answers, at most AI_LIMITS.chatMessages messages, each cut
 *     at AI_LIMITS.messageChars characters.
 * The publik install key goes in the Authorization header for billing only; it
 * is never part of the payload.
 */
export const ASSISTANT_SYSTEM_PROMPT = `You are Lunara's health companion inside a privacy-first menstrual-health app. Explain cycles, fertility, pregnancy, symptoms, and perimenopause clearly and warmly.

Safety rules:
- You provide general education, not a diagnosis, prescription, or substitute for a clinician.
- Use calibrated language such as "may", "often", and "can"; never claim clinical certainty from tracker data.
- Never present calendar, temperature, or symptom tracking as reliable contraception.
- Do not tell someone to start, stop, or change prescription medicine.
- When symptoms could be urgent (including severe or one-sided pain, fainting, chest pain, trouble breathing, very heavy bleeding, pregnancy bleeding with pain, or thoughts of self-harm), clearly recommend prompt professional or emergency help.
- State when the available information is insufficient.
- Keep answers focused and readable.

${DATE_RULES}`

declare const aiPayloadBrand: unique symbol

/** What one AI request sends. Only makeAiPayload() makes one. */
export type AiPayload = {
  /** Lunara's fixed instructions plus the anonymized tracker summary. */
  readonly system: string
  readonly messages: readonly ChatMessage[]
} & { readonly [aiPayloadBrand]: true }

export interface AiPayloadInput {
  /** The chat: what the person typed into AI chat and the earlier answers. */
  messages: readonly ChatMessage[]
  /** The tracker categories the person ticked. */
  consent: AssistantConsent
  /** The tracker data on this phone; null when nothing is ticked. */
  tracker: TrackerSnapshot | null
}

/** A day as a value relative to today: "today", "yesterday", "3 days ago", "tomorrow", "in 5 days". */
export function relativeDay(day: ISODate, today: ISODate): string {
  const offset = daysBetween(today, day)
  if (offset === 0) return 'today'
  if (offset === -1) return 'yesterday'
  if (offset === 1) return 'tomorrow'
  return offset < 0 ? `${-offset} days ago` : `in ${offset} days`
}

function catalog(values: readonly string[]): Map<string, string> {
  return new Map(values.map((value) => [value.trim().toLowerCase(), value]))
}

const KNOWN_SYMPTOMS = catalog([...SYMPTOMS, ...PERI_SYMPTOMS])
const KNOWN_MOODS = catalog(MOODS)
const KNOWN_EVENTS = catalog([
  ...TRACKER_GROUPS.flatMap((group) => group.items),
  ...[...DIGESTION_EVENTS, ...ACTIVITY_EVENTS, ...LIFESTYLE_EVENTS].flatMap((item) => [item.id, item.label]),
])

const GOALS = new Set(['cycle', 'ttc', 'pregnancy', 'peri'])
const DISCHARGE_IDS = new Set<string>(DISCHARGES.map((item) => item.id))
const SEX_IDS = new Set<string>(SEX_OPTIONS.map((item) => item.id))
const OPK_RESULTS = new Set(['positive', 'negative'])

/**
 * One value from a fixed list, else nothing. The types say these fields are fixed values,
 * but an imported backup can hold any text there; free text never goes out (round 2 audit).
 */
function fixed(value: unknown, list: ReadonlySet<string>): string | undefined {
  return typeof value === 'string' && list.has(value) ? value : undefined
}

/** A finite number, else nothing (an imported value can be text). */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Only values from Lunara's fixed lists; anything typed or imported as free text is dropped. */
function known(values: readonly string[] | undefined, list: Map<string, string>): string[] | undefined {
  const kept = (values ?? []).map((value) => list.get(String(value).trim().toLowerCase())).filter((value): value is string => Boolean(value))
  return kept.length > 0 ? [...new Set(kept)] : undefined
}

/** Cycle day of `day`: 1 on the latest period start on or before it. */
function cycleDayOf(day: ISODate, periodStarts: readonly ISODate[]): number | undefined {
  let start: ISODate | undefined
  for (const candidate of periodStarts) if (candidate <= day && (!start || candidate > start)) start = candidate
  return start ? daysBetween(start, day) + 1 : undefined
}

function latest<T extends { date: string }>(items: readonly T[], limit: number): T[] {
  return [...items].sort((a, b) => a.date.localeCompare(b.date)).slice(-limit)
}

function trackerSummary(tracker: TrackerSnapshot, consent: AssistantConsent): Record<string, unknown> | null {
  const categories = (Object.keys(consent) as Array<keyof AssistantConsent>).filter((key) => consent[key])
  if (categories.length === 0) return null
  const { today } = tracker
  const goal = fixed(tracker.goal, GOALS) ?? 'cycle'
  const starts = [...tracker.periodStarts].filter((day) => day <= today).sort()
  const when = (day: ISODate) => ({ when: relativeDay(day, today), cycleDay: cycleDayOf(day, starts) })
  // The forecast that Today and the Calendar show (lib/sharedForecast.ts); predict() only without one.
  const forecast =
    tracker.prediction ??
    predict({ periodStarts: starts, ovulations: [...tracker.ovulations], today }, { baselineCycleLength: tracker.baselineCycleLength })
  const logs = tracker.logs.filter((log) => log.date <= today)
  const summary: Record<string, unknown> = { sharedCategories: categories }

  if (consent.cycle) {
    const recent = starts.slice(-AI_LIMITS.periodStarts)
    summary.cycle = {
      trackingMode: goal,
      cycleDay: forecast.cycleDay,
      averageCycleLength: forecast.averageCycleLength || null,
      recentCycleLengths: recent.slice(1).map((day, index) => daysBetween(recent[index], day)),
      recentPeriodStarts: recent.map((day) => relativeDay(day, today)),
      nextPeriod: forecast.nextPeriodStart ? relativeDay(forecast.nextPeriodStart, today) : null,
      uncertaintyDays: forecast.uncertaintyDays,
      method: forecast.source,
    }
  }

  if (consent.symptoms) {
    summary.symptomsAndMood = latest(logs, logs.length)
      .map((log) => ({
        ...when(log.date),
        symptoms: known(log.symptoms, KNOWN_SYMPTOMS),
        moods: known(log.moods, KNOWN_MOODS),
        events: known(log.events, KNOWN_EVENTS),
      }))
      .filter((day) => day.symptoms || day.moods || day.events)
      .slice(-AI_LIMITS.loggedDays)
  }

  if (consent.fertility) {
    const observations = latest(
      logs.filter(
        (log: DailyLog) =>
          finiteNumber(log.bbt) !== undefined ||
          fixed(log.opk, OPK_RESULTS) !== undefined ||
          fixed(log.discharge, DISCHARGE_IDS) !== undefined ||
          fixed(log.sex, SEX_IDS) !== undefined,
      ),
      AI_LIMITS.loggedDays,
    )
    const pregnancyDays = goal === 'pregnancy' && tracker.pregnancyLMP ? daysBetween(tracker.pregnancyLMP, today) : null
    summary.fertility = {
      trackingMode: goal,
      ovulation: forecast.ovulationDate ? relativeDay(forecast.ovulationDate, today) : null,
      fertileWindow: forecast.fertileWindow
        ? { from: relativeDay(forecast.fertileWindow.start, today), to: relativeDay(forecast.fertileWindow.end, today) }
        : null,
      pregnancy:
        pregnancyDays !== null && Number.isFinite(pregnancyDays) && pregnancyDays >= 0
          ? { weeks: Math.floor(pregnancyDays / 7), days: pregnancyDays % 7 }
          : undefined,
      observations: observations.map((log) => {
        const bbt = finiteNumber(log.bbt)
        return {
          ...when(log.date),
          bbtCelsius: bbt === undefined ? undefined : bbt / 100,
          ovulationTest: fixed(log.opk, OPK_RESULTS),
          discharge: fixed(log.discharge, DISCHARGE_IDS),
          intimacy: fixed(log.sex, SEX_IDS),
        }
      }),
    }
  }
  return summary
}

function chatWindow(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.slice(-AI_LIMITS.chatMessages).map((message) => {
    // An earlier answer goes back with its placeholders; a calendar date in it is left out
    // again here (lib/answerDates.ts), so a replayed answer carries no date either.
    // What the person typed is the chat itself and goes as typed.
    const content = message.role === 'assistant' ? guardAnswerDates(message.content).text : message.content
    return {
      role: message.role,
      content:
        content.length > AI_LIMITS.messageChars ? `${content.slice(0, AI_LIMITS.messageChars)}\n[message truncated]` : content,
    }
  })
}

/** Makes the payload of one AI request. See the file comment for what it never contains. */
export function makeAiPayload(input: AiPayloadInput): AiPayload {
  const summary = input.tracker ? trackerSummary(input.tracker, input.consent) : null
  const system = summary
    ? `${ASSISTANT_SYSTEM_PROMPT}

The following JSON is an anonymized summary of tracker categories the user explicitly approved for this request. Days are relative to today. Treat it as self-reported, potentially incomplete data. Do not infer or request hidden categories:
${JSON.stringify(summary)}`
    : `${ASSISTANT_SYSTEM_PROMPT}

The user has not shared tracker data for this request. Do not imply that you can see it.`
  return { system, messages: chatWindow(input.messages) } as unknown as AiPayload
}
