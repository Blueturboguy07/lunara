import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Sign in with publik, run against a fake publik: the gate's screens and
 * words, the 3-second check that stops in the background and runs at once on
 * return, the offline start after the first sign-in, the self-test line, the
 * PUBLIK_API_BASE_URL test hook, and usage counting (two events, no health data).
 */

// ---- module doubles ---------------------------------------------------------
const runtime = vi.hoisted(() => ({ isNative: true, nativePlatform: 'ios' as string }))
vi.mock('../native/runtime', () => ({
  get isNative() {
    return runtime.isNative
  },
  get nativePlatform() {
    return runtime.nativePlatform
  },
}))

const vault = vi.hoisted(() => ({ store: new Map<string, string>() }))
vi.mock('../native/secureVault', () => ({
  SECURE_SECRET_KEYS: { openAiApiKey: 'openai-api-key', anthropicApiKey: 'anthropic-api-key', publikApiKey: 'publik-api-key' },
  secureVaultStatus: async () => ({ available: true, persistence: 'keychain', hardwareBacked: false, platform: 'ios' }),
  setSecureSecret: async (key: string, value: string) => {
    vault.store.set(key, value)
  },
  getSecureSecret: async (key: string) => vault.store.get(key) ?? null,
  deleteSecureSecret: async (key: string) => {
    vault.store.delete(key)
  },
}))

const settings = vi.hoisted(() => ({ store: new Map<string, string>() }))
vi.mock('../db/schema', () => {
  const keys = [
    'birthYear', 'aiProvider', 'aiModel', 'aiBaseUrl',
    'publikInstallId', 'publikClaimUrl', 'publikClaimState', 'publikBaseUrl', 'publikModels', 'publikStarterMicros',
    'publikCostSentence', 'publikCardSeen', 'publikDisclosureVersion', 'publikChoice', 'publikTelemetryId', 'publikUsage',
  ]
  return {
    SK: Object.fromEntries(keys.map((k) => [k, k])),
    getSetting: async (key: string) => settings.store.get(key),
    setSetting: async (key: string, value: string) => {
      settings.store.set(key, value)
    },
    removeSetting: async (key: string) => {
      settings.store.delete(key)
    },
  }
})

vi.mock('./publikBuild', () => ({
  PUBLIK_APP_TOKEN_PLACEHOLDER: 'pat_lunara_REPLACE_ME',
  PUBLIK_BUILD: {
    appSlug: 'lunara',
    appVersion: '0.2.1',
    appToken: 'pat_lunara_' + 'g'.repeat(32),
    baseUrl: 'https://publikhq.com/api/v1',
    disclosureVersion: 3,
    dialects: ['responses'],
  },
  isPublikAppToken: (t: string) => /^pat_lunara_[a-z0-9]{32}$/.test(t),
  publikBuildAvailable: () => true,
}))

const native = vi.hoisted(() => ({
  launch: {} as Record<string, string>,
  selfTestLines: [] as string[],
  appState: null as null | ((state: { isActive: boolean }) => void),
  browserFinished: null as null | (() => void),
  closed: 0,
}))
vi.mock('../native/bridge', () => ({
  getLunaraNativeBridge: () => ({
    publikLaunchOptions: async () => native.launch,
    publikSelfTestDone: async ({ line }: { line: string }) => {
      native.selfTestLines.push(line)
    },
  }),
}))
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (_event: string, callback: (state: { isActive: boolean }) => void) => {
      native.appState = callback
      return { remove: async () => undefined }
    },
  },
}))
vi.mock('@capacitor/browser', () => ({
  Browser: {
    addListener: async (_event: string, callback: () => void) => {
      native.browserFinished = callback
      return { remove: async () => undefined }
    },
    close: async () => {
      native.closed++
    },
    open: async () => undefined,
  },
}))

