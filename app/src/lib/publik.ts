/**
 * The stateful half of publik API support: provisioning (POST /installs),
 * the wallet line (GET /wallet), disconnect (POST /installs/revoke) and the
 * small set of non-secret settings that go with them. The pk_ key itself
 * lives in the native vault under `publik-api-key` and never leaves this
 * module except as the bearer of a request.
 *
 * Uses only the app's own providerFetch (no CORS on native), secureVault,
 * db/schema settings and native/runtime. No new dependency.
 */
import { getSetting, removeSetting, setSetting, SK } from '../db/schema'
import { isNative, nativePlatform } from '../native/runtime'
import {
  deleteSecureSecret,
  getSecureSecret,
  SECURE_SECRET_KEYS,
  secureVaultStatus,
  setSecureSecret,
} from '../native/secureVault'
import { providerFetch } from './providerFetch'
import {
  DEFAULT_PUBLIK_ENDPOINT,
  isAdultBirthYear,
  PublikApiError,
  publikBaseUrl,
  publikErrorFrom,
  publikModelsFrom,
  publikUnreachable,
  publikUrl,
  type PublikClaimState,
  type PublikEndpoint,
  type PublikUsage,
} from './publikApi'
import { PUBLIK_BUILD, publikBuildAvailable } from './publikBuild'

export * from './publikApi'
export { PUBLIK_BUILD, publikBuildAvailable } from './publikBuild'

type FetchLike = typeof fetch

export interface PublikInstall {
  key: string | null
  installId: string
  claimUrl: string | null
  claimState: PublikClaimState
  /** The starter grant from this mint (0 on a replay). */
  starterMicros: number
  /** The live balance the gateway reported with the mint. */
  balanceMicros: number | null
  endpoint: PublikEndpoint
  /** The gateway's own cost sentence (CONTRACT §12.1b), when it sent one. */
  costSentence: string | null
}

/**
 * Whether this build can offer publik API at all: a minted app token, a
 * native shell whose vault persists (the web vault is session memory and a
 * key minted there would burn the starter every tab), and an adult profile —
 * AI is hidden under 18 everywhere.
 */
export async function publikAvailable(options: { assumeAdult?: boolean } = {}): Promise<boolean> {
  if (!publikBuildAvailable() || !isNative) return false
  if (nativePlatform !== 'ios' && nativePlatform !== 'android') return false
  const [status, birthYear] = await Promise.all([secureVaultStatus(), getSetting(SK.birthYear)])
  if (!status.available || status.persistence === 'memory') return false
  // Onboarding checks the typed year itself before SK.birthYear is saved.
  return options.assumeAdult === true || isAdultBirthYear(birthYear)
}

/** True when a pk_ key is in the vault. Never reveals the key to the caller. */
export async function hasPublikKey(): Promise<boolean> {
  return Boolean(await getSecureSecret(SECURE_SECRET_KEYS.publikApiKey))
}

/** What POST /installs told this phone, or the compiled defaults. */
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
    baseUrl: publikBaseUrl(baseUrl) ?? DEFAULT_PUBLIK_ENDPOINT.baseUrl,
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
    claimUrl: publikUrl(claimUrl),
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

