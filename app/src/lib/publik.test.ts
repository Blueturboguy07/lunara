import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---- module doubles: native runtime, vault, settings, build token ---------
const runtime = vi.hoisted(() => ({ isNative: true, nativePlatform: 'ios' as string }))
vi.mock('../native/runtime', () => ({
  get isNative() {
    return runtime.isNative
  },
  get nativePlatform() {
    return runtime.nativePlatform
  },
}))

const vault = vi.hoisted(() => ({
  store: new Map<string, string>(),
  persistence: 'keychain' as 'keychain' | 'keystore' | 'memory',
  writes: [] as string[],
}))
vi.mock('../native/secureVault', () => ({
  SECURE_SECRET_KEYS: { openAiApiKey: 'openai-api-key', anthropicApiKey: 'anthropic-api-key', publikApiKey: 'publik-api-key' },
  secureVaultStatus: async () => ({ available: true, persistence: vault.persistence, hardwareBacked: false, platform: 'ios' }),
  setSecureSecret: async (key: string, value: string) => {
    vault.writes.push(`vault:${key}`)
    vault.store.set(key, value)
  },
  getSecureSecret: async (key: string) => vault.store.get(key) ?? null,
  deleteSecureSecret: async (key: string) => {
    vault.store.delete(key)
  },
  clearSecureSecrets: async () => vault.store.clear(),
}))

const settings = vi.hoisted(() => ({ store: new Map<string, string>(), writes: [] as string[] }))
vi.mock('../db/schema', () => ({
  SK: {
    birthYear: 'birthYear',
    publikInstallId: 'publikInstallId',
    publikClaimUrl: 'publikClaimUrl',
    publikClaimState: 'publikClaimState',
    publikBaseUrl: 'publikBaseUrl',
    publikModels: 'publikModels',
    publikStarterMicros: 'publikStarterMicros',
    publikCostSentence: 'publikCostSentence',
    publikCardSeen: 'publikCardSeen',
    publikDisclosureVersion: 'publikDisclosureVersion',
  },
  getSetting: async (key: string) => settings.store.get(key),
  setSetting: async (key: string, value: string) => {
    settings.writes.push(`setting:${key}`)
    settings.store.set(key, value)
  },
  removeSetting: async (key: string) => {
    settings.store.delete(key)
  },
}))

const build = vi.hoisted(() => ({ token: 'pat_lunara_' + 'a'.repeat(32) }))
vi.mock('./publikBuild', () => ({
  PUBLIK_APP_TOKEN_PLACEHOLDER: 'pat_lunara_REPLACE_ME',
  PUBLIK_BUILD: {
    appSlug: 'lunara',
    appVersion: '0.2.0',
    get appToken() {
      return build.token
    },
    baseUrl: 'https://publikhq.com/api/v1',
    disclosureVersion: 2,
    dialects: ['responses'],
  },
  isPublikAppToken: (t: string) => /^pat_lunara_[a-z0-9]{32}$/.test(t),
  publikBuildAvailable: () => /^pat_lunara_[a-z0-9]{32}$/.test(build.token),
}))

import { disconnectPublik, fetchPublikWallet, provisionPublik, publikAvailable, publikEndpoint, PublikApiError } from './publik'

type Call = { url: string; init: RequestInit | undefined }

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function mintedReply(overrides: Record<string, unknown> = {}) {
  return {
    install_id: 'will-be-replaced',
    key: 'pk_live_abcdefghijkl_' + 'z'.repeat(32),
    key_id: 'abcdefghijkl',
    base_url: 'https://publikhq.com/api/v1',
    models: { fast: 'publik-fast', balanced: 'publik-balanced', smart: 'publik-smart' },
    dialects: ['responses'],
    claim_code: 'HK7F-2QWD',
    claim_url: 'https://publikhq.com/claim/HK7F-2QWD',
    claim_state: 'anonymous',
    starter_micros: 250_000,
    balance_micros: 250_000,
    starting_credit_micros: 250_000,
    disclosure: { version: 1, cost: 'Lunara runs on publik API by default: the AI model behind it is run by a provider that charges per use…', data_path: '…' },
    ...overrides,
  }
}

