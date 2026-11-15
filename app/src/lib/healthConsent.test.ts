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
  CHAT_AGREEMENT_ACCEPT,
  CHAT_AGREEMENT_DECLINE,
  CHAT_AGREEMENT_TITLE,
  CHAT_SENDS_EVERY_TIME,
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

describe('AI chat is optional: the screen before the first message', () => {
  it('names the receiver', () => {
    // Without GET /wallet `ai_providers`: no company is named.
    expect(healthDestination('publik')).toEqual({ id: 'publik', name: 'publik (publikhq.com) and the AI provider that answers' })
    // With it: publik's true list.
    expect(healthDestination('publik', undefined, ['OpenRouter', 'Amazon Web Services'])).toEqual({
      id: 'publik',
      name: 'publik (publikhq.com) and the AI provider that answers: OpenRouter or Amazon Web Services',
      providers: ['OpenRouter', 'Amazon Web Services'],
    })
    expect(healthDestination('anthropic')).toEqual({ id: 'anthropic', name: 'Anthropic', ownAccountWith: 'Anthropic' })
    expect(healthDestination('openai')).toEqual({ id: 'openai', name: 'OpenAI', ownAccountWith: 'OpenAI' })
    expect(healthDestination('openai', 'https://llm.example.org/v1')).toEqual({
      id: 'openai:llm.example.org',
      name: 'the OpenAI-compatible service at llm.example.org',
      ownAccountWith: 'that service',
    })
  })

  it('publik: the founder text, with the buttons "Turn on AI chat" and "Not now"', () => {
    expect([CHAT_AGREEMENT_TITLE, ...chatAgreementBody(healthDestination('publik'))].join(' ')).toBe(
      'AI chat is optional ' +
        'To answer you, Lunara sends your question and an anonymized summary of your cycle data to publik (publikhq.com). publik sends it to the AI provider that answers. It has no name, email or birth date. ' +
        'publik does not store the content of your messages or answers, and does not use it for ads, analytics, training, or sale. It keeps billing records (model, token counts, cost) without content. ' +
        'The AI provider processes your message to answer it, under its own terms.',
    )
    expect(chatAgreementBody(healthDestination('publik', undefined, ['OpenRouter', 'Amazon Web Services', 'OpenAI', 'Google']))[0]).toBe(
      'To answer you, Lunara sends your question and an anonymized summary of your cycle data to publik (publikhq.com). publik sends it to the AI provider that answers: OpenRouter, Amazon Web Services, OpenAI or Google. It has no name, email or birth date.',
    )
    expect(CHAT_AGREEMENT_ACCEPT).toBe('Turn on AI chat')
    expect(CHAT_AGREEMENT_DECLINE).toBe('Not now')
  })

  it('your own key: straight to that provider under your own account, and publik never sees it', () => {
    expect(chatAgreementBody(healthDestination('anthropic'))).toEqual([
      'To answer you, Lunara sends your question and an anonymized summary of your cycle data to Anthropic. It has no name, email or birth date.',
      'It goes straight from this phone to Anthropic, under your own account with Anthropic. publik never sees it.',
      'Anthropic processes your message to answer it, under its own terms.',
    ])
    expect(chatAgreementBody(healthDestination('openai', 'https://llm.example.org/v1'))[2]).toBe(
      'The OpenAI-compatible service at llm.example.org processes your message to answer it, under its own terms.',
    )
    expect(ownKeyDataPath(healthDestination('openai'))).toBe(
      'It goes straight from this phone to OpenAI, under your own account with OpenAI. publik never sees it.',
    )
    // The publik sentences are for publik only.
    expect(chatAgreementBody(healthDestination('anthropic')).join(' ')).not.toContain('billing records')
  })

  it('the on-phone sentence keeps "or encrypted backup"; the screen names the only free text', () => {
    expect(DATA_STAYS_ON_PHONE).toBe('Your data stays on this phone unless you turn on AI chat or encrypted backup.')
    expect(CHAT_SENDS_EVERY_TIME).toBe(
      'With your question, Lunara sends the earlier messages of this chat: up to 16 messages, each cut at 6,000 characters. That is the only free text it sends.',
    )
  })

  it('every message needs the answer first, also with no tracker data ticked', async () => {
    const none = selectedHealthKinds({ cycle: false, symptoms: false, fertility: false })
    expect(none).toEqual([])
    expect(await chatAgreementNeeded(healthDestination('publik'), none)).toBe(true)
    await agreeToChat(healthDestination('publik'), none)
    expect(await chatAgreementNeeded(healthDestination('publik'), none)).toBe(false)
    expect(stored()).toEqual({ v: 3, agreed: { publik: [] } })
  })

  it('asks again for a newly ticked category and for another receiver', async () => {
    const publik = healthDestination('publik')
    const kinds = selectedHealthKinds({ cycle: true, symptoms: false, fertility: true })
    expect(kinds).toEqual(['cycle', 'fertility'])
    await agreeToChat(publik, kinds)
    expect(await chatAgreementNeeded(publik, kinds)).toBe(false)
    expect(await chatAgreementNeeded(publik, ['cycle'])).toBe(false)
    expect(await chatAgreementNeeded(publik, ['cycle', 'symptoms'])).toBe(true)
    expect(await chatAgreementNeeded(healthDestination('anthropic'), [])).toBe(true)
    expect(await chatAgreementNeeded(healthDestination('openai', 'https://llm.example.org/v1'), [])).toBe(true)
    await agreeToChat(publik, ['symptoms'])
    expect(stored().agreed.publik).toEqual(['cycle', 'symptoms', 'fertility'])
  })

  it('an answer to an earlier screen, or a damaged record, does not count', async () => {
    settings.store.set('aiHealthConsent', JSON.stringify({ v: 2, agreed: { openai: ['symptoms'] } }))
    expect(await chatAgreementNeeded(healthDestination('openai'), [])).toBe(true)
    settings.store.set('aiHealthConsent', JSON.stringify({ openai: ['symptoms'] }))
    expect(await chatAgreementNeeded(healthDestination('openai'), [])).toBe(true)
    settings.store.set('aiHealthConsent', '{not json')
    expect(await chatAgreementNeeded(healthDestination('openai'), [])).toBe(true)
    // An old "notes" answer is dropped: notes are not a category.
    settings.store.set('aiHealthConsent', JSON.stringify({ v: 3, agreed: { openai: ['symptoms', 'notes'] } }))
    expect(await chatAgreementNeeded(healthDestination('openai'), ['symptoms'])).toBe(false)
  })

  it('sign-out forgets the publik answer only', async () => {
    await forgetChatAgreement('publik')
    expect(settings.store.has('aiHealthConsent')).toBe(false)
    settings.store.set('aiHealthConsent', JSON.stringify({ v: 3, agreed: { publik: ['cycle'], anthropic: ['symptoms'] } }))
    await forgetChatAgreement('publik')
    expect(stored()).toEqual({ v: 3, agreed: { anthropic: ['symptoms'] } })
    settings.store.set('aiHealthConsent', JSON.stringify({ v: 2, agreed: { publik: ['cycle'] } }))
    await forgetChatAgreement('publik')
    expect(stored()).toEqual({ v: 3, agreed: {} })
  })

  it('three tracker categories, each with a title and the words for what it sends; no notes', () => {
    expect(Object.keys(HEALTH_KINDS).sort()).toEqual(['cycle', 'fertility', 'symptoms'])
    for (const text of Object.values(HEALTH_KINDS)) {
      expect(text.title.length).toBeGreaterThan(0)
      expect(text.detail.length).toBeGreaterThan(0)
    }
  })
})
