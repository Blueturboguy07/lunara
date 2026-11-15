/**
 * Lunara's publik module: Sign in with publik, usage counting, and publik API
 * as one provider option. It is the reference module
 * (publikhq.com/sdk/publik.ts.md) moved from Node to the Capacitor WebView:
 * the same gate, the same words, the same endpoints. On a phone:
 *   - the pk_ key lives in the Keychain / Keystore vault (`publik-api-key`);
 *     the rest of the credential (install id, claim link, claim state, the
 *     plan choice) lives in Lunara's settings table and never goes into a
 *     backup (db/transfer.ts). A browser build keeps the key in localStorage;
 *   - requests go through providerFetch (native HTTP on iOS and Android);
 *   - Sign in with publik opens claim_url with in_app=1 (publik's bare in-app page) in the
 *     in-app sheet (SFSafariViewController on iOS, a Custom Tab on Android). While the app
 *     is in the foreground it checks GET /wallet every 3 seconds; when the app
 *     comes back from the background, or the sheet closes, it checks at once.
 *     iOS: the web view's timers stop while the sheet covers it, so the native shell
 *     (LunaraNativePlugin.swift, publikSheetOpen) checks GET /wallet itself every 3 s
 *     on a fixed grid for 10 minutes, each check with an 8 s limit, and closes the sheet
 *     when publik says the work is done;
 *   - offline, a phone that signed in before goes straight in. Lunara is
 *     local-first: only the first sign-in needs the network.
 *
 * At app start, before any screen of Lunara's own: `const gate = await ensureSignedIn(ui)`
 * (components/PublikGate.tsx does this). It
 *   1. loads or provisions this phone's publik key (POST /api/v1/installs);
 *   2. shows Sign in with publik until GET /api/v1/wallet says "claimed" (no other way past it);
 *   3. when USES_AI and the person is a known adult: asks once how the app pays for AI and
 *      stores the answer (setChoice() changes it). With no birth year yet (a first start),
 *      the plan screen waits: onboarding asks the age, then the gate runs again;
 *   4. starts usage counting: app_opened now, active_session every 30 minutes (POST /api/v1/telemetry).
 *      An event carries the slug, the version, the phone type and a random ID. Never a log,
 *      a cycle date or any other health data.
 *
 * The build setting PUBLIK_GATE_MODE=optional (lib/buildFlags.ts) opens the tracker with no
 * wall instead: openWithoutWall() at start (usage counting only if this phone signed in
 * before), and signInOnDemand(ui) when the person opens Lunara AI or the publik row in
 * Settings. That screen has a "Not now" button; usage counting starts only after sign-in.
 *
 * Test hooks, in a test build only (PUBLIK_TEST_HOOKS=1 in the web bundle AND in the
 * native build; lib/buildFlags.ts) or `pnpm dev`: PUBLIK_API_BASE_URL (a launch
 * argument, or the build environment) points every call at a fake publik on this
 * computer (127.0.0.1, localhost, or 10.0.2.2 from the Android emulator), and
 * PUBLIK_SELF_TEST prints the self-test line. PUBLIK_TEST_SIGN_IN presses "Sign in with
 * publik" once by itself and prints "publik sign-in test: passed" when the gate lets the
 * person in (the CI test that proves the sheet closes by itself). A release build has none.
 * Nothing else changes the gate.
 *
 * The stateful half of publik API for Lunara AI is here too: provisionPublik
 * (the same mint, offered to adults on a native build), fetchPublikWallet (the
 * balance line) and disconnectPublik (POST /installs/revoke).
 */