// The fake publik: /installs, /wallet, /telemetry. `wallets` is a queue; the last one repeats.
type Wallet = { claim_state: 'anonymous' | 'claimed'; account?: { handle: string | null } | null; plan?: { kind: string; label: string | null }; balance_micros?: number }
const net = vi.hoisted(() => ({
  offline: false,
  wallets: [] as Wallet[],
  walletStatus: 200,
  installsStatus: 201,
  revokedKey: '',
  calls: [] as Array<{ url: string; method: string; auth: string | null; body: string | null }>,
}))
vi.mock('./providerFetch', () => ({
  providerFetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    net.calls.push({ url, method: init?.method ?? 'GET', auth: headers.get('authorization'), body: typeof init?.body === 'string' ? init.body : null })
    if (net.offline) throw new Error('Could not reach the AI provider. Check your network connection.')
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const base = url.replace(/\/api\/v1\/.*$/, '')
    if (url.endsWith('/api/v1/installs')) {
      if (net.installsStatus !== 201) return json(net.installsStatus, { error: { type: 'invalid_app_token', message: 'This app token is not valid.' } })
      const sent = JSON.parse(String(init?.body)) as { install_id: string }
      return json(201, { key: 'pk_live_gatetest', install_id: sent.install_id, claim_url: `${base}/claim/abc`, claim_state: 'anonymous', base_url: `${base}/api/v1`, balance_micros: 0 })
    }
    if (url.endsWith('/api/v1/wallet')) {
      if (net.walletStatus !== 200 || headers.get('authorization') === `Bearer ${net.revokedKey}`) return json(net.walletStatus !== 200 ? net.walletStatus : 401, { error: { type: 'invalid_key', message: 'This key is not valid.' } })
      const w = net.wallets.length > 1 ? net.wallets.shift()! : net.wallets[0]!
      return json(200, { plan: { kind: 'none', label: null }, balance_micros: 0, account: null, ...w, claim_url: `${base}/claim/abc`, top_up_url: `${base}/wallet?top_up=1`, linked_at: null })
    }
    if (url.endsWith('/api/v1/telemetry')) return new Response(null, { status: 204 })
    return json(404, {})
  },
}))

import { _resetPublikForTests, ensureSignedIn, gateScreen, type GateScreen, type GateUI } from './publik'

const WORDS = {
  title: 'Sign in with publik',
  signInBody: 'This app uses your publik account. Click Sign in with publik, then sign in in your browser. This window continues when you are signed in.',
  waiting: 'Waiting for you to sign in in your browser.',
  timeout: 'No sign-in after 10 minutes. Click Sign in with publik to try again.',
  unreachable: 'publik is not reachable. Check your connection.',
  chooseTitle: 'Choose how to pay for AI',
  planWaiting: 'Waiting for your plan. Finish in your browser.',
  connectTitle: 'Connect your plan',
} as const

const anonymous: Wallet = { claim_state: 'anonymous' }
const claimedEmpty: Wallet = { claim_state: 'claimed', account: { handle: 'mann' }, plan: { kind: 'none', label: null }, balance_micros: 0 }
const claimedPlan: Wallet = { claim_state: 'claimed', account: { handle: 'mann' }, plan: { kind: 'plan', label: 'Plus' }, balance_micros: 0 }

/** Presses a button by screen title, or the first button of a screen with no note; otherwise waits for the gate to move on. */
function scriptedUI(press: Record<string, string> = {}) {
  const screens: GateScreen[] = []
  const opened: string[] = []
  const ui: GateUI = {
    show(screen) {
      screens.push(screen)
      const want = press[screen.title]
      if (want === 'wait') return new Promise(() => {})
      if (want) return Promise.resolve(screen.buttons.find((b) => b.label === want)!.action)
      if (!screen.note && screen.id !== 'unreachable') return Promise.resolve(screen.buttons[0]!.action)
      return new Promise(() => {})
    },
    openUrl(url) {
      opened.push(url)
    },
  }
  return { ui, screens, opened }
}

const telemetryCalls = () => net.calls.filter((c) => c.url.endsWith('/api/v1/telemetry'))
const walletCalls = () => net.calls.filter((c) => c.url.endsWith('/api/v1/wallet'))

beforeEach(() => {
  vi.useFakeTimers()
  _resetPublikForTests()
  runtime.isNative = true
  runtime.nativePlatform = 'ios'
  vault.store.clear()
  settings.store.clear()
  settings.store.set('birthYear', '1990')
  native.launch = {}
  native.selfTestLines = []
  native.closed = 0
  net.offline = false
  net.wallets = [anonymous]
  net.walletStatus = 200
  net.installsStatus = 201
  net.revokedKey = ''
  net.calls = []
})

afterEach(() => {
  _resetPublikForTests()
  vi.useRealTimers()
})

