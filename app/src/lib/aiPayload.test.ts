import { describe, expect, it, vi } from 'vitest'
import type { DailyLog } from '../db/schema'
import { AI_LIMITS } from './aiLimits'
import { makeAiPayload, relativeDay, type AiPayload } from './aiPayload'
import { askAssistantDetailed, DEFAULT_ANTHROPIC_MODEL, type ChatMessage } from './assistant'
import { NO_ASSISTANT_CONSENT, parseAssistantConsent, type TrackerSnapshot } from './assistantContext'
import { HEALTH_KINDS } from './healthConsent'

/**
 * AI chat data is anonymized entirely (founder decision, Nov 14 2026). These
 * tests fail when a name, an email, a birth date or an absolute date reaches
 * what an AI provider receives.
 */
const NAME = 'Jane Doe'
const EMAIL = 'jane.doe@example.com'
const BIRTH_DATE = '1994-03-12'

const logs = [
  {
    date: '2026-03-08',
    symptoms: ['Cramps', `${NAME} called`],
    moods: ['Calm', `email ${EMAIL}`],
    events: ['Pill taken', `born ${BIRTH_DATE}`],
    notes: `${NAME}, born ${BIRTH_DATE}, ${EMAIL}, lives at 12 Elm Street`,
    bbt: 3650,
    opk: 'positive',
    sex: 'protected',
    healthImports: { flow: { source: `${NAME}'s watch`, importedAt: '2026-03-08T07:00:00.000Z' } },
  },
  { date: '2026-03-09', notes: `Call ${EMAIL}` },
  { date: '2026-03-20', symptoms: ['Headache'] }, // after today: never sent
] as unknown as DailyLog[]

// Extra fields a caller might pass by mistake: the payload must ignore them.
const tracker = {
  logs,
  periodStarts: ['2026-01-23', '2026-02-20'],
  ovulations: [],
  goal: 'cycle',
  today: '2026-03-10',
  displayName: NAME,
  email: EMAIL,
  birthDate: BIRTH_DATE,
  birthYear: '1994',
  installId: 'inst_123e4567-e89b-12d3-a456-426614174000',
  location: 'Austin, Texas',
} as unknown as TrackerSnapshot

const everything = { cycle: true, symptoms: true, fertility: true }
const question: ChatMessage[] = [{ role: 'user', content: 'Why might my cycle be longer?' }]

const ABSOLUTE_DATE = /\b(19|20)\d{2}-\d{2}-\d{2}\b|\b(19|20)\d{2}\b|\b(January|February|March|April|June|July|August|September|October|November|December)\b/

function expectAnonymous(text: string) {
  expect(text).not.toContain('Jane')
  expect(text).not.toContain('Doe')
  expect(text).not.toContain('@')
  expect(text).not.toContain('Elm Street')
  expect(text).not.toContain('Austin')
  expect(text).not.toContain('inst_')
  expect(text).not.toMatch(ABSOLUTE_DATE)
}

function summaryOf(payload: AiPayload): Record<string, unknown> {
  const json = payload.system.slice(payload.system.lastIndexOf('\n') + 1)
  return JSON.parse(json) as Record<string, unknown>
}

