import { describe, expect, it, vi } from 'vitest'
import type { DailyLog } from '../db/schema'
import { AI_LIMITS } from './aiLimits'
import { askAssistantDetailed, type ChatMessage } from './assistant'
import { buildApprovedAssistantContext, type AssistantContextSource } from './assistantContext'
import { CHAT_SENDS_EVERY_TIME, CHAT_SENDS_WITH_TICKED, HEALTH_KINDS } from './healthConsent'

/**
 * The agreement screen ("AI chat sends data off this phone") must say exactly
 * what the publik provider path sends. These tests send through the real code
 * and compare the request with the words on the screen.
 */
const day = (n: number) => `2026-0${1 + Math.floor(n / 28)}-${String(1 + (n % 28)).padStart(2, '0')}`

const logs: DailyLog[] = Array.from({ length: 40 }, (_, n) => ({
  date: day(n),
  symptoms: ['cramps'],
  moods: ['calm'],
  notes: `note ${n} ${'x'.repeat(500)}`,
  bbt: 3650,
  opk: 'negative',
}))

const source: AssistantContextSource = {
  today: '2026-03-20',
  goal: 'cycle',
  periodStarts: Array.from({ length: 10 }, (_, n) => day(n * 4)),
  ovulations: [],
  logs,
}

const everything = { cycle: true, symptoms: true, fertility: true, notes: true }

async function publikRequest(history: ChatMessage[], context: Record<string, unknown>) {
  let body: Record<string, unknown> = {}
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ output_text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  await askAssistantDetailed({ provider: 'publik', apiKey: 'pk_live_test', model: '' }, history, context, fetchMock)
  return body as { input: ChatMessage[]; instructions: string }
}

describe('the agreement screen says what the publik path sends', () => {
  it('every message: the message and the earlier messages, at most 16, each cut at 6,000 characters', async () => {
    const history: ChatMessage[] = Array.from({ length: 20 }, (_, n) => ({
      role: n % 2 === 0 ? 'user' : 'assistant',
      content: `${n} ${'y'.repeat(7_000)}`,
    }))
    const body = await publikRequest(history, {})
    expect(body.input).toHaveLength(AI_LIMITS.chatMessages)
    expect(body.input[0].content.startsWith('4 ')).toBe(true) // the 4 oldest stay on the phone
    for (const message of body.input) {
      expect(message.content.length).toBeLessThanOrEqual(AI_LIMITS.messageChars + '\n[message truncated]'.length)
    }
    expect(CHAT_SENDS_EVERY_TIME).toBe('Your message and the earlier messages in this chat: up to 16 messages, each cut at 6,000 characters.')
    // No tracker data unless ticked.
    expect(body.instructions).toContain('The user has not shared tracker data for this request.')
  })

  it('ticked data: only the ticked categories, with the limits the screen names, and today’s date', async () => {
    const context = buildApprovedAssistantContext(source, everything)
    expect(Object.keys(context).sort()).toEqual(['asOf', 'cycle', 'fertilityAndPregnancy', 'notes', 'sharedCategories', 'symptoms'])
    expect(context.asOf).toBe('2026-03-20')
    expect(CHAT_SENDS_WITH_TICKED).toContain('today’s date')

    const cycle = context.cycle as { trackingMode: string; recentPeriodStarts: string[]; prediction: Record<string, unknown> }
    expect(cycle.recentPeriodStarts).toHaveLength(AI_LIMITS.periodStarts)
    expect(Object.keys(cycle.prediction).sort()).toEqual(['averageCycleLength', 'cycleDay', 'method', 'nextPeriodStart', 'uncertaintyDays'])
    expect(HEALTH_KINDS.cycle.detail).toContain(`last ${AI_LIMITS.periodStarts} period start dates`)

    expect(context.symptoms as unknown[]).toHaveLength(AI_LIMITS.loggedDays)
    expect(Object.keys((context.symptoms as Record<string, unknown>[])[0]).sort()).toEqual(['date', 'events', 'moods', 'symptoms'])
    expect(HEALTH_KINDS.symptoms.detail).toBe(`Symptoms, moods and events from up to ${AI_LIMITS.loggedDays} recent logged days`)

    const fertility = context.fertilityAndPregnancy as { recentObservations: Record<string, unknown>[] }
    expect(fertility.recentObservations).toHaveLength(AI_LIMITS.loggedDays)
    expect(HEALTH_KINDS.fertility.detail).toContain(`up to ${AI_LIMITS.loggedDays} recent days`)

    const notes = context.notes as Array<{ text: string }>
    expect(notes).toHaveLength(AI_LIMITS.notes)
    expect(Math.max(...notes.map((note) => note.text.length))).toBe(AI_LIMITS.noteChars)
    expect(HEALTH_KINDS.notes.detail).toBe(`Up to ${AI_LIMITS.notes} recent notes, each cut at ${AI_LIMITS.noteChars} characters`)

    // The ticked data goes in the request as it is built, nothing more.
    const body = await publikRequest([{ role: 'user', content: 'Hi' }], context)
    expect(body.instructions).toContain(JSON.stringify(context))
  })

  it('a category that is not ticked is not sent', () => {
    const context = buildApprovedAssistantContext(source, { cycle: true, symptoms: false, fertility: false, notes: false })
    expect(Object.keys(context).sort()).toEqual(['asOf', 'cycle', 'sharedCategories'])
  })
})