import { App as NativeApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { getSetting, removeSetting, setSetting, SK } from '../db/schema'
import { getLunaraNativeBridge } from '../native/bridge'
import { isNative, nativePlatform } from '../native/runtime'
import {
  deleteSecureSecret,
  getSecureSecret,
  SECURE_SECRET_KEYS,
  secureVaultStatus,
  setSecureSecret,
} from '../native/secureVault'
import { APP_NAME } from './appName'
import { testHooksOn } from './buildFlags'
import { forgetChatAgreement } from './healthConsent'
import { providerFetch } from './providerFetch'
import { loadStorefront, NO_LINK_PLAN_TEXT, purchaseLinksAllowed } from './storefront'
import {
  aiProvidersFrom,
  DEFAULT_PUBLIK_ENDPOINT,
  isAdultBirthYear,
  prepaidLeft,
  PublikApiError,
  publikBaseUrl,
  publikErrorFrom,
  publikModelsFrom,
  publikUnreachable,
  publikUrl,
  withoutMoney,
  type PublikClaimState,
  type PublikEndpoint,
  type PublikPlanKind,
  type PublikUsage,
} from './publikApi'
import { PUBLIK_BUILD, publikBuildAvailable } from './publikBuild'

export * from './publikApi'
export { PUBLIK_BUILD, publikBuildAvailable } from './publikBuild'

type FetchLike = typeof fetch

export const APP_SLUG = "lunara"
/** Mirrors app/package.json `version` and PUBLIK_BUILD.appVersion; publikBuild.test.ts pins all three equal. */
export const APP_VERSION = "0.2.7"
/** Lunara AI (adults only) calls a model, so the gate asks how to pay for it. */
export const USES_AI = true
const PUBLIK_ORIGIN = 'https://publikhq.com'
const POLL_MS = 3_000, POLL_LIMIT_MS = 10 * 60_000
/** One wallet check of the sign-in or plan wait: its own limit, shorter than the gate's first read. */
const POLL_CHECK_TIMEOUT_MS = 8_000
/** A storage read that fails (an iOS web view that was paused aborts IndexedDB work): tries before a screen shows. */
const STORAGE_TRIES = 3
const STORAGE_RETRY_MS = 400
const INSTALL_TIMEOUT_MS = 20_000
const WALLET_TIMEOUT_MS = 15_000
/** A phone that signed in before waits this long for publik, then opens offline. */
const OFFLINE_WAIT_MS = 5_000
const TELEMETRY_TIMEOUT_MS = 5_000
/** Sign-out tells publik with this limit; the phone has already forgotten the key. */
const REVOKE_TIMEOUT_MS = 10_000
/** 30 minutes. */
const TELEMETRY_EVERY_MS = 1_800 * 1000

// ---------- types ----------

export type Choice = 'publik' | 'own_key'
export interface PublikCredential { key: string; base_url: string; install_id: string; claim_url: string | null; choice: Choice | null }
export interface Wallet {
  claim_state: 'anonymous' | 'claimed'; claim_url: string | null; account: { handle: string | null } | null
  plan: { kind: 'none' | 'plan' | 'pack'; label: string | null }; balance_micros: number; top_up_url: string; linked_at: string | null
}
/** 'not_now' exists only on signInOnDemand() screens (PUBLIK_GATE_MODE=optional). */
export type GateAction = 'sign_in' | 'retry' | 'get_plan' | 'check_plan' | 'connect' | 'own_key' | 'not_now'
export interface GateScreen { id: 'sign_in' | 'unreachable' | 'choose'; title: string; body: string; note: string | null; buttons: { action: GateAction; label: string }[] }
/** What the in-app sheet waits for: the sign-in ("claimed") or a plan or pack ("plan"). */
export type SheetWaitFor = 'claimed' | 'plan'
/** The wallet check that runs while the sheet is open (iOS: in the native shell). The key is never logged. */
export interface SheetWatch { walletUrl: string; key: string; until: SheetWaitFor }
/**
 * show(): draw the screen and resolve with the button pressed. When `signal` aborts, stop waiting for a press (the promise may stay pending).
 * openUrl(): open publik's page in the in-app sheet; with `watch`, the sheet closes by itself when publik says the work is done (openPublikSheet).
 */
export interface GateUI { show(screen: GateScreen, signal: AbortSignal): Promise<GateAction>; openUrl(url: string, watch?: SheetWatch): unknown }
export interface GateResult {
  key: string
  wallet: Wallet
  /** null when the plan screen was not shown (no stored answer, a known minor, or a browser build). */
  choice: Choice | null
  /** True when the person answered the plan screen during this start. */
  chosenNow: boolean
  /** True when publik did not answer and the phone opened on its earlier sign-in. */
  offline: boolean
}
export type Provider = { kind: 'own' | 'publik'; baseURL: string; apiKey: string } | { kind: 'needs_own_key' }

export interface PublikInstall {
  key: string | null
  installId: string
  claimUrl: string | null
  claimState: PublikClaimState
  /**
   * The starter grant from this mint: 0 for a new unlinked install and on a
   * replay; the one-time starter grant (PUBLIK_LINK_STARTER_MICROS) when the mint is already bound to it.
   */
  starterMicros: number
  /** The live balance the gateway reported with the mint. */
  balanceMicros: number | null
  endpoint: PublikEndpoint
  /** The gateway's own cost sentence (CONTRACT §12.1b), when it sent one. */
  costSentence: string | null
}

// ---------- launch options and the test hook ----------

interface LaunchOptions {
  /** The origin of the publik to use (PUBLIK_API_BASE_URL without /api/v1), or null for publikhq.com. */
  baseUrl: string | null
  selfTest: boolean
  /** Test builds only: press "Sign in with publik" once by itself (the CI sheet test). */
  testSignIn: boolean
  usageOff: boolean
  debug: boolean
}
interface PublikNativeLaunch {
  publikLaunchOptions(): Promise<Record<string, string | undefined>>
  publikSelfTestDone(options: { line: string }): Promise<void>
  /** Test builds only: print one line for the CI log; the app goes on. */
  publikTestLine(options: { line: string }): Promise<void>
  /** iOS: the in-app sheet, owned by the native shell, with its own wallet check (see the top of this file). */
  publikSheetOpen(options: { url: string } & Partial<SheetWatch>): Promise<void>
  publikSheetClose(): Promise<void>
  publikWatchStop(): Promise<void>
  addListener(event: 'publikSheet', callback: (event: { state: 'done' | 'closed' | 'timeout' }) => void): Promise<{ remove(): Promise<void> }>
}
const nativeLaunch = getLunaraNativeBridge<PublikNativeLaunch>()

/** The fake publik of a test runs on this computer: these hosts only (10.0.2.2 is the computer, seen from the Android emulator). */
const TEST_HOSTS = new Set(['127.0.0.1', 'localhost', '10.0.2.2', '[::1]'])

/** PUBLIK_API_BASE_URL as an origin: http(s) on a TEST_HOSTS host only, with a trailing /api/v1 removed. */
function testOrigin(raw: string | null): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!TEST_HOSTS.has(url.hostname)) return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '')}`
  } catch {
    return null
  }
}

function launchFrom(values: Record<string, string | undefined>): LaunchOptions {
  const get = (name: string) => {
    const value = values[name]
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }
  const dnt = (get('DO_NOT_TRACK') ?? '').toLowerCase()
  const usage = (get('PUBLIK_TELEMETRY') ?? '').toLowerCase()
  // The two test hooks work only in a test build or `pnpm dev` (lib/buildFlags.ts).
  const hooks = testHooksOn()
  return {
    // A native launch argument wins; else the build environment (vite.config.ts exposes PUBLIK_API_BASE_URL).
    baseUrl: hooks ? testOrigin(get('PUBLIK_API_BASE_URL') ?? (import.meta.env.PUBLIK_API_BASE_URL as string | undefined)?.trim() ?? null) : null,
    selfTest: hooks && get('PUBLIK_SELF_TEST') !== null,
    testSignIn: hooks && get('PUBLIK_TEST_SIGN_IN') !== null,
    usageOff: (dnt !== '' && dnt !== '0' && dnt !== 'false') || ['0', 'false', 'off'].includes(usage),
    debug: get('PUBLIK_TELEMETRY_DEBUG') === '1',
  }
}

let launch: LaunchOptions = launchFrom({})
let launchLoaded: Promise<LaunchOptions> | null = null

/**
 * The launch options, read once from the native shell: the process environment
 * or a launch argument on iOS (`SIMCTL_CHILD_PUBLIK_SELF_TEST=1 xcrun simctl launch …`,
 * `-PUBLIK_API_BASE_URL <url>`), an intent extra on Android
 * (`adb shell am start -a android.intent.action.MAIN … --es PUBLIK_API_BASE_URL <url>`).
 * The native side gives PUBLIK_API_BASE_URL and PUBLIK_SELF_TEST only in a build
 * made with PUBLIK_TEST_HOOKS (Android: BuildConfig, never a release build and
 * never from a link; iOS: a Debug build with the PUBLIK_TEST_HOOKS Swift flag).
 */
export function loadLaunchOptions(): Promise<LaunchOptions> {
  return (launchLoaded ??= (async () => {
    let values: Record<string, string | undefined> = {}
    if (isNative) {
      try {
        values = (await nativeLaunch.publikLaunchOptions()) ?? {}
      } catch {
        values = {}
      }
    }
    return (launch = launchFrom(values))
  })())
}

function origin(): string {
  return launch.baseUrl ?? PUBLIK_ORIGIN
}

/** A link publik sent: https://publikhq.com/… only, or a link on the test origin while the hook is on. */
function trustedUrl(value: unknown): string | null {
  const url = publikUrl(value)
  if (url || !launch.baseUrl || typeof value !== 'string') return url
  try {
    return new URL(value).origin === new URL(launch.baseUrl).origin ? value : null
  } catch {
    return null
  }
}

// ---------- small helpers ----------

/** Rejects with an "unreachable" error when the request takes longer than `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(publikUnreachable()), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function newInstallId(): string {
  // Capacitor serves a secure context (capacitor://localhost, https://localhost);
  // the fallback covers an old Android WebView without randomUUID.
  const c: Crypto = globalThis.crypto
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x: number) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function osVersionFromUserAgent(ua: string): string | null {
  const ios = /OS (\d+[_.]\d+(?:[_.]\d+)?)/.exec(ua)
  if (nativePlatform === 'ios' && ios) return ios[1].replace(/_/g, '.')
  const android = /Android (\d+(?:\.\d+)*)/.exec(ua)
  if (nativePlatform === 'android' && android) return android[1]
  return null
}

function userAgent(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent
}

/** The phone type in an event: ios or android; a browser build names the system it runs on. */
function deviceOs(): string {
  if (isNative) return nativePlatform
  const ua = userAgent()
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos'
  if (/Windows/i.test(ua)) return 'windows'
  return 'linux'
}

// ---------- the credential ----------

const WEB_KEY_ITEM = `publik:${APP_SLUG}:key`

/** The iOS vault answers KEYCHAIN_LOCKED while the phone is still locked: the key is there, so never delete it. */
function vaultLocked(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'KEYCHAIN_LOCKED'
}

/**
 * The pk_ key: the native vault on a phone; localStorage in a browser build (the web vault forgets on reload).
 * A vault item that cannot be read ("Secret could not be decrypted": Android after a restore or a device
 * transfer, where the Keystore key did not come along) is deleted and counts as no key, so the gate sets up
 * a new install and the person signs in again. It never locks the person out.
 */
async function readKey(): Promise<string | null> {
  if (!isNative) {
    try {
      const saved = globalThis.localStorage?.getItem(WEB_KEY_ITEM)
      if (saved) return saved
    } catch {
      // storage blocked: fall back to this tab's memory
    }
  }
  try {
    return await getSecureSecret(SECURE_SECRET_KEYS.publikApiKey)
  } catch (error) {
    if (vaultLocked(error)) throw error
    await deleteSecureSecret(SECURE_SECRET_KEYS.publikApiKey).catch(() => undefined)
    return null
  }
}

async function writeKey(key: string): Promise<void> {
  if (!isNative) {
    try {
      globalThis.localStorage?.setItem(WEB_KEY_ITEM, key)
    } catch {
      // storage blocked: this tab's memory only
    }
  }
  await setSecureSecret(SECURE_SECRET_KEYS.publikApiKey, key)
}

async function deleteKey(): Promise<void> {
  if (!isNative) {
    try {
      globalThis.localStorage?.removeItem(WEB_KEY_ITEM)
    } catch {
      // nothing stored
    }
  }
  await deleteSecureSecret(SECURE_SECRET_KEYS.publikApiKey)
}

/** This phone's publik credential, or null when it has no key yet. Never logs the key. */
export async function readCredential(): Promise<PublikCredential | null> {
  const key = await readKey()
  if (!key || !key.startsWith('pk_')) return null
  const [installId, claimUrl, choice, endpoint] = await Promise.all([
    getSetting(SK.publikInstallId),
    getSetting(SK.publikClaimUrl),
    getSetting(SK.publikChoice),
    publikEndpoint(),
  ])
  return {
    key,
    base_url: endpoint.baseUrl,
    install_id: installId ?? '',
    claim_url: claimUrl ?? null,
    choice: choice === 'publik' || choice === 'own_key' ? choice : null,
  }
}