describe('makeAiPayload: anonymized entirely', () => {
  it('no name, email, birth date, location, ID or absolute date, with every category ticked', () => {
    const payload = makeAiPayload({ messages: question, consent: everything, tracker })
    expectAnonymous(JSON.stringify(payload))
  })

  it('days are relative: "cycle day", "N days ago", "in N days"; today is not sent', () => {
    const summary = summaryOf(makeAiPayload({ messages: question, consent: everything, tracker }))
    const cycle = summary.cycle as Record<string, unknown>
    expect(cycle.cycleDay).toBe(19)
    expect(cycle.recentPeriodStarts).toEqual(['46 days ago', '18 days ago'])
    expect(cycle.recentCycleLengths).toEqual([28])
    expect(String(cycle.nextPeriod)).toMatch(/^(today|tomorrow|yesterday|in \d+ days|\d+ days ago)$/)
    expect(summary).not.toHaveProperty('asOf')
    expect(relativeDay('2026-03-10', '2026-03-10')).toBe('today')
    expect(relativeDay('2026-03-09', '2026-03-10')).toBe('yesterday')
    expect(relativeDay('2026-03-13', '2026-03-10')).toBe('in 3 days')
  })

  it('free text from the tracker never goes: no notes, and only values from Lunara’s lists', () => {
    const summary = summaryOf(makeAiPayload({ messages: question, consent: everything, tracker }))
    expect(summary.symptomsAndMood).toEqual([
      { when: '2 days ago', cycleDay: 17, symptoms: ['Cramps'], moods: ['Calm'], events: ['Pill taken'] },
    ])
    expect(JSON.stringify(summary)).not.toContain('notes')
    expect(JSON.stringify(summary)).not.toContain('Headache') // a day after today
  })

  it('pregnancy: weeks and days, never the date of the last period; nothing outside pregnancy mode', () => {
    const pregnant = makeAiPayload({
      messages: question,
      consent: { cycle: false, symptoms: false, fertility: true },
      tracker: { ...tracker, goal: 'pregnancy', pregnancyLMP: '2026-01-01' },
    })
    expectAnonymous(JSON.stringify(pregnant))
    expect((summaryOf(pregnant).fertility as Record<string, unknown>).pregnancy).toEqual({ weeks: 9, days: 5 })
    const notPregnant = summaryOf(makeAiPayload({ messages: question, consent: { cycle: false, symptoms: false, fertility: true }, tracker: { ...tracker, pregnancyLMP: '2026-01-01' } }))
    expect((notPregnant.fertility as Record<string, unknown>).pregnancy).toBeUndefined()
  })

  it('only the ticked categories; nothing ticked sends no tracker data', () => {
    expect(Object.keys(summaryOf(makeAiPayload({ messages: question, consent: { cycle: true, symptoms: false, fertility: false }, tracker }))).sort()).toEqual([
      'cycle',
      'sharedCategories',
    ])
    const none = makeAiPayload({ messages: question, consent: NO_ASSISTANT_CONSENT, tracker })
    expect(none.system).toContain('The user has not shared tracker data for this request.')
    expect(none.system).not.toContain('{')
  })

  it('the chat: what the person typed goes as typed, at most 16 messages, each cut at 6,000 characters', () => {
    const long: ChatMessage[] = Array.from({ length: 20 }, (_, n) => ({ role: n % 2 ? 'assistant' : 'user', content: `${n} ${'y'.repeat(7_000)}` }))
    const payload = makeAiPayload({ messages: long, consent: NO_ASSISTANT_CONSENT, tracker: null })
    expect(payload.messages).toHaveLength(AI_LIMITS.chatMessages)
    expect(payload.messages[0].content.startsWith('4 ')).toBe(true)
    expect(Math.max(...payload.messages.map((m) => m.content.length))).toBe(AI_LIMITS.messageChars + '\n[message truncated]'.length)
    const typed = makeAiPayload({ messages: [{ role: 'user', content: 'Is day 40 late?' }], consent: NO_ASSISTANT_CONSENT, tracker: null })
    expect(typed.messages).toEqual([{ role: 'user', content: 'Is day 40 late?' }])
  })

  it('the screen words match the limits', () => {
    expect(HEALTH_KINDS.cycle.detail).toContain(`last ${AI_LIMITS.periodStarts} period starts`)
    expect(HEALTH_KINDS.symptoms.detail).toContain(`up to ${AI_LIMITS.loggedDays} recent logged days`)
    expect(HEALTH_KINDS.fertility.detail).toContain(`up to ${AI_LIMITS.loggedDays} recent days`)
  })

  it('stored ticks: the cycle summary is on until the person changes it; a broken value is all off', () => {
    expect(parseAssistantConsent(undefined)).toEqual({ cycle: true, symptoms: false, fertility: false })
    expect(parseAssistantConsent('{broken')).toEqual(NO_ASSISTANT_CONSENT)
    expect(parseAssistantConsent('{"cycle":true,"notes":true}')).toEqual({ cycle: true, symptoms: false, fertility: false })
  })
})

describe('every provider path sends the payload and nothing else', () => {
  const payload = makeAiPayload({ messages: question, consent: everything, tracker })

  function capture(reply: unknown) {
    const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = []
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    return { calls, fetchMock }
  }

  it('publik: the install key only in the Authorization header; the body is the payload', async () => {
    const { calls, fetchMock } = capture({ output_text: 'ok' })
    await askAssistantDetailed({ provider: 'publik', apiKey: 'pk_live_test', model: '' }, payload, fetchMock)
    const [call] = calls
    expect([...call.headers.keys()].sort()).toEqual(['authorization', 'content-type'])
    expect(Object.keys(call.body).sort()).toEqual(['input', 'instructions', 'max_output_tokens', 'model', 'reasoning', 'store', 'text'])
    expect(call.body.instructions).toBe(payload.system)
    expect(call.body.input).toEqual(payload.messages)
    expectAnonymous(JSON.stringify(call.body))
  })

  it('own OpenAI key: the same payload', async () => {
    const { calls, fetchMock } = capture({ output_text: 'ok' })
    await askAssistantDetailed({ provider: 'openai', apiKey: 'sk-proj-test', model: 'gpt-test' }, payload, fetchMock)
    expect(calls[0].body.instructions).toBe(payload.system)
    expect(calls[0].body.input).toEqual(payload.messages)
    expect(calls[0].body).not.toHaveProperty('user')
    expectAnonymous(JSON.stringify(calls[0].body))
  })

  it('own Anthropic key: the same payload', async () => {
    const { calls, fetchMock } = capture({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: DEFAULT_ANTHROPIC_MODEL,
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    await askAssistantDetailed({ provider: 'anthropic', apiKey: 'sk-ant-api03-test', model: DEFAULT_ANTHROPIC_MODEL }, payload, fetchMock)
    expect(Object.keys(calls[0].body).sort()).toEqual(['max_tokens', 'messages', 'model', 'system'])
    expect(calls[0].body.system).toBe(payload.system)
    expect(calls[0].body.messages).toEqual(payload.messages)
    expectAnonymous(JSON.stringify(calls[0].body))
  })
})