describe('the gate words', () => {
  it('are the words of every publik module', () => {
    expect(gateScreen('sign_in', null)).toMatchObject({ title: WORDS.title, body: WORDS.signInBody, buttons: [{ action: 'sign_in', label: 'Sign in with publik' }] })
    expect(gateScreen('unreachable', null)).toMatchObject({ title: WORDS.title, body: WORDS.unreachable, buttons: [{ action: 'retry', label: 'Retry' }] })
    const choose = gateScreen('choose', { claim_state: 'claimed', claim_url: null, account: { handle: 'mann' }, plan: { kind: 'none', label: null }, balance_micros: 0, top_up_url: 'x', linked_at: null })
    expect(choose.title).toBe(WORDS.chooseTitle)
    expect(choose.body).toBe('You are signed in as @mann. This app uses AI. Get a publik plan, or use your own key.')
    expect(choose.buttons.map((b) => b.label)).toEqual(['Get a plan', 'Use my own key'])
    const connect = gateScreen('choose', { claim_state: 'claimed', claim_url: null, account: null, plan: { kind: 'pack', label: null }, balance_micros: 2_500_000, top_up_url: 'x', linked_at: null })
    expect(connect.title).toBe(WORDS.connectTitle)
    expect(connect.body).toBe('You are signed in to publik. Your balance: $2.50. Connect it to use AI in this app, or use your own key.')
    expect(connect.buttons.map((b) => b.label)).toEqual(['Connect your plan', 'Use my own key'])
  })

  it('the module file holds what the publik scan looks for, in code', () => {
    const code = readFileSync(new URL('./publik.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(code).toContain('/api/v1/installs')
    expect(code).toContain('/api/v1/telemetry')
    expect(code).toContain("'app_opened'")
    expect(code).toMatch(/export const APP_SLUG = "lunara"/)
  })
})

describe('ensureSignedIn against a fake publik', () => {
  it('sign in, get a plan, connect it, then count the open with the install key', async () => {
    net.wallets = [anonymous, anonymous, anonymous, claimedEmpty, claimedEmpty, claimedEmpty, claimedPlan]
    const { ui, screens, opened } = scriptedUI()
    const result = ensureSignedIn(ui)
    await vi.advanceTimersByTimeAsync(20_000)
    const gate = await result
    expect(screens.map((s) => [s.title, s.note])).toEqual([
      [WORDS.title, null],
      [WORDS.title, WORDS.waiting],
      [WORDS.chooseTitle, null],
      [WORDS.chooseTitle, WORDS.planWaiting],
      [WORDS.connectTitle, null],
    ])
    expect(screens[4]!.body).toBe('You are signed in as @mann. Your plan: Plus. Connect it to use AI in this app, or use your own key.')
    expect(opened).toEqual(['https://publikhq.com/claim/abc', 'https://publikhq.com/wallet?top_up=1'])
    expect(native.closed).toBe(2) // the in-app browser closes when publik says sign-in, then the plan, is done
    expect(gate).toMatchObject({ key: 'pk_live_gatetest', choice: 'publik', chosenNow: true, offline: false })
    expect(settings.store.get('publikChoice')).toBe('publik')
    expect(settings.store.get('publikClaimState')).toBe('claimed')

    // Usage counting: after the gate, with the install key, the telemetry fields and nothing else.
    const events = telemetryCalls()
    expect(events).toHaveLength(1)
    expect(events[0]!.auth).toBe('Bearer pk_live_gatetest')
    const first = JSON.parse(events[0]!.body!) as Record<string, unknown>
    expect(Object.keys(first).sort()).toEqual(['app', 'app_version', 'event', 'install_id', 'os', 'v'])
    expect(first).toMatchObject({ v: 1, app: 'lunara', event: 'app_opened', app_version: '0.2.1', os: 'ios' })
    expect(String(first.install_id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(JSON.parse(telemetryCalls()[1]!.body!)).toMatchObject({ event: 'active_session', install_id: first.install_id })

    // /installs carries no key; every /wallet call carries it; no screen shows it.
    expect(net.calls.filter((c) => c.url.endsWith('/installs')).every((c) => c.auth === null)).toBe(true)
    expect(walletCalls().every((c) => c.auth === 'Bearer pk_live_gatetest')).toBe(true)
    expect(JSON.stringify(screens)).not.toContain('pk_live')
  })

  it('Use my own key is stored, and the next start skips the plan screen', async () => {
    net.wallets = [claimedEmpty]
    const first = scriptedUI({ [WORDS.chooseTitle]: 'Use my own key' })
    const run = ensureSignedIn(first.ui)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await run).toMatchObject({ choice: 'own_key', chosenNow: true })
    expect(first.screens.map((s) => s.title)).toEqual([WORDS.chooseTitle])

    _resetPublikForTests()
    const second = scriptedUI()
    const again = ensureSignedIn(second.ui)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await again).toMatchObject({ choice: 'own_key', chosenNow: false })
    expect(second.screens).toEqual([])
  })

  it('there is no other way past the sign-in screen while publik says anonymous', async () => {
    const { ui, screens } = scriptedUI()
    let passed = false
    void ensureSignedIn(ui).then(() => {
      passed = true
    })
    await vi.advanceTimersByTimeAsync(11 * 60_000)
    expect(passed).toBe(false)
    expect(screens.every((s) => s.title === WORDS.title && s.buttons.length === 1)).toBe(true)
    expect(screens.at(-1)!.note).toBe(WORDS.timeout)
    expect(telemetryCalls()).toHaveLength(0)
  })

  it('offline before the first sign-in: "publik is not reachable" and Retry, nothing else', async () => {
    net.offline = true
    const { ui, screens } = scriptedUI()
    let passed = false
    void ensureSignedIn(ui).then(() => {
      passed = true
    })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(passed).toBe(false)
    expect(screens).toEqual([{ id: 'unreachable', title: WORDS.title, body: WORDS.unreachable, note: null, buttons: [{ action: 'retry', label: 'Retry' }] }])
  })

  it('offline after the first sign-in: Lunara opens on the last answer, with no screen', async () => {
    vault.store.set('publik-api-key', 'pk_live_saved')
    settings.store.set('publikInstallId', '11111111-1111-4111-8111-111111111111')
    settings.store.set('publikClaimState', 'claimed')
    settings.store.set('publikChoice', 'own_key')
    net.offline = true
    const { ui, screens } = scriptedUI()
    const run = ensureSignedIn(ui)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await run).toMatchObject({ key: 'pk_live_saved', choice: 'own_key', offline: true })
    expect(screens).toEqual([])
  })

  it('a phone that signed in before also opens when publik answers 5xx', async () => {
    vault.store.set('publik-api-key', 'pk_live_saved')
    settings.store.set('publikClaimState', 'claimed')
    settings.store.set('publikChoice', 'publik')
    net.walletStatus = 503
    const { ui, screens } = scriptedUI()
    const run = ensureSignedIn(ui)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await run).toMatchObject({ choice: 'publik', offline: true })
    expect(screens).toEqual([])
  })

  it('a revoked key (401) provisions a new install, which must sign in again', async () => {
    vault.store.set('publik-api-key', 'pk_live_old')
    settings.store.set('publikClaimState', 'claimed')
    net.revokedKey = 'pk_live_old'
    const { ui, screens } = scriptedUI({ [WORDS.title]: 'wait' })
    void ensureSignedIn(ui)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(net.calls.filter((c) => c.url.endsWith('/api/v1/installs'))).toHaveLength(1)
    expect(vault.store.get('publik-api-key')).toBe('pk_live_gatetest')
    expect(settings.store.get('publikClaimState')).toBe('anonymous')
    expect(screens.map((s) => s.id)).toEqual(['sign_in'])
  })

  it('a new key that publik refuses at once too waits for Retry instead of looping', async () => {
    net.walletStatus = 401
    const { ui, screens } = scriptedUI()
    void ensureSignedIn(ui)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(net.calls.filter((c) => c.url.endsWith('/api/v1/installs'))).toHaveLength(2)
    expect(screens).toEqual([{ id: 'unreachable', title: WORDS.title, body: 'This key is not valid.', note: null, buttons: [{ action: 'retry', label: 'Retry' }] }])
  })

  it('checks every 3 s in the foreground, never in the background, and at once on return', async () => {
    const { ui, screens } = scriptedUI()
    void ensureSignedIn(ui)
    await vi.advanceTimersByTimeAsync(7_000) // pressed Sign in; two checks while waiting
    expect(screens.at(-1)!.note).toBe(WORDS.waiting)
    native.appState!({ isActive: false }) // the person is in the browser app
    const before = walletCalls().length
    await vi.advanceTimersByTimeAsync(12 * 60_000) // longer than the 10-minute limit
    expect(walletCalls().length).toBe(before)
    net.wallets = [claimedPlan]
    native.appState!({ isActive: true })
    await vi.advanceTimersByTimeAsync(10) // no 3-second wait: the return wakes the check
    expect(walletCalls().length).toBe(before + 2) // the check that saw the sign-in, then the gate's next read
    expect(screens.some((s) => s.note === WORDS.timeout)).toBe(false)
    expect(screens.at(-1)!.title).toBe(WORDS.connectTitle)
  })

  it('closing the in-app browser checks at once', async () => {
    const { ui } = scriptedUI()
    void ensureSignedIn(ui)
    await vi.advanceTimersByTimeAsync(10)
    const before = walletCalls().length
    native.browserFinished!()
    await vi.advanceTimersByTimeAsync(10)
    expect(walletCalls().length).toBe(before + 1)
  })

  it('a known minor and a browser build skip the plan screen', async () => {
    settings.store.set('birthYear', String(new Date().getFullYear() - 15))
    net.wallets = [claimedEmpty]
    const minor = scriptedUI()
    const run = ensureSignedIn(minor.ui)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await run).toMatchObject({ choice: null })
    expect(minor.screens).toEqual([])

    _resetPublikForTests()
    settings.store.set('birthYear', '1990')
    runtime.isNative = false
    runtime.nativePlatform = 'web'
    const web = scriptedUI()
    const webRun = ensureSignedIn(web.ui)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await webRun).toMatchObject({ choice: null })
    expect(web.screens).toEqual([])
  })
})

