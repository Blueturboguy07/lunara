import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PUBLIK_ENDPOINT,
  isAdultBirthYear,
  namesMoney,
  notLinkedText,
  planLimitText,
  planUseFrom,
  publikBaseUrl,
  publikErrorFrom,
  publikLinkButtonLabel,
  publikModelsFrom,
  publikStatusLine,
  publikUrl,
  PUBLIK_DATA_PATH,
  publikDataPath,
  aiProvidersFrom,
  providerList,
  PUBLIK_LINK_STARTER_MICROS,
  PUBLIK_MODELS,
  PUBLIK_PLAN_SENTENCE,
  readPublikUsage,
  resetsLabel,
  resolvePublikModel,
  usageFromBalance,
  withoutMoney,
  type PublikUsage,
} from './publikApi'

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

describe('where an AI chat message goes on publik', () => {
  it('the founder statement: anonymized, no content stored, billing records only', () => {
    expect(PUBLIK_DATA_PATH).toContain('AI chat is optional')
    expect(PUBLIK_DATA_PATH).toContain('an anonymized summary of the tracker data you tick')
    expect(PUBLIK_DATA_PATH).toContain('go through publik’s servers to the AI provider that answers. It has no name')
    expect(PUBLIK_DATA_PATH).not.toMatch(/Anthropic|Google|OpenAI|for example/)
    expect(publikDataPath(['OpenRouter', 'Google'])).toContain('to the AI provider that answers: OpenRouter or Google. It has no name')
  })

  it('ai_providers: plain company names only, no duplicates, at most 12; anything else counts as absent', () => {
    expect(aiProvidersFrom(['OpenRouter', 'Amazon Web Services', 'OpenAI', 'Google'])).toEqual(['OpenRouter', 'Amazon Web Services', 'OpenAI', 'Google'])
    expect(aiProvidersFrom([' OpenAI ', 'OpenAI', 7, '', '<b>x</b>', 'a'.repeat(61)])).toEqual(['OpenAI'])
    expect(aiProvidersFrom(undefined)).toBeNull()
    expect(aiProvidersFrom('OpenAI')).toBeNull()
    expect(aiProvidersFrom([])).toBeNull()
    expect(aiProvidersFrom(Array.from({ length: 20 }, (_, i) => `Provider ${i}`))).toHaveLength(12)
    expect(providerList(['A'])).toBe('A')
    expect(providerList(['A', 'B', 'C'])).toBe('A, B or C')
    expect(PUBLIK_DATA_PATH).toContain('It has no name, email or birth date.')
    expect(PUBLIK_DATA_PATH).toContain(
      'publik does not store the content of your messages or answers, and does not use it for ads, analytics, training, or sale. It keeps billing records (model, token counts, cost) without content.',
    )
  })
})

// Fixed days at noon UTC: the same weekday in every time zone from UTC-11 to UTC+11.
const NOW = new Date('2026-11-14T12:00:00Z') // a Saturday
const MONDAY = '2026-11-16T12:00:00Z'

function usage(fields: Partial<PublikUsage>): PublikUsage {
  return { ...usageFromBalance(null, 'claimed'), ...fields }
}

