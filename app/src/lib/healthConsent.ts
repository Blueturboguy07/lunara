import { getSetting, setSetting, SK } from '../db/schema'
import { AI_LIMITS } from './aiLimits'
import type { AssistantProvider } from './assistant'
import type { AssistantConsent } from './assistantContext'

/**
 * AI chat sends data off this phone, so it waits for the person's agreement
 * (owner decision, Nov 13 2026; App Store 5.1.2(i)). Without AI chat, health
 * and cycle data stays on this phone.
 *
 * The agreement screen ("AI chat sends data off this phone") names the
 * receiver and lists exactly what a message sends (lib/assistant.ts and
 * lib/assistantContext.ts, with the numbers in lib/aiLimits.ts):
 *   - every time: the message and the earlier messages of this chat;
 *   - the tracker categories the person ticks, with today's date.
 * The agreement is per receiver and per category: a new receiver, or a newly
 * ticked category, shows the screen again. "Not now" closes AI chat and sends
 * nothing. This file records the answer; it never changes what is sent.
 */
export type HealthKind = keyof AssistantConsent

export interface HealthKindText {
  title: string
  /** Exactly what the category sends (lib/assistantContext.ts). */
  detail: string
  sensitive?: boolean
}

export const HEALTH_KINDS: Record<HealthKind, HealthKindText> = {
  cycle: {
    title: 'Cycle summary',
    detail: `Your tracking mode, your last ${AI_LIMITS.periodStarts} period start dates and the current prediction (cycle day, average cycle length, next period, uncertainty)`,
  },
  symptoms: {
    title: 'Symptoms and mood',
    detail: `Symptoms, moods and events from up to ${AI_LIMITS.loggedDays} recent logged days`,
  },
  fertility: {
    title: 'Fertility and intimacy',
    detail: `Your tracking mode; BBT, ovulation tests, discharge and sex from up to ${AI_LIMITS.loggedDays} recent days; the ovulation and fertile-window estimate; and the first day of your last period if you track a pregnancy`,
    sensitive: true,
  },
  notes: {
    title: 'Private notes',
    detail: `Up to ${AI_LIMITS.notes} recent notes, each cut at ${AI_LIMITS.noteChars} characters`,
    sensitive: true,
  },
}

/** What every message sends, with or without ticked data. */
export const CHAT_SENDS_EVERY_TIME = `Your message and the earlier messages in this chat: up to ${AI_LIMITS.chatMessages} messages, each cut at ${AI_LIMITS.messageChars.toLocaleString('en-US')} characters.`

/** What goes with the ticked data. */
export const CHAT_SENDS_WITH_TICKED = 'With ticked data, Lunara also sends today’s date. You can change the ticks later under Tracker context.'

export const CHAT_AGREEMENT_TITLE = 'AI chat sends data off this phone'

/** The line for every privacy claim in the app (onboarding, the log sheet, articles). */
export const DATA_STAYS_ON_PHONE = 'Your data stays on this phone unless you turn on AI chat or encrypted backup.'

export interface HealthDestination {
  /** The key the agreement is stored under. */
  id: string
  /** Who receives the data, in words for the agreement screen. */
  name: string
  /** Your own key: the account the data goes to. Not set for publik. */
  ownAccountWith?: string
}

/** Where a message goes, by the provider Lunara AI uses. */
export function healthDestination(provider: AssistantProvider, baseUrl?: string): HealthDestination {
  if (provider === 'publik') return { id: 'publik', name: 'publik (publikhq.com) and the AI model provider that publik uses' }
  if (provider === 'anthropic') return { id: 'anthropic', name: 'Anthropic', ownAccountWith: 'Anthropic' }
  const custom = baseUrl?.trim()
  if (custom) {
    let host = custom
    try {
      host = new URL(custom).host || custom
    } catch {
      // not a URL: name it as typed
    }
    return { id: `openai:${host}`, name: `the OpenAI-compatible service at ${host}`, ownAccountWith: 'that service' }
  }
  return { id: 'openai', name: 'OpenAI', ownAccountWith: 'OpenAI' }
}

/** Where the data goes with your own key (the agreement screen and the onboarding AI step). */
export function ownKeyDataPath(destination: HealthDestination): string {
  return `It goes straight from this phone to ${destination.name}, under your own account with ${destination.ownAccountWith ?? destination.name}. publik never sees it.`
}

/** The body of the agreement screen, one paragraph per entry. */
export function chatAgreementBody(destination: HealthDestination): string[] {
  return [
    `To answer you, Lunara sends your message and the data you tick below to ${destination.name}. Nothing is sent until you agree.`,
    destination.ownAccountWith
      ? ownKeyDataPath(destination)
      : 'publik does not use this data for any other purpose: no ads, no analytics, no training, no sale.',
  ]
}

/** The tracker categories ticked for the next message, in screen order. */
export function selectedHealthKinds(consent: AssistantConsent): HealthKind[] {
  return (Object.keys(HEALTH_KINDS) as HealthKind[]).filter((kind) => consent[kind])
}

/**
 * Stored as {"v":2,"agreed":{"<destination id>":["cycle",…]}}. A destination
 * in `agreed` has agreed to AI chat; its list is the categories it may get.
 * Answers to the earlier screen (no "v") do not count: everyone sees this
 * screen once.
 */
const VERSION = 2

async function readAgreed(): Promise<Record<string, HealthKind[]>> {
  const raw = await getSetting(SK.aiHealthConsent)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; agreed?: unknown }
    if (!parsed || parsed.v !== VERSION || !parsed.agreed || typeof parsed.agreed !== 'object' || Array.isArray(parsed.agreed)) return {}
    const out: Record<string, HealthKind[]> = {}
    for (const [id, kinds] of Object.entries(parsed.agreed as Record<string, unknown>)) {
      if (Array.isArray(kinds)) out[id] = kinds.filter((k): k is HealthKind => typeof k === 'string' && k in HEALTH_KINDS)
    }
    return out
  } catch {
    return {}
  }
}

async function writeAgreed(agreed: Record<string, HealthKind[]>): Promise<void> {
  await setSetting(SK.aiHealthConsent, JSON.stringify({ v: VERSION, agreed }))
}

/** True when the agreement screen must come first: no agreement with this receiver yet, or a ticked category it has not agreed to. */
export async function chatAgreementNeeded(destination: HealthDestination, kinds: HealthKind[]): Promise<boolean> {
  const agreed = (await readAgreed())[destination.id]
  if (!agreed) return true
  return kinds.some((kind) => !agreed.includes(kind))
}

/** "I agree": AI chat with this receiver, with these categories (added to the earlier ones). */
export async function agreeToChat(destination: HealthDestination, kinds: HealthKind[]): Promise<void> {
  const all = await readAgreed()
  const merged = new Set([...(all[destination.id] ?? []), ...kinds])
  all[destination.id] = (Object.keys(HEALTH_KINDS) as HealthKind[]).filter((kind) => merged.has(kind))
  await writeAgreed(all)
}

/** Sign-out and Delete account: the agreement with this receiver ends with the account ("publik"). */
export async function forgetChatAgreement(destinationId: string): Promise<void> {
  const raw = await getSetting(SK.aiHealthConsent)
  if (!raw) return
  const all = await readAgreed()
  delete all[destinationId]
  // Also rewrites an answer to the earlier screen, which no longer counts.
  await writeAgreed(all)
}
