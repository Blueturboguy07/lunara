import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({ store: new Map<string, string>() }))
vi.mock('../db/schema', () => ({
  SK: { aiHealthConsent: 'aiHealthConsent' },
  getSetting: async (key: string) => settings.store.get(key),
  setSetting: async (key: string, value: string) => {
    settings.store.set(key, value)
  },
}))

import {
  allowHealthSharing,
  healthDestination,
  healthKindsNeedingConsent,
  HEALTH_KIND_LABELS,
  selectedHealthKinds,
} from './healthConsent'

beforeEach(() => {
  settings.store.clear()
})

describe('health data consent before the first send to an AI provider', () => {
  it('names the provider that receives the data', () => {
    expect(healthDestination('publik').name).toBe('publik (publikhq.com) and the AI model provider that publik uses')
    expect(healthDestination('anthropic').name).toBe('Anthropic, with your own API key')
    expect(healthDestination('openai').name).toBe('OpenAI, with your own API key')
    expect(healthDestination('openai', 'https://llm.example.org/v1')).toEqual({
      id: 'openai:llm.example.org',
      name: 'the OpenAI-compatible service at llm.example.org, with your own key',
    })
  })

  it('a message with no tracker category needs no consent', async () => {
    const kinds = selectedHealthKinds({ cycle: false, symptoms: false, fertility: false, notes: false })
    expect(kinds).toEqual([])
    expect(await healthKindsNeedingConsent(healthDestination('publik'), kinds)).toEqual([])
  })

  it('asks once per provider and per data kind, then remembers the answer', async () => {
    const publik = healthDestination('publik')
    const kinds = selectedHealthKinds({ cycle: true, symptoms: false, fertility: true, notes: false })
    expect(kinds).toEqual(['cycle', 'fertility'])
    expect(await healthKindsNeedingConsent(publik, kinds)).toEqual(['cycle', 'fertility'])

    await allowHealthSharing(publik, kinds)
    expect(await healthKindsNeedingConsent(publik, kinds)).toEqual([])
    // A new kind asks again; another provider asks again.
    expect(await healthKindsNeedingConsent(publik, ['cycle', 'notes'])).toEqual(['notes'])
    expect(await healthKindsNeedingConsent(healthDestination('anthropic'), ['cycle'])).toEqual(['cycle'])
  })

  it('a damaged record asks again instead of sending', async () => {
    settings.store.set('aiHealthConsent', '{not json')
    expect(await healthKindsNeedingConsent(healthDestination('openai'), ['symptoms'])).toEqual(['symptoms'])
    settings.store.set('aiHealthConsent', JSON.stringify({ openai: ['symptoms', 'bogus'] }))
    expect(await healthKindsNeedingConsent(healthDestination('openai'), ['symptoms'])).toEqual([])
  })

  it('every data kind has words for the consent screen', () => {
    expect(Object.keys(HEALTH_KIND_LABELS).sort()).toEqual(['cycle', 'fertility', 'notes', 'symptoms'])
  })
})