function osVersionFromUserAgent(ua: string): string | null {
  const ios = /OS (\d+[_.]\d+(?:[_.]\d+)?)/.exec(ua)
  if (nativePlatform === 'ios' && ios) return ios[1].replace(/_/g, '.')
  const android = /Android (\d+(?:\.\d+)*)/.exec(ua)
  if (nativePlatform === 'android' && android) return android[1]
  return null
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
  const claimUrl = publikUrl(data.claim_url)
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
 * POST /api/v1/installs, called only after the disclosure was accepted
 * (CONTRACT §3.2 [S4]). Idempotent on install_id: a replay answers 200 with
 * key:null and mints nothing, so a crash between mint and vault write is
 * recovered by minting once more with a fresh install_id [B1]. A key the
 * idle sweep revoked is re-keyed by the same call (`reprovision: true`).
 *
 * `fresh: true` (after an owner-side revoke, `reprovision: false`) drops the
 * old install_id first and mints a new anonymous install.
 */
export async function provisionPublik(
  options: { fetchImpl?: FetchLike; fresh?: boolean } = {},
): Promise<PublikInstall> {
  const fetchImpl = options.fetchImpl ?? providerFetch
  if (!(await publikAvailable())) throw new PublikApiError('unreachable', 'publik API is not available in this build.')
  if (options.fresh) {
    await deleteSecureSecret(SECURE_SECRET_KEYS.publikApiKey)
    await removeSetting(SK.publikInstallId)
  }
  const existingId = await getSetting(SK.publikInstallId)
  const installId = existingId || newInstallId()
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const body = {
    app_token: PUBLIK_BUILD.appToken,
    app_slug: PUBLIK_BUILD.appSlug,
    app_version: PUBLIK_BUILD.appVersion,
    os: nativePlatform, // 'ios' | 'android' (CONTRACT §11.1)
    os_version: osVersionFromUserAgent(ua),
    arch: null,
    device_name: nativePlatform === 'ios' ? 'iPhone' : 'Android phone',
    install_id: installId,
    disclosure_version: PUBLIK_BUILD.disclosureVersion,
    dialects: PUBLIK_BUILD.dialects,
  }

  let response: Response
  try {
    response = await fetchImpl(`${PUBLIK_BUILD.baseUrl}/installs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw publikUnreachable()
  }
  if (!response.ok) {
    const error = await publikErrorFrom(response)
    // 403 install_revoked: this install_id is finished; start over once with a fresh one.
    if (response.status === 403 && existingId && !options.fresh) {
      return provisionPublik({ fetchImpl, fresh: true })
    }
    throw error
  }

  const data = (await response.json()) as InstallResponse

  if (data.key === null) {
    // Replay for an install_id whose key we no longer hold: mint once more.
    if (!(await hasPublikKey())) {
      if (existingId) {
        await removeSetting(SK.publikInstallId)
        return provisionPublik({ fetchImpl })
      }
      throw new PublikApiError('rejected', 'publik API could not set up this phone. Try again, or use your own key.')
    }
  } else {
    // Vault first, then settings — the key is the only thing that cannot be re-derived.
    await setSecureSecret(SECURE_SECRET_KEYS.publikApiKey, data.key)
  }

  const starterMicros = data.starter_micros ?? data.starting_credit_micros ?? 0
  await rememberInstall(data, starterMicros)

  return {
    key: data.key,
    installId: data.install_id,
    claimUrl: publikUrl(data.claim_url),
    claimState: data.claim_state === 'claimed' ? 'claimed' : 'anonymous',
    starterMicros,
    balanceMicros: typeof data.balance_micros === 'number' ? data.balance_micros : starterMicros,
    endpoint: {
      baseUrl: publikBaseUrl(data.base_url) ?? DEFAULT_PUBLIK_ENDPOINT.baseUrl,
      models: publikModelsFrom(data.models),
    },
    costSentence: typeof data.disclosure?.cost === 'string' ? data.disclosure.cost : null,
  }
}

export interface PublikWallet extends PublikUsage {
  claimUrl: string | null
  /** The one link an app renders (CONTRACT §1): claim page while anonymous, add-credit page once claimed. */
  topUpUrl: string | null
}

/** GET /api/v1/wallet — the balance line when no call has been made yet. */
export async function fetchPublikWallet(fetchImpl: FetchLike = providerFetch): Promise<PublikWallet> {
  const key = await getSecureSecret(SECURE_SECRET_KEYS.publikApiKey)
  if (!key) throw new PublikApiError('disconnected', 'publik API is not connected on this phone.')
  const endpoint = await publikEndpoint()
  let response: Response
  try {
    response = await fetchImpl(`${endpoint.baseUrl}/wallet`, { headers: { authorization: `Bearer ${key}` } })
  } catch {
    throw new PublikApiError('unreachable', 'publik API is unreachable right now. Nothing is being charged.')
  }
  if (!response.ok) throw await publikErrorFrom(response)
  const data = (await response.json()) as {
    install_id?: string | null
    claim_state?: string
    claim_url?: string | null
    top_up_url?: string | null
    base_url?: string
    balance_micros?: number
    available_micros?: number
    week?: { used_micros?: number; budget_micros?: number | null; resets_at?: string }
    starter?: { remaining_micros?: number } | null
  }
  const claimState: PublikClaimState | null =
    data.claim_state === 'claimed' || data.claim_state === 'anonymous' ? data.claim_state : null
  const claimUrl = publikUrl(data.claim_url)
  const baseUrl = publikBaseUrl(data.base_url)
  // A reinstall keeps the iOS keychain but loses Dexie: restore the id and links from the wallet.
  await Promise.all([
    data.install_id ? setSetting(SK.publikInstallId, data.install_id) : Promise.resolve(),
    claimState ? setSetting(SK.publikClaimState, claimState) : Promise.resolve(),
    claimUrl ? setSetting(SK.publikClaimUrl, claimUrl) : claimState === 'claimed' ? removeSetting(SK.publikClaimUrl) : Promise.resolve(),
    baseUrl ? setSetting(SK.publikBaseUrl, baseUrl) : Promise.resolve(),
  ])
  const balance = data.balance_micros ?? data.available_micros ?? null
  return {
    balanceMicros: balance,
    weekUsedMicros: data.week?.used_micros ?? null,
    weekBudgetMicros: data.week?.budget_micros ?? null,
    weekResetsAt: data.week?.resets_at ?? null,
    starterRemainingMicros: data.starter?.remaining_micros ?? null,
    claimState,
    chargeMicros: null,
    claimUrl,
    topUpUrl: publikUrl(data.top_up_url) ?? claimUrl,
  }
}

/** "Disconnect publik API": POST /installs/revoke (best effort), then forget everything local. */
export async function disconnectPublik(fetchImpl: FetchLike = providerFetch): Promise<void> {
  const key = await getSecureSecret(SECURE_SECRET_KEYS.publikApiKey)
  if (key) {
    const endpoint = await publikEndpoint()
    try {
      await fetchImpl(`${endpoint.baseUrl}/installs/revoke`, { method: 'POST', headers: { authorization: `Bearer ${key}` } })
    } catch {
      // offline: the idle sweep revokes it server-side
    }
  }
  await deleteSecureSecret(SECURE_SECRET_KEYS.publikApiKey)
  await Promise.all(
    [
      SK.publikInstallId,
      SK.publikClaimUrl,
      SK.publikClaimState,
      SK.publikBaseUrl,
      SK.publikModels,
      SK.publikStarterMicros,
      SK.publikCostSentence,
      SK.publikCardSeen,
    ].map((key) => removeSetting(key)),
  )
}
