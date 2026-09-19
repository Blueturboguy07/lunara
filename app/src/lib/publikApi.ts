/**
 * The pure half of publik API support: endpoint shapes, header parsing,
 * error typing, and copy. No storage, no network, no Capacitor — so the
 * transport (assistant.ts) can import it without pulling Dexie or the native
 * vault into a node test.
 *
 * HTTP shapes follow ~/publik-api-research/CONTRACT.md §1, §3.2, §5, §11, §12.
 *
 * Copy rule (CONTRACT §1): "publik API", dollars, never tokens, never
 * "credits" as a unit, never the provider's name.
 */
import { PUBLIK_BUILD } from './publikBuild'

export type PublikClaimState = 'anonymous' | 'claimed'

/** Tier aliases the gateway resolves (CONTRACT §2). */
export type PublikTier = 'fast' | 'balanced' | 'smart'
export type PublikModelMap = Record<PublikTier, string>

export const DEFAULT_PUBLIK_MODELS: PublikModelMap = {
  fast: 'publik-fast',
  balanced: 'publik-balanced',
  smart: 'publik-smart',
}

export const PUBLIK_MODELS: ReadonlyArray<{ tier: PublikTier; id: string; label: string }> = [
  { tier: 'fast', id: DEFAULT_PUBLIK_MODELS.fast, label: 'Fast · lowest cost' },
  { tier: 'balanced', id: DEFAULT_PUBLIK_MODELS.balanced, label: 'Balanced · recommended' },
  { tier: 'smart', id: DEFAULT_PUBLIK_MODELS.smart, label: 'Most capable · needs a linked account' },
]
export const DEFAULT_PUBLIK_MODEL = DEFAULT_PUBLIK_MODELS.balanced

/** What POST /installs told this phone, honoured over the compiled defaults (CONTRACT §1). */
export interface PublikEndpoint {
  baseUrl: string
  models: PublikModelMap
}

export const DEFAULT_PUBLIK_ENDPOINT: PublikEndpoint = {
  baseUrl: PUBLIK_BUILD.baseUrl,
  models: DEFAULT_PUBLIK_MODELS,
}

export interface PublikUsage {
  balanceMicros: number | null
  weekUsedMicros: number | null
  weekBudgetMicros: number | null
  weekResetsAt: string | null
  starterRemainingMicros: number | null
  claimState: PublikClaimState | null
  /** Non-streaming responses carry the settled charge (CONTRACT §11.6). */
  chargeMicros: number | null
}

export type PublikErrorKind = 'needs_credit' | 'disconnected' | 'rate_limited' | 'unreachable' | 'rejected'

/**
 * A publik-specific failure the UI renders as fixed copy plus at most one
 * link. `reprovision` is set on a `key_revoked` 401: true means the idle
 * sweep took the key and the same install may mint again; false means the
 * owner disconnected it and the app must start over with a fresh install.
 */
export class PublikApiError extends Error {
  constructor(
    readonly kind: PublikErrorKind,
    message: string,
    readonly link: string | null = null,
    readonly retryAfterSeconds: number | null = null,
    readonly reprovision: boolean | null = null,
  ) {
    super(message)
    this.name = 'PublikApiError'
  }
}