function fetchSequence(replies: Array<(call: Call) => Response>) {
  const calls: Call[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init }
    calls.push(call)
    const next = replies[Math.min(calls.length - 1, replies.length - 1)]
    return next(call)
  })
  return { fetchImpl: fn as unknown as typeof fetch, calls }
}

beforeEach(() => {
  runtime.isNative = true
  runtime.nativePlatform = 'ios'
  vault.store.clear()
  vault.persistence = 'keychain'
  vault.writes.length = 0
  settings.store.clear()
  settings.writes.length = 0
  settings.store.set('birthYear', '1990')
  build.token = 'pat_lunara_' + 'a'.repeat(32)
})

describe('publikAvailable', () => {
  it('needs a minted token, a native persistent vault and an adult profile', async () => {
    expect(await publikAvailable()).toBe(true)
    build.token = 'pat_lunara_REPLACE_ME'
    expect(await publikAvailable()).toBe(false)
    build.token = 'pat_lunara_' + 'a'.repeat(32)
    runtime.isNative = false
    expect(await publikAvailable()).toBe(false)
    runtime.isNative = true
    vault.persistence = 'memory'
    expect(await publikAvailable()).toBe(false)
    vault.persistence = 'keychain'
    settings.store.set('birthYear', String(new Date().getFullYear() - 16))
    expect(await publikAvailable()).toBe(false)
    settings.store.delete('birthYear')
    expect(await publikAvailable()).toBe(false)
  })

  it('provisionPublik refuses without fetching when publik is unavailable here', async () => {
    build.token = 'pat_lunara_REPLACE_ME'
    const { fetchImpl, calls } = fetchSequence([() => json(201, mintedReply())])
    await expect(provisionPublik({ fetchImpl })).rejects.toBeInstanceOf(PublikApiError)
    expect(calls).toHaveLength(0)
  })
})