describe('the self-test and the test hook', () => {
  it('PUBLIK_SELF_TEST prints the ok line only after a real GET /wallet answers, then ends the app', async () => {
    native.launch = { PUBLIK_SELF_TEST: '1' }
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { ui, screens } = scriptedUI()
    void ensureSignedIn(ui)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(native.selfTestLines).toEqual(['publik self-test: ok lunara 0.2.1'])
    expect(net.calls.map((c) => c.url)).toEqual(['https://publikhq.com/api/v1/installs', 'https://publikhq.com/api/v1/wallet'])
    expect(JSON.parse(net.calls[0]!.body!)).toMatchObject({ app_slug: 'lunara', app_version: '0.2.1', os: 'ios' })
    expect(screens).toEqual([])
    log.mockRestore()
  })

  it('the self-test names the failure', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    native.launch = { PUBLIK_SELF_TEST: '1' }
    net.walletStatus = 500
    void ensureSignedIn(scriptedUI().ui)
    await vi.advanceTimersByTimeAsync(1_000)
    _resetPublikForTests()
    net.offline = true
    void ensureSignedIn(scriptedUI().ui)
    await vi.advanceTimersByTimeAsync(30_000)
    _resetPublikForTests()
    net.offline = false
    net.installsStatus = 401
    vault.store.clear()
    settings.store.delete('publikInstallId')
    void ensureSignedIn(scriptedUI().ui)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(native.selfTestLines).toEqual([
      'publik self-test: failed: This key is not valid.',
      'publik self-test: failed: publik is not reachable. Check your connection.',
      'publik self-test: failed: This app token is not valid.',
    ])
    log.mockRestore()
  })

  it('PUBLIK_API_BASE_URL points every call at another publik', async () => {
    native.launch = { PUBLIK_API_BASE_URL: 'http://127.0.0.1:8787/api/v1/' }
    net.wallets = [anonymous, anonymous, claimedPlan]
    const { ui, opened } = scriptedUI({ [WORDS.connectTitle]: 'Connect your plan' })
    const run = ensureSignedIn(ui)
    await vi.advanceTimersByTimeAsync(10_000)
    await run
    expect(opened).toEqual(['http://127.0.0.1:8787/claim/abc'])
    expect(net.calls.length).toBeGreaterThan(3)
    expect(net.calls.every((c) => c.url.startsWith('http://127.0.0.1:8787/api/v1/'))).toBe(true)
    expect(telemetryCalls()).toHaveLength(1)
  })
})

describe('usage counting can be turned off', () => {
  it('Settings "Count my use" off: no event, no telemetry ID', async () => {
    settings.store.set('publikUsage', 'off')
    net.wallets = [claimedPlan]
    settings.store.set('publikChoice', 'publik')
    const run = ensureSignedIn(scriptedUI().ui)
    await vi.advanceTimersByTimeAsync(31 * 60_000)
    await run
    expect(telemetryCalls()).toHaveLength(0)
    expect(settings.store.has('publikTelemetryId')).toBe(false)
  })

  it('DO_NOT_TRACK at launch: no event', async () => {
    native.launch = { DO_NOT_TRACK: '1' }
    net.wallets = [claimedPlan]
    settings.store.set('publikChoice', 'own_key')
    const run = ensureSignedIn(scriptedUI().ui)
    await vi.advanceTimersByTimeAsync(1_000)
    await run
    expect(telemetryCalls()).toHaveLength(0)
  })
})