describe('AI use is a percent of the plan limit, never money (founder rule, Nov 14 2026)', () => {
  it('publik’s own used_percent first, then remaining_percent, then the used and limit values of the week', () => {
    expect(planUseFrom(usage({ usedPercent: 62, remainingPercent: 10, weekUsedMicros: 1, weekBudgetMicros: 2 }))?.usedPercent).toBe(62)
    expect(planUseFrom(usage({ remainingPercent: 38 }))?.usedPercent).toBe(62)
    expect(planUseFrom(usage({ weekUsedMicros: 1_240_000, weekBudgetMicros: 2_000_000 }))?.usedPercent).toBe(62)
    expect(planUseFrom(usage({ weekUsedMicros: 1_999_000, weekBudgetMicros: 2_000_000 }))).toMatchObject({ usedPercent: 99, limitReached: false })
    expect(planUseFrom(usage({ remainingPercent: 0 }))).toMatchObject({ usedPercent: 100, limitReached: true })
    expect(planUseFrom(usage({ weekUsedMicros: 5, weekBudgetMicros: 0, balanceMicros: 10 }))).toMatchObject({ usedPercent: null, limitReached: false })
  })

  it('the line: "62% of your plan used · resets Monday", with resets_at first and the week reset second', () => {
    expect(publikStatusLine(usage({ usedPercent: 62, resetsAt: MONDAY }), NOW)).toBe('62% of your plan used · resets Monday')
    expect(publikStatusLine(usage({ weekUsedMicros: 62, weekBudgetMicros: 100, weekResetsAt: MONDAY }), NOW)).toBe('62% of your plan used · resets Monday')
    expect(publikStatusLine(usage({ usedPercent: 100, resetsAt: MONDAY }), NOW)).toBe('Plan limit reached · resets Monday')
    expect(publikStatusLine(usage({ usedPercent: 5 }), NOW)).toBe('5% of your plan used')
    expect(resetsLabel('2026-11-14T20:00:00Z', NOW)).toMatch(/^(today|tomorrow)$/)
    expect(resetsLabel('2026-11-15T12:00:00Z', NOW)).toBe('tomorrow')
    expect(resetsLabel('2026-11-28T12:00:00Z', NOW)).toBe('on November 28')
    expect(resetsLabel('2026-11-01T12:00:00Z', NOW)).toBeNull()
    expect(resetsLabel('not a date', NOW)).toBeNull()
  })

  it('no limit to compare with: "Plan active" or "Plan limit reached", with no number', () => {
    expect(publikStatusLine(null)).toBe('Ready')
    expect(publikStatusLine(usage({ balanceMicros: 3_120_000 }), NOW)).toBe('Plan active')
    expect(publikStatusLine(usage({ balanceMicros: 0 }), NOW)).toBe('Plan limit reached')
    expect(publikStatusLine(usage({ balanceMicros: 0, weekResetsAt: MONDAY }), NOW)).toBe('Plan limit reached · resets Monday')
    expect(publikStatusLine(usageFromBalance(0, 'anonymous'), NOW)).toBe('Not linked to a publik plan yet')
    for (const line of [publikStatusLine(usage({ balanceMicros: 3_120_000 }), NOW), publikStatusLine(usage({ balanceMicros: 0 }), NOW)]) {
      expect(line).not.toMatch(/\d/)
    }
  })

  it('the limit-reached message: plain words, when it resets, the storefront rule, and "use your own key"', () => {
    expect(planLimitText(MONDAY, true, NOW)).toBe('Your publik plan limit is reached. It resets Monday. Add a plan or pack at the link below, or use your own key.')
    expect(planLimitText(MONDAY, false, NOW)).toBe(
      'Your publik plan limit is reached. It resets Monday. To get a plan, search for "publik" on Google. Or use your own key.',
    )
    expect(planLimitText(null, false, NOW)).toBe(
      'Your publik plan limit is reached. It resets at the start of the next plan period. To get a plan, search for "publik" on Google. Or use your own key.',
    )
    expect(notLinkedText(false)).not.toMatch(/link below|https?:/)
  })

  it('no amount of money in any usage line, model label or plan sentence, whatever publik reports', () => {
    const lines = [
      PUBLIK_PLAN_SENTENCE,
      ...PUBLIK_MODELS.map((m) => m.label),
      ...[0, 50_000, 3_120_000].flatMap((balance) =>
        [null, 0, 1_200_000].flatMap((weekUsed) =>
          ['anonymous', 'claimed', null].map((claimState) =>
            publikStatusLine(
              usage({ balanceMicros: balance, weekUsedMicros: weekUsed, weekBudgetMicros: 4_600_000, starterRemainingMicros: 50_000, chargeMicros: 1400, claimState: claimState as PublikUsage['claimState'] }),
              NOW,
            ),
          ),
        ),
      ),
    ]
    for (const line of lines) expect(namesMoney(line), line).toBe(false)
  })

  it('a server text that names money is never shown', () => {
    expect(withoutMoney('This app token is not valid.')).toBe('This app token is not valid.')
    for (const text of ['Top up $5 to continue.', 'You have $ 0.05 left.', 'Costs 2 USD.', 'Spend 3 dollars.', '', null]) {
      expect(withoutMoney(text)).toBeNull()
    }
  })
})

