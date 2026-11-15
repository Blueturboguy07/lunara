import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * End to end, per AI path (round 2 audit): the tracker on this phone is full of marker
 * notes, free text in fixed fields, names and known dates. The test reads it the way the
 * app does (collectTrackerSnapshot), makes the one payload (makeAiPayload), sends it on
 * each provider path (askAssistantDetailed) and reads the request body that would leave
 * the phone. It fails when the marker, a YYYY-MM-DD date, a month name, a timestamp,
 * "today is", a name, an email or a birth date is in that body.
 */

const MARKER = 'NOTE_MARKER_123'
const NAME = 'Jane Doe'
const EMAIL = 'jane.doe@example.com'
const BIRTH_DATE = '1994-03-12'

const store = vi.hoisted(() => ({
  logs: [] as Array<Record<string, unknown>>,
  settings: new Map<string, string>(),
}))

vi.mock('../db/schema', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/schema')>()
  const flowDays = () => store.logs.filter((log) => log.flow !== undefined).map((log) => String(log.date)).sort()
  return {
    ...actual,
    db: {
      dailyLogs: {
        toArray: async () => store.logs.map((log) => ({ ...log })),
        filter: (test: (log: Record<string, unknown>) => boolean) => ({
          primaryKeys: async () => store.logs.filter(test).map((log) => log.date),
          toArray: async () => store.logs.filter(test).map((log) => ({ ...log })),
        }),
      },
    },
    getSetting: async (key: string) => store.settings.get(key),
    getPeriodStarts: async () => {
      // The same rule as the real one: a flow day after a gap starts a period.
      const starts: string[] = []
      let previous = Number.NEGATIVE_INFINITY
      for (const day of flowDays()) {
        const epoch = Date.parse(`${day}T00:00:00Z`) / 86_400_000
        if (epoch - previous > 1) starts.push(day)
        previous = epoch
      }
      return starts
    },
    getOvulations: async () => [],
    getHealthProfile: async () => {
      const profile = actual.createDefaultHealthProfile('2026-01-01T12:00:00.000Z')
      profile.displayName = NAME
      profile.cycle.typicalCycleLength = 28
      return profile
    },
  }
})

import { addDays } from '../engine/cycle'
import { makeAiPayload } from './aiPayload'
import { guardAnswerDates } from './answerDates'
import { askAssistantDetailed, DEFAULT_ANTHROPIC_MODEL, type AssistantConfig, type ChatMessage } from './assistant'
import { collectTrackerSnapshot, parseAssistantConsent } from './assistantContext'
import { localToday } from './dates'

const FORBIDDEN: Array<[string, RegExp]> = [
  ['the note marker', new RegExp(MARKER)],
  ['a YYYY-MM-DD date', /\b(19|20)\d{2}-\d{2}-\d{2}\b/],
  ['a year', /\b(19|20)\d{2}\b/],
  ['a month name', /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/],
  ['a short month with a day', /\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.? \d/],
  ['a timestamp', /\d{2}:\d{2}:\d{2}|T\d{2}:\d{2}/],
  ['"today is"', /today is/i],
  ['the name', /Jane|Doe/],
  ['the email', /@example\.com/],
  ['the birth date', /1994|03-12/],
  ['the street', /Elm Street/],
]

function expectClean(body: string) {
  for (const [what, pattern] of FORBIDDEN) expect(body, `the request body has ${what}`).not.toMatch(pattern)
}

