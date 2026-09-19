import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PUBLIK_ENDPOINT,
  dollars,
  isAdultBirthYear,
  publikBalanceLine,
  publikBaseUrl,
  publikErrorFrom,
  publikLinkButtonLabel,
  publikModelsFrom,
  publikStatusLine,
  publikUrl,
  PUBLIK_WHY_IT_COSTS,
  readPublikUsage,
  resolvePublikModel,
} from './publikApi'

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

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
    expect(error.message).toContain('nothing is charged behind your back')
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
    expect(error.message).toContain('linked to a publik account')
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

  it('5xx and a non-JSON body → unreachable, and says nothing is charged', async () => {
    const error = await publikErrorFrom(new Response('upstream echoed pk_live_secret and tracker text', { status: 502 }))
    expect(error.kind).toBe('unreachable')
    expect(error.message).toContain('Nothing is being charged')
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
        'x-publik-claim-state': 'anonymous',
        'x-publik-starter-remaining': '120000',
        'x-publik-charge-micros': '1400',
      }),
    )
    expect(usage).toEqual({
      balanceMicros: 410000,
      weekUsedMicros: 248760,
      weekBudgetMicros: null,
      weekResetsAt: '2026-09-25T17:04:11Z',
      claimState: 'anonymous',
      starterRemainingMicros: 120000,
      chargeMicros: 1400,
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

  it('formats dollars and the status line without a forbidden unit', () => {
    expect(dollars(250_000)).toBe('$0.25')
    expect(publikStatusLine(null)).toBe('Ready')
    const anon = publikStatusLine({ balanceMicros: 120000, weekUsedMicros: 10, weekBudgetMicros: null, weekResetsAt: null, starterRemainingMicros: 120000, claimState: 'anonymous', chargeMicros: null })
    expect(anon).toBe('$0.12 left of free starter usage · link this phone to add more')
    const claimed = publikStatusLine({ balanceMicros: 3_120_000, weekUsedMicros: 1_200_000, weekBudgetMicros: 4_600_000, weekResetsAt: null, starterRemainingMicros: null, claimState: 'claimed', chargeMicros: null })
    expect(claimed).toBe('$3.12 left · this week $1.20 of $4.60')
    for (const line of [anon, claimed, PUBLIK_WHY_IT_COSTS, publikBalanceLine(250_000, 'anonymous'), publikLinkButtonLabel('anonymous'), publikLinkButtonLabel('claimed')]) {
      for (const pattern of forbidden) expect(line).not.toMatch(pattern)
    }
  })

  it('first-run card lines: balance from the mint, then the two button states', () => {
    expect(publikBalanceLine(250_000, 'anonymous')).toBe('$0.25 of free starter usage')
    expect(publikBalanceLine(null, null)).toBe('Checking your publik balance…')
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

describe('adult gate', () => {
  const now = new Date('2026-09-19T00:00:00Z')
  it('is true at 18 and false below, unset or malformed', () => {
    expect(isAdultBirthYear('2008', now)).toBe(true)
    expect(isAdultBirthYear('2009', now)).toBe(false)
    expect(isAdultBirthYear(undefined, now)).toBe(false)
    expect(isAdultBirthYear('abcd', now)).toBe(false)
  })
})