describe('provisionPublik (CONTRACT §3.2)', () => {
  it('posts the install body with os ios, no authorization header, and a v4 install_id', async () => {
    const { fetchImpl, calls } = fetchSequence([
      (call) => json(201, mintedReply({ install_id: JSON.parse(String(call.init?.body)).install_id })),
    ])
    const result = await provisionPublik({ fetchImpl })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://publikhq.com/api/v1/installs')
    expect(calls[0].init?.method).toBe('POST')
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBeNull()
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.app_token).toBe(build.token)
    expect(body.app_slug).toBe('lunara')
    expect(body.app_version).toBe('0.2.0')
    expect(body.os).toBe('ios')
    expect(body.arch).toBeNull()
    expect(body.device_name).toBe('iPhone')
    expect(body.disclosure_version).toBe(2)
    expect(body.dialects).toEqual(['responses'])
    expect(body.install_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(result.starterMicros).toBe(250_000)
    expect(result.balanceMicros).toBe(250_000)
    expect(result.claimUrl).toBe('https://publikhq.com/claim/HK7F-2QWD')
    expect(result.claimState).toBe('anonymous')
    expect(result.costSentence).toContain('publik API')
  })

  it('writes the key to the vault before any setting, then remembers id, claim, base_url and models', async () => {
    const { fetchImpl } = fetchSequence([
      (call) => json(201, mintedReply({ install_id: JSON.parse(String(call.init?.body)).install_id, base_url: 'https://publikhq.com/api/v1', models: { fast: 'publik-fast', balanced: 'publik-balanced-v2', smart: 'publik-smart' } })),
    ])
    await provisionPublik({ fetchImpl })
    const order = [...vault.writes, ...settings.writes]
    expect(order[0]).toBe('vault:publik-api-key')
    expect(vault.writes).toEqual(['vault:publik-api-key'])
    expect(settings.store.get('publikClaimUrl')).toBe('https://publikhq.com/claim/HK7F-2QWD')
    expect(settings.store.get('publikClaimState')).toBe('anonymous')
    expect(settings.store.get('publikBaseUrl')).toBe('https://publikhq.com/api/v1')
    expect(settings.store.get('publikStarterMicros')).toBe('250000')
    expect(settings.store.get('publikCostSentence')).toContain('publik API')
    expect(settings.store.get('publikInstallId')).toMatch(/-4/)
    const endpoint = await publikEndpoint()
    expect(endpoint.models.balanced).toBe('publik-balanced-v2')
  })

  it('honours base_url from the response over the compiled default, but never a foreign host', async () => {
    const { fetchImpl } = fetchSequence([
      (call) => json(201, mintedReply({ install_id: JSON.parse(String(call.init?.body)).install_id, base_url: 'https://preview.publikhq.com/api/v1' })),
    ])
    const result = await provisionPublik({ fetchImpl })
    expect(result.endpoint.baseUrl).toBe('https://preview.publikhq.com/api/v1')
    expect((await publikEndpoint()).baseUrl).toBe('https://preview.publikhq.com/api/v1')

    settings.store.clear()
    settings.store.set('birthYear', '1990')
    vault.store.clear()
    const foreign = fetchSequence([
      (call) => json(201, mintedReply({ install_id: JSON.parse(String(call.init?.body)).install_id, base_url: 'https://api.openai.com/v1', claim_url: 'https://evil.example/claim/X' })),
    ])
    const r2 = await provisionPublik({ fetchImpl: foreign.fetchImpl })
    expect(r2.endpoint.baseUrl).toBe('https://publikhq.com/api/v1')
    expect(r2.claimUrl).toBeNull()
  })

  it('replay 200 key:null with no key in the vault → drops the stored id and mints again with a new one', async () => {
    settings.store.set('publikInstallId', '11111111-1111-4111-8111-111111111111')
    const { fetchImpl, calls } = fetchSequence([
      () => json(200, mintedReply({ install_id: '11111111-1111-4111-8111-111111111111', key: null, starter_micros: 0 })),
      (call) => json(201, mintedReply({ install_id: JSON.parse(String(call.init?.body)).install_id })),
    ])
    const result = await provisionPublik({ fetchImpl })
    expect(calls).toHaveLength(2)
    const first = JSON.parse(String(calls[0].init?.body)).install_id
    const second = JSON.parse(String(calls[1].init?.body)).install_id
    expect(first).toBe('11111111-1111-4111-8111-111111111111')
    expect(second).not.toBe(first)
    expect(result.key).not.toBeNull()
    expect(vault.store.get('publik-api-key')).toBe(result.key)
  })

  it('replay 200 key:null with a key already in the vault → no second POST, settings refreshed, no starter', async () => {
    settings.store.set('publikInstallId', '11111111-1111-4111-8111-111111111111')
    vault.store.set('publik-api-key', 'pk_live_existing_key')
    const { fetchImpl, calls } = fetchSequence([
      () => json(200, mintedReply({ install_id: '11111111-1111-4111-8111-111111111111', key: null, starter_micros: 0, balance_micros: 90_000, claim_state: 'claimed', claim_url: null })),
    ])
    const result = await provisionPublik({ fetchImpl })
    expect(calls).toHaveLength(1)
    expect(result.key).toBeNull()
    expect(result.starterMicros).toBe(0)
    expect(result.balanceMicros).toBe(90_000)
    expect(vault.store.get('publik-api-key')).toBe('pk_live_existing_key')
    expect(settings.store.get('publikClaimState')).toBe('claimed')
    expect(settings.store.has('publikClaimUrl')).toBe(false)
  })

  it('403 install_revoked on a known install → forgets it and mints a fresh anonymous install once', async () => {
    settings.store.set('publikInstallId', '11111111-1111-4111-8111-111111111111')
    vault.store.set('publik-api-key', 'pk_live_old')
    const { fetchImpl, calls } = fetchSequence([
      () => json(403, { error: { type: 'install_revoked', message: 'x', reprovision: false } }),
      (call) => json(201, mintedReply({ install_id: JSON.parse(String(call.init?.body)).install_id })),
    ])
    const result = await provisionPublik({ fetchImpl })
    expect(calls).toHaveLength(2)
    expect(JSON.parse(String(calls[1].init?.body)).install_id).not.toBe('11111111-1111-4111-8111-111111111111')
    expect(result.key).not.toBe('pk_live_old')
  })

  it('a network failure is an unreachable PublikApiError that says nothing is charged', async () => {
    const fetchImpl = (async () => {
      throw new Error('Could not reach the AI provider. Check your network connection.')
    }) as unknown as typeof fetch
    await expect(provisionPublik({ fetchImpl })).rejects.toMatchObject({ kind: 'unreachable', message: expect.stringContaining('Nothing is being charged') })
  })

  it('a 429 from the mint surfaces as rate_limited and writes nothing', async () => {
    const { fetchImpl } = fetchSequence([() => json(429, { error: { type: 'rate_limit_exceeded', message: 'x' } }, { 'retry-after': '3600' })])
    await expect(provisionPublik({ fetchImpl })).rejects.toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 3600 })
    expect(vault.store.size).toBe(0)
    expect(settings.store.has('publikInstallId')).toBe(false)
  })
})