describe('publik gateway errors (CONTRACT §1, §12.3)', () => {
  it('402 insufficient_credit while anonymous → needs_credit with the one link, top_up_url', async () => {
    const error = await publikErrorFrom(
      reply(402, {
        error: {
          type: 'insufficient_credit',
          message: 'Not enough publik credit for this request. The model behind this app is billed per use by its provider; publik passes that on at half the list price and nothing is charged behind your back. Link this computer and pick a plan at the link below, or use your own key.',
          available_micros: 1240,
          required_micros: 41000,
          claim_state: 'anonymous',
          top_up_url: 'https://publikhq.com/claim/HK7F-2QWD',
          claim_url: 'https://publikhq.com/claim/HK7F-2QWD',
          add_credit_url: 'https://publikhq.com/dashboard/api/add',
        },
      }),
    )
    expect(error.kind).toBe('needs_credit')
    expect(error.link).toBe('https://publikhq.com/claim/HK7F-2QWD')
    // Fixed words, never the server's: a server message could name an amount of money.
    expect(error.message).toBe('This phone is not linked to a publik plan yet. Link it at the link below, or use your own key.')
    expect(error.planLimit).toBe(false)
  })

  it('402 once claimed → top_up_url is the add-credit page', async () => {
    const error = await publikErrorFrom(
      reply(402, {
        error: {
          type: 'insufficient_credit',
          message: 'Not enough publik credit. Add a plan or a pack at the link below, or use your own key.',
          claim_state: 'claimed',
          top_up_url: 'https://publikhq.com/dashboard/api/add',
          claim_url: null,
          add_credit_url: 'https://publikhq.com/dashboard/api/add',
        },
      }),
    )
    expect(error.kind).toBe('needs_credit')
    expect(error.link).toBe('https://publikhq.com/dashboard/api/add')
    expect(error.planLimit).toBe(true)
    expect(error.message).toMatch(/^Your publik plan limit is reached\. It resets /)
  })

  it('402 and 429 week_budget_reached carry resets_at; a server message with money never shows', async () => {
    const limit = await publikErrorFrom(
      reply(402, { error: { type: 'insufficient_credit', message: 'You spent $4.60 of $4.60.', claim_state: 'claimed', resets_at: MONDAY, top_up_url: 'https://publikhq.com/dashboard/api/add' } }),
    )
    expect(limit.resetsAt).toBe(MONDAY)
    expect(limit.message).not.toContain('$')
    const week = await publikErrorFrom(reply(429, { error: { type: 'week_budget_reached', claim_state: 'claimed', resets_at: MONDAY, top_up_url: 'https://publikhq.com/dashboard/api/add' } }))
    expect(week).toMatchObject({ kind: 'rate_limited', planLimit: true, resetsAt: MONDAY, link: 'https://publikhq.com/dashboard/api/add' })
  })

  it('402 without top_up_url falls back to claim_url (anonymous) or add_credit_url (claimed)', async () => {
    const anon = await publikErrorFrom(reply(402, { error: { type: 'insufficient_credit', claim_state: 'anonymous', claim_url: 'https://publikhq.com/claim/AB', add_credit_url: 'https://publikhq.com/dashboard/api/add' } }))
    expect(anon.link).toBe('https://publikhq.com/claim/AB')
    const claimed = await publikErrorFrom(reply(402, { error: { type: 'insufficient_credit', claim_state: 'claimed', claim_url: null, add_credit_url: 'https://publikhq.com/dashboard/api/add' } }))
    expect(claimed.link).toBe('https://publikhq.com/dashboard/api/add')
  })

  it('402 model_requires_claim → needs_credit with the claim link', async () => {
    const error = await publikErrorFrom(
      reply(402, { error: { type: 'model_requires_claim', message: 'publik-smart is available once this install is linked to a publik account.', claim_state: 'anonymous', top_up_url: 'https://publikhq.com/claim/HK7F-2QWD' } }),
    )
    expect(error.kind).toBe('needs_credit')
    expect(error.link).toBe('https://publikhq.com/claim/HK7F-2QWD')
    expect(error.message).toContain('needs a publik account')
  })

  it('402 while unlinked: no amount, never a spent starter', async () => {
    const error = await publikErrorFrom(reply(402, { error: { type: 'insufficient_credit', claim_state: 'anonymous', top_up_url: 'https://publikhq.com/claim/AB' } }))
    expect(error.kind).toBe('needs_credit')
    expect(error.link).toBe('https://publikhq.com/claim/AB')
    expect(namesMoney(error.message)).toBe(false)
    expect(error.message).not.toMatch(/used up|free starter|credits/i)
  })

  it('drops a top_up_url on any host other than publikhq.com (CONTRACT §11.4)', async () => {
    const error = await publikErrorFrom(reply(402, { error: { type: 'insufficient_credit', claim_state: 'anonymous', top_up_url: 'https://evil.example/claim/X' } }))
    expect(error.link).toBeNull()
  })

  it('401 key_revoked carries reprovision; 401 invalid_api_key is a rejection', async () => {
    const idle = await publikErrorFrom(reply(401, { error: { type: 'key_revoked', message: 'x', reprovision: true } }))
    expect(idle.kind).toBe('disconnected')
    expect(idle.reprovision).toBe(true)
    expect(idle.message).toContain('reconnect')
    const owner = await publikErrorFrom(reply(401, { error: { type: 'key_revoked', message: 'x', reprovision: false } }))
    expect(owner.kind).toBe('disconnected')
    expect(owner.reprovision).toBe(false)
    expect(owner.message).toContain('removed from your publik account')
    const bad = await publikErrorFrom(reply(401, { error: { type: 'invalid_api_key', message: 'x' } }))
    expect(bad.kind).toBe('rejected')
  })

  it('429 daily_cap_reached keeps Retry-After; a plain rate limit has no link', async () => {
    const capped = await publikErrorFrom(reply(429, { error: { type: 'daily_cap_reached', claim_state: 'anonymous', top_up_url: 'https://publikhq.com/claim/HK7F-2QWD' } }, { 'retry-after': '600' }))
    expect(capped.kind).toBe('rate_limited')
    expect(capped.retryAfterSeconds).toBe(600)
    expect(capped.link).toBe('https://publikhq.com/claim/HK7F-2QWD')
    const busy = await publikErrorFrom(reply(429, { error: { type: 'rate_limit_exceeded', top_up_url: 'https://publikhq.com/claim/HK7F-2QWD' } }, { 'retry-after': '2' }))
    expect(busy.link).toBeNull()
    expect(busy.retryAfterSeconds).toBe(2)
  })

  it('5xx and a non-JSON body → unreachable, and says nothing is used from the plan', async () => {
    const error = await publikErrorFrom(new Response('upstream echoed pk_live_secret and tracker text', { status: 502 }))
    expect(error.kind).toBe('unreachable')
    expect(error.message).toContain('Nothing is used from your plan')
    expect(error.message).not.toContain('pk_live_secret')
  })

  it('never shows a vendor-style message from a non-402 body', async () => {
    const error = await publikErrorFrom(reply(500, { error: { type: 'upstream_error', message: 'echoed pk_live_abc' } }))
    expect(error.message).not.toContain('pk_live_abc')
  })
})