function fillTracker(today: string) {
  const free = `${MARKER} ${NAME} ${EMAIL} born ${BIRTH_DATE} on ${today} in November, Nov 3, 10:15:00 ${new Date().toISOString()} today is ${today}, 12 Elm Street`
  store.logs = [
    // Two periods: 30 days ago and 2 days ago, with flow.
    { date: addDays(today, -30), flow: 'medium', notes: free },
    { date: addDays(today, -29), flow: 'light', notes: free },
    { date: addDays(today, -2), flow: 'medium', periodStart: true, notes: free },
    {
      date: addDays(today, -1),
      notes: free,
      symptoms: ['Cramps', free],
      moods: ['Calm', free],
      events: ['Pill taken', free],
      symptomRatings: { Cramps: { severity: 'mild', note: free } },
      // Free text where the types expect fixed values (an imported backup can do this).
      discharge: free,
      opk: `positive ${today}`,
      sex: free,
      intimacyEvents: [free],
      bbt: `${today}`,
      pregnancyTest: free,
      healthImports: { flow: { source: free, importedAt: new Date().toISOString() } },
    },
    { date: today, notes: free, symptoms: ['Headache'], opk: 'positive', discharge: 'egg-white', bbt: 3660 },
  ]
  store.settings = new Map([
    ['goal', free], // not a mode: never sent as it is
    ['pregnancyLMP', today],
    ['cycleLength', '28'],
    ['displayName', NAME],
    ['birthYear', '1994'],
  ])
}

const EVERYTHING = JSON.stringify({ cycle: true, symptoms: true, fertility: true, notes: true })

function capture(reply: unknown) {
  const bodies: string[] = []
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(String(init?.body))
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return { bodies, fetchMock }
}

const PATHS: Array<{ name: string; config: AssistantConfig; reply: unknown }> = [
  { name: 'publik API', config: { provider: 'publik', apiKey: 'pk_live_test', model: '' }, reply: { output_text: 'ok' } },
  {
    name: 'own Anthropic key',
    config: { provider: 'anthropic', apiKey: 'sk-ant-api03-test', model: DEFAULT_ANTHROPIC_MODEL },
    reply: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: DEFAULT_ANTHROPIC_MODEL,
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  },
  { name: 'own OpenAI key', config: { provider: 'openai', apiKey: 'sk-proj-test', model: 'gpt-test' }, reply: { output_text: 'ok' } },
]

async function send(config: AssistantConfig, reply: unknown, messages: ChatMessage[]): Promise<string> {
  // What the app does in AssistantScreen.send(): the saved ticks, the tracker read, the one payload.
  const consent = parseAssistantConsent(EVERYTHING)
  const payload = makeAiPayload({ messages, consent, tracker: await collectTrackerSnapshot(consent) })
  const { bodies, fetchMock } = capture(reply)
  await askAssistantDetailed(config, payload, fetchMock)
  expect(bodies).toHaveLength(1)
  return bodies[0]
}

beforeEach(() => fillTracker(localToday()))

describe('no tracker note, free text or calendar date leaves the phone, on every AI path', () => {
  it('a saved "notes" tick from an older version is not a category: it is dropped', () => {
    expect(parseAssistantConsent(EVERYTHING)).toEqual({ cycle: true, symptoms: true, fertility: true })
  })

  for (const path of PATHS) {
    it(`${path.name}: the first message`, async () => {
      const body = await send(path.config, path.reply, [{ role: 'user', content: 'When is my next period?' }])
      expectClean(body)
      // The summary is there, with relative days only.
      expect(body).toContain('sharedCategories')
      expect(body).toMatch(/2 days ago|cycle day|in \d+ days/)
    })

    it(`${path.name}: chat history replay, with earlier answers that had dates`, async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'When is my next period?' },
        // Kept the way the app keeps an answer: guarded at receipt, placeholders stay.
        { role: 'assistant', content: guardAnswerDates('Around [[day:+26]] (about November 26, 2026-11-26).').text, asOf: localToday() },
        { role: 'user', content: 'And the fertile window?' },
        // An answer kept before the guard existed: the payload guards it again.
        { role: 'assistant', content: 'Probably from Dec 3 to December 8 2026, or on Monday.', asOf: '2026-11-15' },
        { role: 'user', content: 'Thanks. What else should I log?' },
      ]
      const body = await send(path.config, path.reply, messages)
      expectClean(body)
      expect(body).toContain('[[day:+26]]')
      expect(body).not.toContain('asOf')
    })
  }
})