describe('fetchPublikWallet', () => {
  it('sends the bearer to /wallet on the remembered base_url and restores install_id + claim link', async () => {
    vault.store.set('publik-api-key', 'pk_live_test')
    settings.store.set('publikBaseUrl', 'https://preview.publikhq.com/api/v1')
    const { fetchImpl, calls } = fetchSequence([
      () =>
        json(200, {
          install_id: '22222222-2222-4222-8222-222222222222',
          claim_state: 'anonymous',
          balance_micros: 410_000,
          starter: { remaining_micros: 160_000, expires_at: null },
          week: { used_micros: 90_000, budget_micros: null, resets_at: '2026-09-25T17:04:11Z' },
          claim_code: 'HK7F-2QWD',
          claim_url: 'https://publikhq.com/claim/HK7F-2QWD',
          add_credit_url: 'https://publikhq.com/dashboard/api/add',
          top_up_url: 'https://publikhq.com/claim/HK7F-2QWD',
          base_url: 'https://publikhq.com/api/v1',
        }),
    ])
    const wallet = await fetchPublikWallet(fetchImpl)
    expect(calls[0].url).toBe('https://preview.publikhq.com/api/v1/wallet')
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe('Bearer pk_live_test')
    expect(wallet.balanceMicros).toBe(410_000)
    expect(wallet.starterRemainingMicros).toBe(160_000)
    expect(wallet.weekUsedMicros).toBe(90_000)
    expect(wallet.weekBudgetMicros).toBeNull()
    expect(wallet.topUpUrl).toBe('https://publikhq.com/claim/HK7F-2QWD')
    expect(settings.store.get('publikInstallId')).toBe('22222222-2222-4222-8222-222222222222')
    expect(settings.store.get('publikClaimUrl')).toBe('https://publikhq.com/claim/HK7F-2QWD')
    expect(settings.store.get('publikBaseUrl')).toBe('https://publikhq.com/api/v1')
  })

  it('throws disconnected without a key and never fetches', async () => {
    const { fetchImpl, calls } = fetchSequence([() => json(200, {})])
    await expect(fetchPublikWallet(fetchImpl)).rejects.toMatchObject({ kind: 'disconnected' })
    expect(calls).toHaveLength(0)
  })
})

describe('disconnectPublik', () => {
  it('revokes with the bearer, then deletes the vault entry and every publik setting', async () => {
    vault.store.set('publik-api-key', 'pk_live_test')
    for (const key of ['publikInstallId', 'publikClaimUrl', 'publikClaimState', 'publikBaseUrl', 'publikModels', 'publikStarterMicros', 'publikCostSentence', 'publikCardSeen']) {
      settings.store.set(key, 'x')
    }
    const { fetchImpl, calls } = fetchSequence([() => new Response(null, { status: 204 })])
    await disconnectPublik(fetchImpl)
    expect(calls[0].url).toBe('https://publikhq.com/api/v1/installs/revoke')
    expect(calls[0].init?.method).toBe('POST')
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe('Bearer pk_live_test')
    expect(vault.store.has('publik-api-key')).toBe(false)
    expect([...settings.store.keys()].filter((k) => k.startsWith('publik'))).toEqual([])
  })

  it('still clears local state when the revoke call throws', async () => {
    vault.store.set('publik-api-key', 'pk_live_test')
    settings.store.set('publikInstallId', 'x')
    const fetchImpl = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    await disconnectPublik(fetchImpl)
    expect(vault.store.has('publik-api-key')).toBe(false)
    expect(settings.store.has('publikInstallId')).toBe(false)
  })
})