describe('publik usage headers (CONTRACT §1, §11.6)', () => {
  it('parses the metered headers and treats week-budget "none" as null', () => {
    const usage = readPublikUsage(
      new Headers({
        'x-publik-balance': '410000',
        'x-publik-week-used': '248760',
        'x-publik-week-budget': 'none',
        'x-publik-week-resets-at': '2026-09-25T17:04:11Z',
        'x-publik-claim-state': 'claimed',
        'x-publik-starter-remaining': '30000',
        'x-publik-charge-micros': '1400',
      }),
    )
    expect(usage).toEqual({
      balanceMicros: 410000,
      weekUsedMicros: 248760,
      weekBudgetMicros: null,
      weekResetsAt: '2026-09-25T17:04:11Z',
      claimState: 'claimed',
      starterRemainingMicros: 30000,
      chargeMicros: 1400,
      usedPercent: null,
      remainingPercent: null,
      resetsAt: null,
    })
  })

  it('falls back to x-publik-balance-micros and leaves unknown fields null', () => {
    const usage = readPublikUsage(new Headers({ 'x-publik-balance-micros': '5' }))
    expect(usage.balanceMicros).toBe(5)
    expect(usage.claimState).toBeNull()
    expect(usage.chargeMicros).toBeNull()
  })
})