/** Formats micros as "$0.25". Never prints a unit other than dollars. */
export function dollars(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`
}

/**
 * The one-sentence justification (CONTRACT §12.1b). Verbatim from
 * ~/publik/lib/publik-api/why-it-costs.ts `whyItCostsSentence('Lunara')`;
 * the install response's `disclosure.cost` replaces it once known.
 */
export const PUBLIK_WHY_IT_COSTS =
  "The AI model behind Lunara is run by a provider that charges per use; publik passes that on at half the provider's list price, nothing is charged behind your back, and you can see every call on your dashboard."

export const PUBLIK_DATA_PATH =
  'Only your message and the tracker categories you tick go through publik’s servers to a shared model account. publik never trains on them and does not store them. Your cycle history stays on this phone.'

/** The primary button while anonymous (CONTRACT §12.1c) and once claimed (§12.2). */
export function publikLinkButtonLabel(claimState: PublikClaimState | null): string {
  return claimState === 'claimed' ? 'Add a plan or pack' : 'Link this phone & pick a plan'
}

/** Only https://publikhq.com/… links are ever opened from the app (CONTRACT §11.4). */
export function publikUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return null
    if (url.hostname !== 'publikhq.com' && !url.hostname.endsWith('.publikhq.com')) return null
    return url.toString()
  } catch {
    return null
  }
}

/** The gateway base URL from a response, or null when it is not an https publik host. */
export function publikBaseUrl(value: unknown): string | null {
  const url = publikUrl(value)
  return url ? url.replace(/\/+$/, '') : null
}

export function publikModelsFrom(value: unknown): PublikModelMap {
  const models = { ...DEFAULT_PUBLIK_MODELS }
  if (!value || typeof value !== 'object') return models
  const raw = value as Record<string, unknown>
  for (const tier of ['fast', 'balanced', 'smart'] as const) {
    if (typeof raw[tier] === 'string' && (raw[tier] as string).trim()) models[tier] = (raw[tier] as string).trim()
  }
  return models
}

/** Maps a saved alias (`publik-balanced`) to the slug the gateway announced for that tier. */
export function resolvePublikModel(model: string | undefined, endpoint: PublikEndpoint): string {
  const chosen = (model ?? '').trim() || DEFAULT_PUBLIK_MODEL
  const entry = PUBLIK_MODELS.find((m) => m.id === chosen)
  return entry ? endpoint.models[entry.tier] : chosen
}

export function readPublikUsage(headers: Headers): PublikUsage {
  const int = (name: string) => {
    const raw = headers.get(name)
    if (raw === null || raw === 'none') return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  const claim = headers.get('x-publik-claim-state')
  return {
    balanceMicros: int('x-publik-balance') ?? int('x-publik-balance-micros'),
    weekUsedMicros: int('x-publik-week-used'),
    weekBudgetMicros: int('x-publik-week-budget'),
    weekResetsAt: headers.get('x-publik-week-resets-at'),
    starterRemainingMicros: int('x-publik-starter-remaining'),
    claimState: claim === 'anonymous' || claim === 'claimed' ? claim : null,
    chargeMicros: int('x-publik-charge-micros'),
  }
}

interface PublikErrorBody {
  error?: {
    type?: string
    message?: string
    claim_state?: string
    top_up_url?: string
    claim_url?: string
    add_credit_url?: string
    reprovision?: boolean
  }
}

const UNREACHABLE = 'publik API is unreachable right now. Nothing is being charged. Try again in a minute, or use your own key.'

/**
 * Maps a non-2xx gateway response to a typed error. The body is read only on
 * the publik path: the envelope is publik's own and carries no echoed
 * credential or health context, which is why assistant.ts refuses to read
 * vendor bodies. Only a 402's `message` is shown verbatim — it carries the
 * justification the contract requires (§12.3); every other status renders
 * fixed copy.
 */
export async function publikErrorFrom(response: Response): Promise<PublikApiError> {
  let body: PublikErrorBody = {}
  try {
    body = (await response.json()) as PublikErrorBody
  } catch {
    // no body, fall through to status-only mapping
  }
  const err = body.error ?? {}
  const retry = Number(response.headers.get('retry-after'))
  const retryAfter = Number.isFinite(retry) && retry > 0 ? retry : null
  const claimed = err.claim_state === 'claimed'
  // Exactly one link, `top_up_url` (CONTRACT §1); older bodies may carry only the pair.
  const topUp = publikUrl(err.top_up_url) ?? publikUrl(claimed ? err.add_credit_url : err.claim_url)

  switch (response.status) {
    case 402: {
      const fallback = claimed
        ? 'Not enough publik balance for this request. Add a plan or a pack at the link below, or use your own key.'
        : 'Your free publik starter is used up. Link this phone and pick a plan at the link below, or use your own key.'
      const message =
        (err.type === 'insufficient_credit' || err.type === 'model_requires_claim') && typeof err.message === 'string' && err.message.trim()
          ? err.message.trim()
          : fallback
      return new PublikApiError('needs_credit', message, topUp)
    }
    case 401: {
      if (err.type === 'key_revoked') {
        const reprovision = err.reprovision === true
        return new PublikApiError(
          'disconnected',
          reprovision
            ? 'publik API needs to reconnect this phone after a long idle period.'
            : 'publik API is disconnected. This phone was removed from your publik account.',
          null,
          null,
          reprovision,
        )
      }
      return new PublikApiError('rejected', 'publik API rejected this phone’s key. Disconnect and reconnect publik API in AI settings.')
    }
    case 403:
      return new PublikApiError(
        'disconnected',
        'publik API is disconnected. This phone was removed from your publik account.',
        null,
        null,
        err.reprovision === true,
      )
    case 429: {
      const capped = err.type === 'daily_cap_reached' || err.type === 'week_budget_reached'
      return new PublikApiError(
        'rate_limited',
        err.type === 'daily_cap_reached'
          ? 'publik API has reached today’s spending cap for this phone. It resets at midnight UTC.'
          : err.type === 'week_budget_reached'
            ? 'publik API has reached this week’s plan budget. It resets at the start of the next weekly window.'
            : 'publik API is busy. Try again shortly.',
        capped ? topUp : null,
        retryAfter,
      )
    }
    default:
      return new PublikApiError('unreachable', `publik API is unreachable right now (${response.status}). Nothing is being charged. Try again in a minute, or use your own key.`, null, retryAfter)
  }
}

export function publikUnreachable(): PublikApiError {
  return new PublikApiError('unreachable', UNREACHABLE)
}

/** The single status sentence the settings row and the assistant header show. */
export function publikStatusLine(usage: PublikUsage | null): string {
  if (!usage || usage.balanceMicros === null) return 'Ready'
  const left = `${dollars(usage.balanceMicros)} left`
  if (usage.claimState === 'anonymous' && usage.starterRemainingMicros !== null) {
    return `${left} of free starter usage · link this phone to add more`
  }
  if (usage.weekBudgetMicros !== null && usage.weekUsedMicros !== null) {
    return `${left} · this week ${dollars(usage.weekUsedMicros)} of ${dollars(usage.weekBudgetMicros)}`
  }
  return usage.weekUsedMicros !== null ? `${left} · ${dollars(usage.weekUsedMicros)} used this week` : left
}

/** The balance line of the first-run card (CONTRACT §12.1a). */
export function publikBalanceLine(balanceMicros: number | null, claimState: PublikClaimState | null): string {
  if (balanceMicros === null) return 'Checking your publik balance…'
  return claimState === 'claimed'
    ? `${dollars(balanceMicros)} of publik usage available`
    : `${dollars(balanceMicros)} of free starter usage`
}

/** Adults only: the AI companion, and publik with it, is hidden under 18 everywhere. */
export function isAdultBirthYear(birthYear: string | undefined, now = new Date()): boolean {
  if (!birthYear || !/^\d{4}$/.test(birthYear)) return false
  return now.getFullYear() - Number(birthYear) >= 18
}