/** The person's answer to the plan screen. Settings call it; null asks again at the next start. */
export async function setChoice(choice: Choice | null): Promise<void> {
  if (choice) await setSetting(SK.publikChoice, choice)
  else await removeSetting(SK.publikChoice)
}

/** A revoked key (401): stop counting and forget the install, so the next pass provisions a new one. */
async function forgetInstall(): Promise<void> {
  stopTelemetry()
  await deleteKey()
  await Promise.all([SK.publikInstallId, SK.publikClaimUrl, SK.publikClaimState, SK.publikChoice].map((key) => removeSetting(key)))
}

/**
 * Lunara keeps its AI provider in SK.aiProvider. "Use my publik plan" on the
 * plan screen selects publik API. "Use my own AI key" changes nothing here:
 * Lunara AI opens on the key entry (components/PublikGate.tsx), and the
 * provider changes only when the person saves a key (blind test round 2, M2).
 * Own keys in the vault are never touched.
 */
export async function applyChoiceToAi(choice: Choice): Promise<void> {
  if (choice !== 'publik') return
  const current = await getSetting(SK.aiProvider)
  await Promise.all([
    setSetting(SK.aiProvider, 'publik'),
    current === 'publik' ? Promise.resolve() : removeSetting(SK.aiModel),
    setSetting(SK.aiBaseUrl, ''),
  ])
}

/**
 * The key Lunara AI uses: the stored choice decides. The install key after
 * "Connect your plan" (on a build that offers publik API), else the person's
 * own key exactly as before.
 */
export async function resolveProvider(userKey?: { baseURL: string; apiKey: string } | null): Promise<Provider> {
  const c = await readCredential()
  if (c?.choice === 'publik' && (await publikAvailable())) return { kind: 'publik', baseURL: c.base_url, apiKey: c.key }
  return userKey?.apiKey ? { kind: 'own', ...userKey } : { kind: 'needs_own_key' }
}

/**
 * The AI choice that Lunara AI uses now: one rule for the AI screen and the
 * Settings row (blind test round 2, L1: the row said "add Anthropic key" while
 * publik API was in use). A saved provider wins; with none saved, the plan-screen
 * answer decides, and a build that offers publik API preselects it.
 */
export async function activeAiProvider(): Promise<'publik' | 'anthropic' | 'openai'> {
  const [saved, available] = await Promise.all([getSetting(SK.aiProvider), publikAvailable()])
  if (saved === 'openai' || saved === 'anthropic') return saved
  if (saved === 'publik') return available ? 'publik' : 'anthropic'
  if ((await resolveProvider(null)).kind === 'publik') return 'publik'
  return available && (await getSetting(SK.publikChoice)) !== 'own_key' ? 'publik' : 'anthropic'
}

// ---------- POST /api/v1/installs ----------

/**
 * Whether Lunara AI can run on publik API here: a minted app token, a native
 * shell whose vault persists, and an adult profile (AI is hidden under 18
 * everywhere). The sign-in gate itself runs on every build.
 */
export async function publikAvailable(options: { assumeAdult?: boolean } = {}): Promise<boolean> {
  if (!publikBuildAvailable() || !isNative) return false
  if (nativePlatform !== 'ios' && nativePlatform !== 'android') return false
  const [status, birthYear] = await Promise.all([secureVaultStatus(), getSetting(SK.birthYear)])
  if (!status.available || status.persistence === 'memory') return false
  // Onboarding checks the typed year itself before SK.birthYear is saved.
  return options.assumeAdult === true || isAdultBirthYear(birthYear)
}

/** True when this phone holds a pk_ key. Never reveals the key to the caller. */
export async function hasPublikKey(): Promise<boolean> {
  return Boolean(await readKey())
}

/** What POST /installs told this phone, or the compiled defaults. The test hook wins over both. */
export async function publikEndpoint(): Promise<PublikEndpoint> {
  const [baseUrl, models] = await Promise.all([getSetting(SK.publikBaseUrl), getSetting(SK.publikModels)])
  let parsedModels: unknown = null
  if (models) {
    try {
      parsedModels = JSON.parse(models)
    } catch {
      parsedModels = null
    }
  }
  return {
    baseUrl: launch.baseUrl ? `${launch.baseUrl}/api/v1` : publikBaseUrl(baseUrl) ?? DEFAULT_PUBLIK_ENDPOINT.baseUrl,
    models: publikModelsFrom(parsedModels),
  }
}

export interface PublikLocalState {
  installId: string | null
  claimUrl: string | null
  claimState: PublikClaimState | null
  starterMicros: number | null
  costSentence: string | null
  cardSeen: boolean
}

export async function publikLocalState(): Promise<PublikLocalState> {
  const [installId, claimUrl, claimState, starter, cost, cardSeen] = await Promise.all([
    getSetting(SK.publikInstallId),
    getSetting(SK.publikClaimUrl),
    getSetting(SK.publikClaimState),
    getSetting(SK.publikStarterMicros),
    getSetting(SK.publikCostSentence),
    getSetting(SK.publikCardSeen),
  ])
  const starterMicros = starter === undefined ? null : Number(starter)
  return {
    installId: installId ?? null,
    claimUrl: trustedUrl(claimUrl),
    claimState: claimState === 'claimed' || claimState === 'anonymous' ? claimState : null,
    starterMicros: starterMicros !== null && Number.isFinite(starterMicros) ? starterMicros : null,
    costSentence: cost ?? null,
    cardSeen: cardSeen === '1',
  }
}

/** The first-run card (CONTRACT §12.1) has been shown with a real balance on it. */
export async function markPublikCardSeen(): Promise<void> {
  await setSetting(SK.publikCardSeen, '1')
}

interface InstallResponse {
  install_id: string
  key: string | null
  base_url?: string
  models?: unknown
  claim_url?: string | null
  claim_state?: string
  starter_micros?: number
  balance_micros?: number
  starting_credit_micros?: number
  disclosure?: { cost?: string }
}

async function rememberInstall(data: InstallResponse, starterMicros: number): Promise<void> {
  const baseUrl = publikBaseUrl(data.base_url)
  const claimUrl = trustedUrl(data.claim_url)
  const claimState: PublikClaimState = data.claim_state === 'claimed' ? 'claimed' : 'anonymous'
  const cost = typeof data.disclosure?.cost === 'string' && data.disclosure.cost.trim() ? data.disclosure.cost.trim() : null
  await Promise.all([
    setSetting(SK.publikInstallId, data.install_id),
    claimUrl ? setSetting(SK.publikClaimUrl, claimUrl) : removeSetting(SK.publikClaimUrl),
    setSetting(SK.publikClaimState, claimState),
    baseUrl ? setSetting(SK.publikBaseUrl, baseUrl) : removeSetting(SK.publikBaseUrl),
    setSetting(SK.publikModels, JSON.stringify(publikModelsFrom(data.models))),
    starterMicros > 0 ? setSetting(SK.publikStarterMicros, String(starterMicros)) : Promise.resolve(),
    cost ? setSetting(SK.publikCostSentence, cost) : Promise.resolve(),
  ])
}

/**
 * POST /api/v1/installs: this phone's publik key. Idempotent on install_id: a
 * replay answers 200 with key:null and mints nothing, so a crash between mint
 * and vault write is recovered by minting once more with a fresh install_id.
 * 403 (install revoked) on a known install starts over once with a fresh one.
 * The key reaches the vault before any setting. Throws a PublikApiError: kind
 * "unreachable" when publik does not answer, else the server's message.
 */
