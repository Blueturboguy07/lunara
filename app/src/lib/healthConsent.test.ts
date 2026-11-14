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
  agreeToChat,
  CHAT_AGREEMENT_TITLE,
  chatAgreementBody,
  chatAgreementNeeded,
  DATA_STAYS_ON_PHONE,
  forgetChatAgreement,
  HEALTH_KINDS,
  healthDestination,
  ownKeyDataPath,
  selectedHealthKinds,
} from './healthConsent'

beforeEach(() => {
  settings.store.clear()
})

const stored = () => JSON.parse(settings.store.get('aiHealthConsent') ?? 'null')

describe('AI chat sends data off this phone: the agreement', () => {
  it('names the receiver', () => {
    expect(healthDestination('publik')).toEqual({ id: 'publik', name: 'publik (publikhq.com) and the AI model provider that publik uses' })
    expect(healthDestination('anthropic')).toEqual({ id: 'anthropic', name: 'Anthropic', ownAccountWith: 'Anthropic' })
    expect(healthDestination('openai')).toEqual({ id: 'openai', name: 'OpenAI', ownAccountWith: 'OpenAI' })
    expect(healthDestination('openai', 'https://llm.example.org/v1')).toEqual({
      id: 'openai:llm.example.org',
      name: 'the OpenAI-compatible service at llm.example.org',
      ownAccountWith: 'that service',
    })
  })

  it('publik: the owner’s words, with the receiver in them', () => {
    expect(CHAT_AGREEMENT_TITLE).toBe('AI chat sends data off this phone')
    expect(chatAgreementBody(healthDestination('publik'))).toEqual([
      'To answer you, Lunara sends your message and the data you tick below to publik (publikhq.com) and the AI model provider that publik uses. Nothing is sent until you agree.',
      'publik does not use this data for any other purpose: no ads, no analytics, no training, no sale.',
    ])
  })

  it('your own key: straight to that provider under your own account, and publik never sees it', () => {
    expect(chatAgreementBody(healthDestination('anthropic'))).toEqual([
      'To answer you, Lunara sends your message and the data you tick below to Anthropic. Nothing is sent until you agree.',
      'It goes straight from this phone to Anthropic, under your own account with Anthropic. publik never sees it.',
    ])
    expect(chatAgreementBody(healthDestination('openai'))[1]).toBe(
      'It goes straight from this phone to OpenAI, under your own account with OpenAI. publik never sees it.',
    )
    expect(ownKeyDataPath(healthDestination('openai', 'https://llm.example.org/v1'))).toBe(
      'It goes straight from this phone to the OpenAI-compatible service at llm.example.org, under your own account with that service. publik never sees it.',
    )
    // The publik sentence is for publik only.
    expect(chatAgreementBody(healthDestination('anthropic')).join(' ')).not.toContain('no ads')
  })

  it('every privacy claim uses one sentence', () => {
    expect(DATA_STAYS_ON_PHONE).toBe('Your data stays on this phone unless you turn on AI chat or encrypted backup.')
  })

  it('every message needs the agreement first, also with no tracker data ticked', async () => {
    const none = selectedHealthKinds({ cycle: false, symptoms: false, fertility: false, notes: false })
    expect(none).toEqual([])
    expect(await chatAgreementNeeded(healthDestination('publik'), none)).toBe(true)
    await agreeToChat(healthDestination('publik'), none)
    expect(await chatAgreementNeeded(healthDestination('publik'), none)).toBe(false)
    expect(stored()).toEqual({ v: 2, agreed: { publik: [] } })
  })

  it('asks again for a newly ticked category and for another receiver', async () => {
    const publik = healthDestination('publik')
    const kinds = selectedHealthKinds({ cycle: true, symptoms: false, fertility: true, notes: false })
    expect(kinds).toEqual(['cycle', 'fertility'])
    await agreeToChat(publik, kinds)
    expect(await chatAgreementNeeded(publik, kinds)).toBe(false)
    expect(await chatAgreementNeeded(publik, ['cycle'])).toBe(false)
    expect(await chatAgreementNeeded(publik, ['cycle', 'notes'])).toBe(true)
    expect(await chatAgreementNeeded(healthDestination('anthropic'), [])).toBe(true)
    expect(await chatAgreementNeeded(healthDestination('openai', 'https://llm.example.org/v1'), [])).toBe(true)
    // A later agreement adds to the earlier one.
    await agreeToChat(publik, ['notes'])
    expect(stored().agreed.publik).toEqual(['cycle', 'fertility', 'notes'])
  })

  it('an answer to the earlier screen, or a damaged record, does not count', async () => {
    settings.store.set('aiHealthConsent', JSON.stringify({ openai: ['symptoms'] }))
    expect(await chatAgreementNeeded(healthDestination('openai'), [])).toBe(true)
    settings.store.set('aiHealthConsent', '{not json')
    expect(await chatAgreementNeeded(healthDestination('openai'), [])).toBe(true)
    settings.store.set('aiHealthConsent', JSON.stringify({ v: 2, agreed: { openai: ['symptoms', 'bogus'] } }))
    expect(await chatAgreementNeeded(healthDestination('openai'), ['symptoms'])).toBe(false)
  })

  it('sign-out forgets the publik agreement only', async () => {
    await forgetChatAgreement('publik')
    expect(settings.store.has('aiHealthConsent')).toBe(false) // nothing stored: nothing written
    settings.store.set('aiHealthConsent', JSON.stringify({ v: 2, agreed: { publik: ['cycle'], anthropic: ['notes'] } }))
    await forgetChatAgreement('publik')
    expect(stored()).toEqual({ v: 2, agreed: { anthropic: ['notes'] } })
    // An answer to the earlier screen is dropped.
    settings.store.set('aiHealthConsent', JSON.stringify({ publik: ['cycle'] }))
    await forgetChatAgreement('publik')
    expect(stored()).toEqual({ v: 2, agreed: {} })
  })

  it('every tracker category has a title and the words for what it sends', () => {
    expect(Object.keys(HEALTH_KINDS).sort()).toEqual(['cycle', 'fertility', 'notes', 'symptoms'])
    for (const text of Object.values(HEALTH_KINDS)) {
      expect(text.title.length).toBeGreaterThan(0)
      expect(text.detail.length).toBeGreaterThan(0)
    }
  })
})
