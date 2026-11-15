import { getSetting, setSetting, SK } from '../db/schema'
import { AI_LIMITS } from './aiLimits'
import type { AssistantProvider } from './assistant'
import type { AssistantConsent } from './assistantContext'
import { publikProviderWords } from './publikApi'

/**
 * AI chat is optional, and it waits for the person's answer before it sends
 * anything (founder decisions, Nov 13 and Nov 14 2026; App Store 5.1.2(i)).
 * Without AI chat, health and cycle data stays on this phone.
 *
 * The screen says what lib/aiPayload.ts sends: the question (with the earlier
 * messages of the chat) and an anonymized summary of the ticked tracker
 * categories, with no name, email, birth date or absolute date.
 * The answer is per receiver and per category: a new receiver, or a newly
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
    detail: `Your tracking mode, cycle day, cycle lengths, your last ${AI_LIMITS.periodStarts} period starts as “days ago”, and the next-period estimate`,
  },
  symptoms: {
    title: 'Symptoms and mood',
    detail: `Symptoms, moods and events from Lunara’s lists, from up to ${AI_LIMITS.loggedDays} recent logged days, as “days ago”`,
  },
  fertility: {
    title: 'Fertility and intimacy',
    detail: `BBT, ovulation tests, discharge and sex from up to ${AI_LIMITS.loggedDays} recent days; the ovulation and fertile-window estimate; pregnancy weeks if you track a pregnancy`,
    sensitive: true,
  },
}

/** What goes with every question. */
export const CHAT_SENDS_EVERY_TIME = `With your question, Lunara sends the earlier messages of this chat: up to ${AI_LIMITS.chatMessages} messages, each cut at ${AI_LIMITS.messageChars.toLocaleString('en-US')} characters. That is the only free text it sends.`

/** How the summary is made. */
export const CHAT_SENDS_WITH_TICKED = 'The summary uses relative days, such as “cycle day 14” or “3 days ago”. Notes and other free text from the tracker are never sent. You can change the ticks later under Tracker context.'

export const CHAT_AGREEMENT_TITLE = 'AI chat is optional'
export const CHAT_AGREEMENT_ACCEPT = 'Turn on AI chat'
export const CHAT_AGREEMENT_DECLINE = 'Not now'

export const DATA_STAYS_ON_PHONE = 'Your data stays on this phone unless you turn on AI chat or encrypted backup.'

export interface HealthDestination {
  /** The key the agreement is stored under. */
  id: string
  /** Who receives the data, in words for the agreement screen. */
  name: string
  /** Your own key: the account the data goes to. Not set for publik. */
  ownAccountWith?: string
  /** publik: the companies from GET /wallet `ai_providers`, when publik sent them. */
  providers?: string[]
}

/**
 * Where a message goes, by the provider Lunara AI uses. On publik, `publikProviders` is the true
 * list from GET /wallet `ai_providers` (App Store rule 5.1.2(i): name who gets the data); without
 * it the screen names no company.
 */
export function healthDestination(provider: AssistantProvider, baseUrl?: string, publikProviders?: readonly string[] | null): HealthDestination {
  if (provider === 'publik') {
    const providers = publikProviders?.length ? [...publikProviders] : undefined
    return { id: 'publik', name: `publik (publikhq.com) and ${publikProviderWords(providers)}`, ...(providers ? { providers } : {}) }
  }
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

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The body of the screen after its title, one paragraph per entry (founder text, Nov 14 2026; publik names the receivers for rule 5.1.2(i)). */
export function chatAgreementBody(destination: HealthDestination): string[] {
  if (!destination.ownAccountWith) {
    return [
      `To answer you, Lunara sends your question and an anonymized summary of your cycle data to publik (publikhq.com). publik sends it to ${publikProviderWords(destination.providers)}. It has no name, email or birth date.`,
      'publik does not store the content of your messages or answers, and does not use it for ads, analytics, training, or sale. It keeps billing records (model, token counts, cost) without content.',
      'The AI provider processes your message to answer it, under its own terms.',
    ]
  }
  // Your own key: publik is not on the path, so the publik sentences become this one.
  return [
    `To answer you, Lunara sends your question and an anonymized summary of your cycle data to ${destination.name}. It has no name, email or birth date.`,
    ownKeyDataPath(destination),
    `${capitalized(destination.name)} processes your message to answer it, under its own terms.`,
  ]
}

/** The tracker categories ticked for the next message, in screen order. */
export function selectedHealthKinds(consent: AssistantConsent): HealthKind[] {
  return (Object.keys(HEALTH_KINDS) as HealthKind[]).filter((kind) => consent[kind])
}

/**
 * Stored as {"v":3,"agreed":{"<destination id>":["cycle",…]}}. A destination
 * in `agreed` has the answer "Turn on AI chat"; its list is the categories it
 * may get. Answers to an earlier screen (another "v") do not count: everyone
 * sees this screen once.
 */
const VERSION = 3

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

/** "Turn on AI chat": AI chat with this receiver, with these categories (added to the earlier ones). */
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