export async function provision(options: { fetchImpl?: FetchLike; fresh?: boolean } = {}): Promise<PublikInstall> {
  const fetchImpl = options.fetchImpl ?? providerFetch
  const token = PUBLIK_BUILD.appToken
  if (!token.startsWith('pat_')) throw new PublikApiError('rejected', 'This build has no publik app token. Ask the developer for a new build.')
  if (options.fresh) {
    await deleteKey()
    await removeSetting(SK.publikInstallId)
  }
  const existingId = await getSetting(SK.publikInstallId)
  const installId = existingId || newInstallId()
  const body = {
    app_token: token,
    app_slug: APP_SLUG,
    app_version: APP_VERSION,
    os: isNative ? nativePlatform : 'web', // 'ios' | 'android' (CONTRACT §11.1)
    os_version: osVersionFromUserAgent(userAgent()),
    arch: null,
    device_name: nativePlatform === 'ios' ? 'iPhone' : nativePlatform === 'android' ? 'Android phone' : 'Web browser',
    install_id: installId,
    disclosure_version: PUBLIK_BUILD.disclosureVersion,
    dialects: PUBLIK_BUILD.dialects,
  }

  let response: Response
  try {
    response = await withTimeout(
      fetchImpl(`${origin()}/api/v1/installs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      INSTALL_TIMEOUT_MS,
    )
  } catch {
    throw publikUnreachable()
  }
  if (!response.ok) {
    const serverMessage = await response
      .clone()
      .json()
      .then((b: { error?: { message?: unknown } }) => (typeof b?.error?.message === 'string' ? b.error.message.trim() : ''), () => '')
    const error = await publikErrorFrom(response)
    // 403 install_revoked: this install_id is finished; start over once with a fresh one.
    if (response.status === 403 && existingId && !options.fresh) return provision({ fetchImpl, fresh: true })
    // A wrong app token or body: say what publik said ("This app token is not valid.").
    if (response.status === 400 || response.status === 401 || response.status === 404) {
      throw new PublikApiError('rejected', withoutMoney(serverMessage) ?? `publik could not set up this phone (${response.status}).`)
    }
    throw error
  }

  const data = (await response.json()) as InstallResponse

  if (data.key === null || data.key === undefined) {
    // Replay for an install_id whose key we no longer hold: mint once more.
    if (!(await readKey())) {
      if (existingId) {
        await removeSetting(SK.publikInstallId)
        return provision({ fetchImpl })
      }
      throw new PublikApiError('rejected', 'publik could not set up this phone. Try again.')
    }
  } else {
    // Vault first, then settings: the key is the only thing that cannot be re-derived.
    await writeKey(data.key)
  }

  const starterMicros = data.starter_micros ?? data.starting_credit_micros ?? 0
  await rememberInstall(data, starterMicros)

  return {
    key: data.key ?? null,
    installId: data.install_id,
    claimUrl: trustedUrl(data.claim_url),
    claimState: data.claim_state === 'claimed' ? 'claimed' : 'anonymous',
    starterMicros,
    balanceMicros: typeof data.balance_micros === 'number' ? data.balance_micros : starterMicros,
    endpoint: {
      baseUrl: launch.baseUrl ? `${launch.baseUrl}/api/v1` : publikBaseUrl(data.base_url) ?? DEFAULT_PUBLIK_ENDPOINT.baseUrl,
      models: publikModelsFrom(data.models),
    },
    costSentence: typeof data.disclosure?.cost === 'string' ? data.disclosure.cost : null,
  }
}

/**
 * "Continue with publik API" in Lunara AI: the same mint, offered only where
 * publikAvailable() (an adult on a native build). After the gate the phone
 * already holds its key, so this is a replay that refreshes the balance card.
 */
export async function provisionPublik(options: { fetchImpl?: FetchLike; fresh?: boolean } = {}): Promise<PublikInstall> {
  if (!(await publikAvailable())) throw new PublikApiError('unreachable', 'publik API is not available in this build.')
  return provision(options)
}

async function provisionCredential(): Promise<PublikCredential> {
  await provision()
  const c = await readCredential()
  if (!c) throw new PublikApiError('rejected', 'publik could not set up this phone. Try again.')
  return c
}

// ---------- GET /api/v1/wallet ----------

async function walletRequest(url: string, key: string, fetchImpl: FetchLike, timeoutMs: number): Promise<{ status: number; body: Record<string, any> }> {
  let response: Response
  try {
    response = await withTimeout(fetchImpl(url, { headers: { authorization: `Bearer ${key}` } }), timeoutMs)
  } catch {
    throw publikUnreachable()
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, any>
  return { status: response.status, body: body && typeof body === 'object' ? body : {} }
}

/** GET /api/v1/wallet for the gate. 401: the key is gone (null wallet). Throws ("unreachable") when publik does not answer. */
export async function readWallet(key: string, timeoutMs = WALLET_TIMEOUT_MS): Promise<{ status: number; wallet: Wallet | null; message: string | null }> {
  const { status, body: b } = await walletRequest(`${origin()}/api/v1/wallet`, key, providerFetch, timeoutMs)
  if (status < 200 || status >= 300 || typeof b.claim_state !== 'string') {
    return { status, wallet: null, message: typeof b.error?.message === 'string' ? b.error.message : null }
  }
  const plan = b.plan && typeof b.plan === 'object' ? b.plan : null
  const wallet: Wallet = {
    claim_state: b.claim_state === 'claimed' ? 'claimed' : 'anonymous',
    claim_url: trustedUrl(b.claim_url),
    account: b.account && typeof b.account === 'object' ? { handle: typeof b.account.handle === 'string' ? b.account.handle : null } : null,
    plan: { kind: plan?.kind === 'plan' || plan?.kind === 'pack' ? plan.kind : 'none', label: typeof plan?.label === 'string' ? plan.label : null },
    balance_micros: typeof b.balance_micros === 'number' ? b.balance_micros : 0,
    top_up_url: trustedUrl(b.top_up_url) ?? `${origin()}/wallet`,
    linked_at: typeof b.linked_at === 'string' ? b.linked_at : null,
  }
  // Remembered for the offline start and for Lunara AI's plan line. A failed write (iOS can abort IndexedDB
  // work while the web view is paused) never hides publik's answer: the next read writes it again.
  await Promise.all([
    setSetting(SK.publikClaimState, wallet.claim_state),
    wallet.claim_url ? setSetting(SK.publikClaimUrl, wallet.claim_url) : wallet.claim_state === 'claimed' ? removeSetting(SK.publikClaimUrl) : Promise.resolve(),
    typeof b.install_id === 'string' && b.install_id ? setSetting(SK.publikInstallId, b.install_id) : Promise.resolve(),
  ]).catch(() => undefined)
  return { status, wallet, message: null }
}

export interface PublikWallet extends PublikUsage {
  /** GET /wallet `ai_providers`: the companies publik sends AI requests to; null when publik sent none. */
  aiProviders: string[] | null
  claimUrl: string | null
  /** The one link an app renders (CONTRACT §1): claim page while anonymous, add-credit page once claimed. */
  topUpUrl: string | null
}

async function readPrepaidMemory(): Promise<{ level: number; last: number } | null> {
  try {
    const raw = await getSetting(SK.publikPrepaidLevel)
    const value = raw ? (JSON.parse(raw) as { level?: unknown; last?: unknown }) : null
    return value && typeof value.level === 'number' && typeof value.last === 'number' ? { level: value.level, last: value.last } : null
  } catch {
    return null
  }
}

/** The last `ai_providers` list GET /wallet sent, kept on this phone; null when it never sent one. */
export async function cachedAiProviders(): Promise<string[] | null> {
  try {
    const raw = await getSetting(SK.publikAiProviders)
    return raw ? aiProvidersFrom(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

const percentOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null)

/** GET /api/v1/wallet for Lunara AI's plan-use line, on the base_url POST /installs announced. */
export async function fetchPublikWallet(fetchImpl: FetchLike = providerFetch): Promise<PublikWallet> {
  const key = await readKey()
  if (!key) throw new PublikApiError('disconnected', 'publik API is not connected on this phone.')
  const endpoint = await publikEndpoint()
  let result: { status: number; body: Record<string, any> }
  try {
    result = await walletRequest(`${endpoint.baseUrl}/wallet`, key, fetchImpl, WALLET_TIMEOUT_MS)
  } catch {
    throw new PublikApiError('unreachable', 'publik API is unreachable right now. Nothing is used from your plan.')
  }
  if (result.status < 200 || result.status >= 300) {
    throw await publikErrorFrom(new Response(JSON.stringify(result.body), { status: result.status }))
  }
  const data = result.body as {
    install_id?: string | null
    claim_state?: string
    claim_url?: string | null
    top_up_url?: string | null
    base_url?: string
    balance_micros?: number
    available_micros?: number
    week?: { used_micros?: number; budget_micros?: number | null; resets_at?: string }
    starter?: { remaining_micros?: number } | null
    used_percent?: number | null
    remaining_percent?: number | null
    resets_at?: string | null
    ai_providers?: unknown
    plan?: { kind?: unknown } | null
    prepaid_remaining_percent?: number | null
  }
  const claimState: PublikClaimState | null =
    data.claim_state === 'claimed' || data.claim_state === 'anonymous' ? data.claim_state : null
  const claimUrl = trustedUrl(data.claim_url)
  const baseUrl = publikBaseUrl(data.base_url)
  // A reinstall keeps the iOS keychain but loses Dexie: restore the id and links from the wallet.
  await Promise.all([
    data.install_id ? setSetting(SK.publikInstallId, data.install_id) : Promise.resolve(),
    claimState ? setSetting(SK.publikClaimState, claimState) : Promise.resolve(),
    claimUrl ? setSetting(SK.publikClaimUrl, claimUrl) : claimState === 'claimed' ? removeSetting(SK.publikClaimUrl) : Promise.resolve(),
    baseUrl ? setSetting(SK.publikBaseUrl, baseUrl) : Promise.resolve(),
  ]).catch(() => undefined) // a failed write never hides publik's answer; the next read writes it again
  const balance = data.balance_micros ?? data.available_micros ?? null
  const kind = data.plan?.kind
  const planKind: PublikPlanKind | null = kind === 'plan' || kind === 'pack' || kind === 'none' ? kind : null
  const starter = data.starter?.remaining_micros ?? 0
  // Prepaid use (packs and grant money) as a percent. GET /wallet sends `prepaid_remaining_percent`
  // (0-100, or null when there is no prepaid use): that number is the answer, also null.
  // Only an older publik without the field falls back to the level this phone keeps (prepaidLeft).
  // Never an amount of money on a screen.
  const serverSendsPrepaid = Object.prototype.hasOwnProperty.call(data, 'prepaid_remaining_percent')
  let prepaidLeftPercent = percentOrNull(data.prepaid_remaining_percent)
  if (serverSendsPrepaid) {
    await removeSetting(SK.publikPrepaidLevel).catch(() => undefined)
  } else if (claimState === 'claimed' && typeof balance === 'number') {
    const previous = await readPrepaidMemory()
    const prepaid = prepaidLeft(Math.max(0, balance - starter), previous)
    prepaidLeftPercent = prepaid.percent
    if (prepaid.memory && JSON.stringify(prepaid.memory) !== JSON.stringify(previous)) {
      await setSetting(SK.publikPrepaidLevel, JSON.stringify(prepaid.memory)).catch(() => undefined)
    }
  }
  const aiProviders = aiProvidersFrom(data.ai_providers)
  if (aiProviders) await setSetting(SK.publikAiProviders, JSON.stringify(aiProviders)).catch(() => undefined)
  return {
    balanceMicros: balance,
    weekUsedMicros: data.week?.used_micros ?? null,
    weekBudgetMicros: data.week?.budget_micros ?? null,
    weekResetsAt: data.week?.resets_at ?? null,
    starterRemainingMicros: data.starter?.remaining_micros ?? null,
    claimState,
    chargeMicros: null,
    // The plan use as a percent (the app shows no amount of money): publik's own numbers when it sends them.
    usedPercent: percentOrNull(data.used_percent),
    remainingPercent: percentOrNull(data.remaining_percent),
    resetsAt: typeof data.resets_at === 'string' && data.resets_at ? data.resets_at : null,
    planKind,
    prepaidLeftPercent,
    aiProviders,
    claimUrl,
    topUpUrl: trustedUrl(data.top_up_url) ?? claimUrl,
  }
}

// ---------- signing out ----------

const signOutListeners = new Set<() => void>()

/** PublikGate listens: in required mode a sign-out shows the wall again at once. Returns the unsubscribe. */
export function onPublikSignOut(listener: () => void): () => void {
  signOutListeners.add(listener)
  return () => {
    signOutListeners.delete(listener)
  }
}

/** Every publik value Lunara keeps in its settings (the telemetry ID and "Count my use" are separate). */
function publikSettingKeys(): string[] {
  return [
    SK.publikInstallId,
    SK.publikClaimUrl,
    SK.publikClaimState,
    SK.publikBaseUrl,
    SK.publikModels,
    SK.publikStarterMicros,
    SK.publikCostSentence,
    SK.publikCardSeen,
    SK.publikChoice,
    SK.publikPrepaidLevel,
    SK.publikAiProviders,
  ]
}

interface SignOutOptions {
  /** false: do not show the gate now, because the caller restarts the app itself (Delete all data). Default true. */
  returnToGate?: boolean
}

/**
 * Sign-out, in this order, so that a crash or a slow network never leaves a signed-in phone:
 *   1. read the key into memory;
 *   2. stop usage counting; delete the vault item, every publik setting and the AI chat
 *      agreement with publik (and, for Delete account, the telemetry ID);
 *   3. POST /installs/revoke with the key from memory, best effort (offline: publik's idle
 *      sweep revokes it later);
 *   4. tell PublikGate: in required mode the wall comes back at once.
 * Throws after step 4 when step 2 could not delete something.
 */
async function signOutHere(fetchImpl: FetchLike, options: SignOutOptions & { forgetTelemetryId: boolean }): Promise<void> {
  const key = await readKey().catch(() => null)
  const endpoint = await publikEndpoint().catch(() => DEFAULT_PUBLIK_ENDPOINT)
  stopTelemetry()
  const local = await Promise.allSettled([
    deleteKey(),
    ...publikSettingKeys().map((name) => removeSetting(name)),
    forgetChatAgreement('publik'),
    options.forgetTelemetryId ? removeSetting(SK.publikTelemetryId) : Promise.resolve(),
  ])
  if (key) {
    try {
      await withTimeout(fetchImpl(`${endpoint.baseUrl}/installs/revoke`, { method: 'POST', headers: { authorization: `Bearer ${key}` } }), REVOKE_TIMEOUT_MS)
    } catch {
      // offline: the idle sweep revokes it server-side
    }
  }
  if (options.returnToGate !== false) {
    for (const listener of [...signOutListeners]) {
      try {
        listener()
      } catch {
        // a listener never stops the sign-out
      }
    }
  }
  const failed = local.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failed) throw failed.reason
}

/**
 * "Sign out" and "Disconnect publik API": the phone forgets publik, then tells publik
 * (signOutHere). The next screen is Sign in with publik (required mode: at once).
 */
export function disconnectPublik(fetchImpl: FetchLike = providerFetch, options: SignOutOptions = {}): Promise<void> {
  return signOutHere(fetchImpl, { ...options, forgetTelemetryId: false })
}

// ---------- the gate ----------

/** The words of the gate. The same in every publik module. */
export function gateScreen(id: GateScreen['id'], w: Wallet | null, note: string | null = null, message?: string): GateScreen {
  // A server message never shows an amount of money (lib/publikApi.ts withoutMoney).
  if (id === 'unreachable') return { id, title: 'Sign in with publik', body: withoutMoney(message) ?? 'publik is not reachable. Check your connection.', note, buttons: [{ action: 'retry', label: 'Retry' }] }
  if (id === 'sign_in') return { id, title: 'Sign in with publik', note, buttons: [{ action: 'sign_in', label: 'Sign in with publik' }],
    body: 'Lunara uses your publik account. Tap Sign in with publik, then sign in on the publik page. Lunara continues when you are signed in.' }
  // No handle and no balance: the plan screen can show before the PIN lock.
  if (!w || (w.plan.kind === 'none' && w.balance_micros === 0)) {
    // US App Store storefront: "Get a plan" opens publik. Any other or unknown storefront: no link, no button,
    // no price (lib/storefront.ts); "Check for my plan" reads the account again after a plan is bought elsewhere.
    // Each label says what the button does. "Not now" keeps the sign-in; Lunara AI asks again later.
    if (!purchaseLinksAllowed()) return { id, title: 'Choose how to pay for AI', note,
      body: `You are signed in to publik. Lunara AI needs a publik plan or your own AI key. ${NO_LINK_PLAN_TEXT} Then tap Check for my plan.`,
      buttons: [{ action: 'check_plan', label: 'Check for my plan' }, { action: 'own_key', label: 'Use my own AI key' }, { action: 'not_now', label: 'Not now' }] }
    return { id, title: 'Choose how to pay for AI', note,
      body: 'You are signed in to publik. Lunara AI needs a publik plan or your own AI key.',
      buttons: [{ action: 'get_plan', label: 'Get a plan' }, { action: 'own_key', label: 'Use my own AI key' }, { action: 'not_now', label: 'Not now' }] }
  }
  const what = w.plan.kind === 'plan' ? 'You have a publik plan.' : 'You have publik credit.'
  return { id, title: 'Connect your plan', note, body: `You are signed in to publik. ${what} Use it for Lunara AI, or use your own AI key.`,
    buttons: [{ action: 'connect', label: 'Use my publik plan' }, { action: 'own_key', label: 'Use my own AI key' }, { action: 'not_now', label: 'Not now' }] }
}

// The app is in the foreground: only then does the gate call publik. Coming back wakes the wait at once.
let foreground = true
let watching = false
const wakers = new Set<() => void>()

function wake(): void {
  for (const waker of [...wakers]) waker()
}

/** Waits `ms`, or less: until the app comes back to the foreground, the browser closes, or `signal` aborts. */
function nap(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      wakers.delete(done)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    wakers.add(done)
    signal.addEventListener('abort', done, { once: true })
  })
}

function setForeground(active: boolean): void {
  foreground = active
  if (!active) return
  wake()
  resumeTelemetry()
}

function watchForeground(): void {
  if (watching) return
  watching = true
  if (isNative) {
    NativeApp.addListener('appStateChange', ({ isActive }) => setForeground(isActive)).catch(() => undefined)
    // iOS: Done in SFSafariViewController. Android: the Custom Tab closed.
    Browser.addListener('browserFinished', () => wake()).catch(() => undefined)
    watchSheetEvents()
  } else if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => setForeground(document.visibilityState === 'visible'))
  }
}

/** iOS shows the sign-in page in the app (SFSafariViewController): close it once publik says the work is done. */
function closeBrowser(): void {
  if (!isNative || nativePlatform !== 'ios') return
  void Promise.resolve()
    .then(() => nativeLaunch.publikSheetClose())
    .catch(() => undefined)
  Browser.close().catch(() => undefined)
}

/** The wallet check for the in-app sheet: GET /wallet on this publik with this key. */
function sheetWatch(key: string, until: SheetWaitFor): SheetWatch {
  return { walletUrl: `${origin()}/api/v1/wallet`, key, until }
}

/**
 * Opens publik's page in the in-app sheet. iOS: the native shell shows it and, with `watch`,
 * checks GET /wallet itself every 3 s (8 s limit per check, 10 minutes at most) and closes the
 * sheet when publik says the work is done, because the web view's timers stop while the sheet
 * covers it. Android: a Custom Tab (the gate checks at once when the app comes back). A browser
 * build: a new tab.
 */
export function openPublikSheet(url: string, watch?: SheetWatch): void {
  if (isNative && nativePlatform === 'ios') {
    void Promise.resolve()
      .then(() => nativeLaunch.publikSheetOpen({ url, ...(watch ?? {}) }))
      .catch(() => Browser.open({ url }).catch(() => undefined))
    return
  }
  if (isNative) {
    void Browser.open({ url }).catch(() => undefined)
    return
  }
  globalThis.open?.(url, '_blank', 'noopener,noreferrer')
}

/** iOS: the native sheet tells the gate when it closed (by itself or by hand), so the gate checks at once. */
let sheetEvents: Promise<unknown> | null = null
function watchSheetEvents(): void {
  if (sheetEvents || !isNative || nativePlatform !== 'ios') return
  sheetEvents = Promise.resolve()
    .then(() => nativeLaunch.addListener('publikSheet', () => wake()))
    .catch(() => undefined)
}

/** True when the wallet shows what the wait is for. */
function walletDone(w: Wallet, until: SheetWaitFor): boolean {
  return until === 'claimed' ? w.claim_state === 'claimed' : w.plan.kind !== 'none' || w.balance_micros > 0
}

/**
 * Show a screen; with `until`, also check GET /wallet every 3 s on a fixed grid in the foreground (8 s limit per
 * check), for at most 10 minutes of waiting. "done": the check saw it; "timeout": it did not. Coming back to the
 * foreground, and the sheet closing (by itself or by hand), check at once.
 */
async function ask(ui: GateUI, screen: GateScreen, key?: string, until?: SheetWaitFor): Promise<GateAction | 'done' | 'timeout'> {
  const stop = new AbortController()
  const poll = async (): Promise<'done' | 'timeout'> => {
    const start = Date.now()
    const end = start + POLL_LIMIT_MS
    let tick = 0
    while (!stop.signal.aborted) {
      // The next point of the 3-second grid (a slow check skips the points it covered).
      tick = Math.max(tick + 1, Math.ceil((Date.now() - start) / POLL_MS))
      await nap(Math.max(0, start + tick * POLL_MS - Date.now()), stop.signal)
      if (stop.signal.aborted) break
      if (!foreground) continue // nothing is sent in the background; coming back wakes the nap
      const w = await readWallet(key!, POLL_CHECK_TIMEOUT_MS).then((r) => r.wallet, () => null)
      if (w && walletDone(w, until!)) return 'done'
      if (Date.now() >= end) return 'timeout' // only after one more check in the foreground
    }
    return 'timeout'
  }
  try {
    return await Promise.race([ui.show(screen, stop.signal), ...(until ? [poll()] : [])])
  } finally {
    stop.abort()
  }
}

/**
 * The plan screen is for a known adult only: a birth year of 18 or more. A
 * known minor never sees it (Lunara hides AI under 18), and neither does a
 * person whose age is not known yet (onboarding asks it first).
 */
async function knownAdult(): Promise<boolean> {
  const birthYear = await getSetting(SK.birthYear)
  return Boolean(birthYear) && isAdultBirthYear(birthYear)
}

/** True where the gate itself asks how to pay for AI: a phone build. Onboarding skips its own AI step there. */
export function gateAsksPlanHere(): boolean {
  return USES_AI && isNative
}

function offlineWallet(): Wallet {
  return { claim_state: 'claimed', claim_url: null, account: null, plan: { kind: 'none', label: null }, balance_micros: 0, top_up_url: `${origin()}/wallet`, linked_at: null }
}

/** PUBLIK_SELF_TEST: print the self-test line and end the app. Resolves never when it runs. */
async function selfTestIfAsked(): Promise<void> {
  await loadLaunchOptions()
  if (!launch.selfTest) return
  const line = await selfTest()
  console.log(line)
  if (isNative) await nativeLaunch.publikSelfTestDone({ line }).catch(() => undefined) // prints the line and ends the app
  return new Promise<void>(() => {})
}

/** The gate (see the top of the file). Resolves once the person is signed in; `choice` is null when the plan screen does not apply. */
export async function ensureSignedIn(ui: GateUI): Promise<GateResult> {
  return (await gateLoop(ui, false)) as GateResult
}

/**
 * PUBLIK_GATE_MODE=optional: the same gate, asked when the person opens Lunara
 * AI or the publik row in Settings. Every screen has "Not now", which resolves
 * null (nothing more is sent). On the plan screen "Not now" keeps the sign-in
 * and resolves with `choice: null`.
 */
export function signInOnDemand(ui: GateUI): Promise<GateResult | null> {
  return gateLoop(ui, true)
}

/** PUBLIK_GATE_MODE=optional, at app start: no screen. Usage counting starts only if this phone signed in before. */
export async function openWithoutWall(): Promise<void> {
  await selfTestIfAsked()
  watchForeground()
  if (await signedInHere()) startTelemetry()
}

/** True when this phone holds a key that publik last said is signed in. Makes no request. */
export async function signedInHere(): Promise<boolean> {
  const [state, key] = await Promise.all([getSetting(SK.publikClaimState), readKey()])
  return state === 'claimed' && Boolean(key?.startsWith('pk_'))
}

/** Optional mode: true when opening Lunara AI must first show the gate (not signed in, or a known adult with no plan answer). */
export async function needsSignInOnDemand(): Promise<boolean> {
  if (!(await signedInHere())) return true
  if (!gateAsksPlanHere() || !(await knownAdult())) return false
  return !(await readCredential())?.choice
}

// ---------- the pages the in-app sheet opens ----------
//
// On iOS and Android the in-app sheet (@capacitor/browser) opens only publik's bare
// "in-app" pages: no site navigation, no footer, no prices and no plan links.
//   sign-in:          claim_url + in_app=1 (publik redirects to /in-app/claim/<CODE>)
//   account deletion: /in-app/delete-account
//   privacy policy:   /in-app/privacy
//   help and support: /in-app/support?app=lunara (a reported AI answer adds topic and reason)
// The US-storefront "Get a plan" and top-up links (lib/storefront.ts) stay on the normal site.
// The test hook (PUBLIK_API_BASE_URL) moves all of them to its origin.

/** The note when publik gave no claim_url: the app opens no other page instead. */
export const NO_SIGN_IN_LINK = 'publik sent no sign-in link. Try again.'
/** The note while the sign-in page is open. */
export const SIGN_IN_WAITING = 'Waiting for you to sign in on the publik page.'

/** The sign-in page for the in-app sheet: claim_url with in_app=1. Every other query value stays as it is. */
export function inAppClaimUrl(claimUrl: string): string {
  try {
    const url = new URL(claimUrl)
    if (url.searchParams.has('in_app')) {
      url.searchParams.set('in_app', '1')
      return url.toString()
    }
    url.search = url.search ? `${url.search}&in_app=1` : '?in_app=1'
    return url.toString()
  } catch {
    return claimUrl
  }
}

/** publik's page where the person deletes the publik account (for every publik app; App Store 5.1.1(v)). */
export function accountDeletionUrl(): string {
  return `${origin()}/in-app/delete-account`
}

/** publik's privacy policy. */
export function publikPrivacyUrl(): string {
  return `${origin()}/in-app/privacy`
}

/** The reasons a person can pick for "Report this answer" (App Store rule 1.2). Only the id leaves the phone. */
export const REPORT_REASONS = [
  { id: 'wrong', label: 'Wrong or misleading' },
  { id: 'unsafe', label: 'Unsafe or harmful' },
  { id: 'offensive', label: 'Offensive' },
  { id: 'other', label: 'Something else' },
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]['id']

/** The words under each AI answer and in the reason picker. */
export const REPORT_ANSWER_LABEL = 'Report this answer'
export const REPORT_ANSWER_NOTE =
  'Lunara opens publik’s support page with only the app name and the reason you pick. It sends no chat text and no health data. You can paste text on that page if you choose.'

/**
 * publik's help and support page for the in-app sheet: the app slug and the app name
 * (`app_name`), so the page can show them. A reported AI answer adds only
 * `topic=ai-answer`, the reason id and the words of that reason (`reason_label`,
 * blind test round 2, L8): never the chat text, the answer or health data.
 * The person can paste text on the page if they choose to. The page ignores the
 * parameters that it does not know yet; they stay in the link.
 */
export function publikSupportUrl(report?: { reason: ReportReason }): string {
  const query = new URLSearchParams({ app: APP_SLUG, app_name: APP_NAME })
  if (report) {
    query.set('topic', 'ai-answer')
    query.set('reason', report.reason)
    query.set('reason_label', REPORT_REASONS.find((reason) => reason.id === report.reason)?.label ?? report.reason)
  }
  return `${origin()}/in-app/support?${query.toString()}`
}

/**
 * Settings > Delete account: sign this phone out of publik (signOutHere: the phone
 * forgets first, then POST /installs/revoke, best effort) and delete every publik
 * value Lunara keeps here, the usage-counting ID too. "Count my use: Off" stays
 * off. Cycle data is not touched; Settings asks about it separately.
 */
export function deletePublikDataOnThisPhone(fetchImpl: FetchLike = providerFetch, options: SignOutOptions = {}): Promise<void> {
  return signOutHere(fetchImpl, { ...options, forgetTelemetryId: true })
}

/** The words when this phone's own storage fails more than STORAGE_TRIES times in a row (never the raw error). */
export const STORAGE_PROBLEM = 'Lunara could not read its data on this phone. Tap Retry.'
/** The words when the iPhone is still locked and the key cannot be read yet. */
export const PHONE_LOCKED = 'Unlock your iPhone, then tap Retry.'

/**
 * A storage failure that a second try fixes: IndexedDB work that iOS aborted while the web view was
 * paused ("Transaction aborted"), a closed or lost database connection, or an inactive transaction.
 */
export function storageHiccup(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { name, message } = error as { name?: unknown; message?: unknown }
  if (typeof name === 'string' && ['AbortError', 'DatabaseClosedError', 'TransactionInactiveError', 'InvalidStateError', 'UnknownError', 'OpenFailedError'].includes(name)) return true
  return typeof message === 'string' && /transaction|database|indexeddb|idb/i.test(message)
}

/**
 * The words of an unexpected failure on the "not reachable" screen: publik's own sentence for a publik
 * error (never with money), fixed words for anything else. A raw error text never shows.
 */
export function problemText(error: unknown): string | undefined {
  if (error instanceof PublikApiError) return error.kind === 'unreachable' ? undefined : withoutMoney(error.message) ?? undefined
  if (vaultLocked(error)) return PHONE_LOCKED
  if (storageHiccup(error)) return STORAGE_PROBLEM
  return undefined
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** One storage step, tried again after a storage hiccup (each try is its own short IndexedDB transaction). */
async function retryStorage<T>(step: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await step()
    } catch (error) {
      if (!storageHiccup(error) || attempt >= STORAGE_TRIES) throw error
      await pause(STORAGE_RETRY_MS)
    }
  }
}

/** PUBLIK_TEST_SIGN_IN (test builds only): one line in the CI log when the gate lets the person in. */
function testLine(line: string): void {
  if (!launch.testSignIn) return
  console.log(line)
  if (isNative) void Promise.resolve().then(() => nativeLaunch.publikTestLine({ line })).catch(() => undefined)
}

async function gateLoop(ui: GateUI, notNow: boolean): Promise<GateResult | null> {
  await selfTestIfAsked().catch(() => undefined)
  // The plan screen needs the storefront before it shows (purchase links: US storefront only).
  await loadStorefront()
  watchForeground()
  // "Not now" on every screen of an on-demand sign-in (optional mode); never on the wall.
  const offer = (screen: GateScreen): GateScreen => (notNow ? { ...screen, buttons: [...screen.buttons, { action: 'not_now', label: 'Not now' }] } : screen)
  let signNote: string | null = null, signPoll = true, planNote: string | null = null, planPoll = false, chosenNow = false
  let revokedInARow = 0
  let storageFailures = 0
  // PUBLIK_TEST_SIGN_IN (test builds only): the first "Sign in with publik" is pressed by itself.
  let autoSignIn = launch.testSignIn
  const done = (result: GateResult): GateResult => {
    // iOS: the sheet's own wallet check has nothing more to wait for.
    if (isNative && nativePlatform === 'ios') void Promise.resolve().then(() => nativeLaunch.publikWatchStop()).catch(() => undefined)
    testLine(`publik sign-in test: passed ${APP_SLUG} ${APP_VERSION}`)
    return result
  }
  for (;;) {
    // Never freeze: any unexpected error (the vault, the database, a screen) shows "not reachable" with Retry.
    // A storage hiccup (iOS aborts IndexedDB work while the web view is paused) is tried again first, without a screen.
    try {
      let c: PublikCredential | null = null
      let r: Awaited<ReturnType<typeof readWallet>>
      let signedInBefore = false
      try {
        signedInBefore = (await getSetting(SK.publikClaimState)) === 'claimed'
        c = (await readCredential()) ?? (await provisionCredential())
        r = await readWallet(c.key, signedInBefore ? OFFLINE_WAIT_MS : WALLET_TIMEOUT_MS)
      } catch (e) {
        const offline = e instanceof PublikApiError && e.kind === 'unreachable'
        // Offline after the first sign-in: Lunara opens on this phone's last answer from publik.
        if (offline && c && signedInBefore) {
          startTelemetry()
          return done({ key: c.key, wallet: offlineWallet(), choice: c.choice, chosenNow: false, offline: true })
        }
        if (storageHiccup(e) && ++storageFailures < STORAGE_TRIES) {
          await pause(STORAGE_RETRY_MS)
          continue
        }
        storageFailures = 0
        if ((await ask(ui, offer(gateScreen('unreachable', null, null, problemText(e))))) === 'not_now') return null
        continue
      }
      storageFailures = 0
      if (r.status === 401) {
        // A revoked key: provision again. A new key that is refused at once too: wait for Retry, never loop on publik.
        if (++revokedInARow >= 2 && (await ask(ui, offer(gateScreen('unreachable', null, null, r.message ?? undefined)))) === 'not_now') return null
        await forgetInstall()
        continue
      }
      revokedInARow = 0
      const w = r.wallet
      if (!w) {
        // publik is up but failing (5xx, 429): a phone that signed in before still opens.
        if ((r.status >= 500 || r.status === 429) && signedInBefore) {
          startTelemetry()
          return done({ key: c.key, wallet: offlineWallet(), choice: c.choice, chosenNow: false, offline: true })
        }
        if ((await ask(ui, offer(gateScreen('unreachable', null, null, r.message ?? undefined)))) === 'not_now') return null
        continue
      }
      if (w.claim_state !== 'claimed') {
        const a = autoSignIn ? 'sign_in' : await ask(ui, offer(gateScreen('sign_in', w, signNote)), c.key, signPoll ? 'claimed' : undefined)
        autoSignIn = false
        if (a === 'not_now') return null
        if (a === 'sign_in') {
          // Only publik's sign-in link, never another publik page: without one, say so and wait for another try.
          // The sheet closes by itself when publik says "claimed" (iOS: the native shell checks while it is open).
          const link = w.claim_url ?? c.claim_url
          if (link) { ui.openUrl(inAppClaimUrl(link), sheetWatch(c.key, 'claimed')); signNote = SIGN_IN_WAITING; signPoll = true }
          else { signNote = NO_SIGN_IN_LINK; signPoll = false }
        }
        if (a === 'timeout') { signNote = 'No sign-in after 10 minutes. Tap Sign in with publik to try again.'; signPoll = false }
        if (a === 'done') closeBrowser()
        continue
      }
      // The plan screen: Lunara AI runs on a phone, for a known adult; a browser build, a known minor and an unknown age skip it.
      const asksAi = gateAsksPlanHere() && (await knownAdult())
      let choice: Choice | null = asksAi ? c.choice : null
      if (asksAi && !choice) {
        if (w.plan.kind !== 'none' || w.balance_micros > 0) { planNote = null; planPoll = false } // the plan is there: Connect your plan
        // The plan screen always has "Not now" (gateScreen): it is a choice, not the sign-in wall.
        const a = await ask(ui, gateScreen('choose', w, planNote), c.key, planPoll ? 'plan' : undefined)
        planNote = null; planPoll = false
        if (a === 'not_now') {
          // Signed in, no answer yet: Lunara asks again the next time.
          startTelemetry()
          return done({ key: c.key, wallet: w, choice: null, chosenNow: false, offline: false })
        }
        if (a === 'get_plan') { ui.openUrl(w.top_up_url, sheetWatch(c.key, 'plan')); planNote = 'Waiting for your plan. Finish on the publik page.'; planPoll = true }
        // No purchase link here: read the account again. With a plan, the next screen is Connect your plan.
        if (a === 'check_plan') planNote = `No plan on your publik account yet. ${NO_LINK_PLAN_TEXT}`
        if (a === 'timeout') planNote = 'No plan after 10 minutes. Tap Get a plan to try again.'
        if (a === 'done') closeBrowser()
        if (a !== 'connect' && a !== 'own_key') continue // "done": the plan is there; the next screen is Connect your plan
        choice = a === 'connect' ? 'publik' : 'own_key'
        const chosen = choice
        await retryStorage(() => setChoice(chosen))
        chosenNow = true
      }
      startTelemetry()
      return done({ key: c.key, wallet: w, choice, chosenNow, offline: false })
    } catch (e) {
      if (storageHiccup(e) && ++storageFailures < STORAGE_TRIES) {
        await pause(STORAGE_RETRY_MS)
        continue
      }
      storageFailures = 0
      if ((await ask(ui, offer(gateScreen('unreachable', null, null, problemText(e))))) === 'not_now') return null
    }
  }
}

/** Builder check, run by the BUILT app: PUBLIK_SELF_TEST=1 makes ensureSignedIn() print this line and end the app. */
export async function selfTest(): Promise<string> {
  try {
    await provision()
    const c = await readCredential()
    if (!c) throw new Error('publik could not set up this phone.')
    const r = await readWallet(c.key)
    if (!r.wallet) throw new Error(r.message ?? `GET /wallet answered ${r.status}`)
    return `publik self-test: ok ${APP_SLUG} ${APP_VERSION}`
  } catch (e) {
    const offline = e instanceof PublikApiError && e.kind === 'unreachable'
    return `publik self-test: failed: ${offline ? 'publik is not reachable. Check your connection.' : e instanceof Error ? e.message : String(e)}`
  }
}

// ---------- usage counting: /skills/telemetry.md sections 3-5 ----------
// Two events only, with the install key. The body has exactly the fields
// below: never a log, a cycle date, a symptom or any other health data.

let timer: ReturnType<typeof setInterval> | null = null
let lastSentAt = 0
/** Changes at every stop: an event already on its way when counting stops is not sent. */
let telemetryRun = 0

/** Usage counting is on unless the person turned it off in Settings, or the launch says DO_NOT_TRACK / PUBLIK_TELEMETRY=0. */
export async function usageCountingOn(): Promise<boolean> {
  if (launch.usageOff) return false
  return (await getSetting(SK.publikUsage)) !== 'off'
}

/** Settings: "Count my use". Off sends nothing and makes no telemetry ID. */
export async function setUsageCounting(on: boolean): Promise<void> {
  if (on) await removeSetting(SK.publikUsage)
  else await setSetting(SK.publikUsage, 'off')
}

/** One random UUID for this app on this phone (apps on a phone cannot share a file). Never in a backup. */
async function telemetryInstallId(): Promise<string> {
  const saved = (await getSetting(SK.publikTelemetryId))?.toLowerCase()
  if (saved && UUID_V4.test(saved)) return saved
  const fresh = newInstallId().toLowerCase()
  await setSetting(SK.publikTelemetryId, fresh).catch(() => undefined) // if it cannot be saved, it lasts for this run
  return fresh
}

async function sendEvent(event: 'app_opened' | 'active_session'): Promise<void> {
  const say = (result: unknown) => {
    if (launch.debug) console.info(`publik-telemetry: ${event} -> ${result}`)
  }
  const run = telemetryRun
  try {
    if (!(await usageCountingOn())) return say('off (opt-out)')
    const key = await readKey()
    if (run !== telemetryRun) return say('stopped (signed out)')
    lastSentAt = Date.now()
    const body = { v: 1, app: APP_SLUG, install_id: await telemetryInstallId(), event, app_version: APP_VERSION.replace(/^v/i, ''), os: deviceOs() }
    const res = await withTimeout(
      providerFetch(`${origin()}/api/v1/telemetry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key?.startsWith('pk_') ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify(body),
      }),
      TELEMETRY_TIMEOUT_MS,
    )
    say(res.status)
  } catch (e) {
    say(e instanceof Error ? e.name : 'error')
  }
}

function restartTimer(): void {
  if (timer) clearInterval(timer)
  timer = setInterval(() => void sendEvent('active_session'), TELEMETRY_EVERY_MS)
}

/** Called by ensureSignedIn(). app_opened now, active_session every 30 minutes; never fails the app, never blocks. */
export function startTelemetry(): void {
  if (timer) return
  restartTimer()
  void sendEvent('app_opened')
}

/** Sign-out, a revoked key and Delete account stop usage counting until the next sign-in. */
export function stopTelemetry(): void {
  if (timer) clearInterval(timer)
  timer = null
  telemetryRun++
}

/** A phone pauses timers in the background: coming back after 30 minutes or more counts as an active session at once. */
function resumeTelemetry(): void {
  if (!timer || Date.now() - lastSentAt < TELEMETRY_EVERY_MS) return
  restartTimer()
  void sendEvent('active_session')
}

/** Tests only: forget the launch options, the timer and the foreground state between cases. */
export function _resetPublikForTests(): void {
  stopTelemetry()
  lastSentAt = 0
  signOutListeners.clear()
  launch = launchFrom({})
  launchLoaded = null
  foreground = true
  wakers.clear()
}