describe('publik copy (CONTRACT §1 copy rule)', () => {
  const forbidden = [/credits/i, /openai/i, /tokens?/i, /chatgpt/i]

  it('the status lines, the plan sentence and the button labels have no forbidden unit', () => {
    const lines = [
      publikStatusLine(usageFromBalance(0, 'anonymous'), NOW),
      publikStatusLine(usage({ usedPercent: 40, resetsAt: MONDAY }), NOW),
      PUBLIK_PLAN_SENTENCE,
      publikLinkButtonLabel('anonymous'),
      publikLinkButtonLabel('claimed'),
    ]
    for (const line of lines) {
      for (const pattern of forbidden) expect(line).not.toMatch(pattern)
      expect(line).not.toMatch(/free starter/i)
    }
  })

  it('the 0059 starter grant stays a number the app never shows', () => {
    expect(PUBLIK_LINK_STARTER_MICROS).toBe(50_000)
  })

  it('first-run card: the two button states', () => {
    expect(publikLinkButtonLabel('anonymous')).toBe('Link this phone & pick a plan')
    expect(publikLinkButtonLabel('claimed')).toBe('Add a plan or pack')
  })
})

describe('publik endpoint from the install response (CONTRACT §1 base_url, §2 models)', () => {
  it('accepts an https publikhq.com base_url and rejects anything else', () => {
    expect(publikBaseUrl('https://publikhq.com/api/v1/')).toBe('https://publikhq.com/api/v1')
    expect(publikBaseUrl('https://preview.publikhq.com/api/v1')).toBe('https://preview.publikhq.com/api/v1')
    expect(publikBaseUrl('http://publikhq.com/api/v1')).toBeNull()
    expect(publikBaseUrl('https://api.openai.com/v1')).toBeNull()
    expect(publikUrl('not a url')).toBeNull()
  })

  it('maps a saved tier alias through the announced models and passes unknown ids through', () => {
    const endpoint = { baseUrl: DEFAULT_PUBLIK_ENDPOINT.baseUrl, models: publikModelsFrom({ fast: 'publik-fast', balanced: 'publik-balanced-v2', smart: 'publik-smart' }) }
    expect(resolvePublikModel('publik-balanced', endpoint)).toBe('publik-balanced-v2')
    expect(resolvePublikModel('', endpoint)).toBe('publik-balanced-v2')
    expect(resolvePublikModel(undefined, DEFAULT_PUBLIK_ENDPOINT)).toBe('publik-balanced')
    expect(resolvePublikModel('gpt-4o-mini', endpoint)).toBe('gpt-4o-mini')
    expect(publikModelsFrom(null)).toEqual(DEFAULT_PUBLIK_ENDPOINT.models)
  })
})

describe('adult gate (Lunara knows only the birth year)', () => {
  const now = new Date('2026-09-19T12:00:00')
  it('is true when 19 or more years passed since the birth year; false below, unset or malformed', () => {
    expect(isAdultBirthYear('2007', now)).toBe(true) // 18 or 19 today
    expect(isAdultBirthYear('1990', now)).toBe(true)
    expect(isAdultBirthYear('2008', now)).toBe(false) // 17 or 18 today: could be 17
    expect(isAdultBirthYear('2009', now)).toBe(false)
    expect(isAdultBirthYear(undefined, now)).toBe(false)
    expect(isAdultBirthYear('abcd', now)).toBe(false)
  })

  it('never lets a 17-year-old in, on any day of the year', () => {
    // Born on December 31, 2008: 17 until December 31, 2026.
    for (const day of ['2026-01-01T00:00:01', '2026-06-30T12:00:00', '2026-12-30T23:59:59', '2026-12-31T23:59:59']) {
      expect(isAdultBirthYear('2008', new Date(day))).toBe(false)
    }
    // From January 1, 2027 every person born in 2008 is 18 or older.
    expect(isAdultBirthYear('2008', new Date('2027-01-01T00:00:01'))).toBe(true)
  })
})
