import { getSetting, setSetting, SK } from '../db/schema'
import type { AssistantProvider } from './assistant'
import type { AssistantConsent } from './assistantContext'

/**
 * Explicit permission before health data goes to an AI provider (App Store
 * 5.1.2(i)). Lunara AI sends tracker data only for the categories the person
 * ticks for a message. Before the FIRST message that sends a category to a
 * provider, Lunara shows a consent screen that names the provider and the
 * data kinds. "Not now" sends nothing. This file only records the answer; it
 * never changes what is sent.
 */
export type HealthKind = keyof AssistantConsent

export const HEALTH_KIND_LABELS: Record<HealthKind, string> = {
  cycle: 'Cycle summary: period starts and the current prediction',
  symptoms: 'Symptoms and mood: up to 30 recent logged days',
  fertility: 'Fertility and intimacy: BBT, tests, discharge, sex and pregnancy timing',
  notes: 'Private notes: up to 12 recent notes',
}

export interface HealthDestination {
  /** The key the answer is stored under. */
  id: string
  /** Who receives the data, in words for the consent screen. */
  name: string
}

/** Where a message with tracker data goes, by the provider Lunara AI uses. */
export function healthDestination(provider: AssistantProvider, baseUrl?: string): HealthDestination {
  if (provider === 'publik') return { id: 'publik', name: 'publik (publikhq.com) and the AI model provider that publik uses' }
  if (provider === 'anthropic') return { id: 'anthropic', name: 'Anthropic, with your own API key' }
  const custom = baseUrl?.trim()
  if (custom) {
    let host = custom
    try {
      host = new URL(custom).host || custom
    } catch {
      // not a URL: name it as typed
    }
    return { id: `openai:${host}`, name: `the OpenAI-compatible service at ${host}, with your own key` }
  }
  return { id: 'openai', name: 'OpenAI, with your own API key' }
}

/** The tracker categories ticked for the next message, in screen order. */
export function selectedHealthKinds(consent: AssistantConsent): HealthKind[] {
  return (Object.keys(HEALTH_KIND_LABELS) as HealthKind[]).filter((kind) => consent[kind])
}

async function readAllowed(): Promise<Record<string, HealthKind[]>> {
  const raw = await getSetting(SK.aiHealthConsent)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, HealthKind[]> = {}
    for (const [id, kinds] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(kinds)) out[id] = kinds.filter((k): k is HealthKind => typeof k === 'string' && k in HEALTH_KIND_LABELS)
    }
    return out
  } catch {
    return {}
  }
}

/** The ticked kinds this destination has no permission for yet. Empty: send without asking. */
export async function healthKindsNeedingConsent(destination: HealthDestination, kinds: HealthKind[]): Promise<HealthKind[]> {
  if (kinds.length === 0) return []
  const allowed = (await readAllowed())[destination.id] ?? []
  return kinds.filter((kind) => !allowed.includes(kind))
}

/** "Allow and send": remember the permission for this destination and these kinds. */
export async function allowHealthSharing(destination: HealthDestination, kinds: HealthKind[]): Promise<void> {
  const all = await readAllowed()
  const merged = new Set([...(all[destination.id] ?? []), ...kinds])
  all[destination.id] = (Object.keys(HEALTH_KIND_LABELS) as HealthKind[]).filter((kind) => merged.has(kind))
  await setSetting(SK.aiHealthConsent, JSON.stringify(all))
}

/** Sign-out and Delete account: the permission for this destination ends with the account ("publik"). */
export async function forgetHealthSharing(destinationId: string): Promise<void> {
  const all = await readAllowed()
  if (!(destinationId in all)) return
  delete all[destinationId]
  await setSetting(SK.aiHealthConsent, JSON.stringify(all))
}
