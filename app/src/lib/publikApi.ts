/**
 * The pure half of publik API support: endpoint shapes, header parsing,
 * error typing, and copy. No storage, no network, no Capacitor — so the
 * transport (assistant.ts) can import it without pulling Dexie or the native
 * vault into a node test.
 *
 * HTTP shapes follow ~/publik-api-research/CONTRACT.md §1, §3.2, §5, §11, §12.
 *
 * Copy rule (CONTRACT §1): "publik API", never tokens, never "credits" as a
 * unit, never the provider's name. Founder rule (Nov 14 2026): the app shows
 * no amount of money for AI use anywhere. AI use shows only as a percent of
 * the plan limit ("62% of your plan used · resets Monday"), or as "Plan
 * active" / "Plan limit reached" when publik gives no limit to compare with.
 * src/lib/noMoneyShown.test.ts fails when a text has "$" and a digit.
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
  { tier: 'fast', id: DEFAULT_PUBLIK_MODELS.fast, label: 'Fast · uses the least of your plan' },
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

/**
 * What publik reports about AI use. The micros fields are for the app's own
 * arithmetic only: the screens never show them (planUseFrom turns them into a percent).
 */
export interface PublikUsage {
  balanceMicros: number | null
  weekUsedMicros: number | null
  weekBudgetMicros: number | null
  weekResetsAt: string | null
  starterRemainingMicros: number | null
  claimState: PublikClaimState | null
  /** Non-streaming responses carry the settled charge (CONTRACT §11.6). Never shown. */
  chargeMicros: number | null
  /** GET /api/v1/wallet `used_percent`, `remaining_percent` and `resets_at`, when publik sends them. */
  usedPercent: number | null
  remainingPercent: number | null
  resetsAt: string | null
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
    /** The plan limit is reached (402 on a linked account, 429 week_budget_reached): the screen shows planLimitText(). */
    readonly planLimit: boolean = false,
    /** When the plan limit resets, if publik said so. */
    readonly resetsAt: string | null = null,
  ) {
    super(message)
    this.name = 'PublikApiError'
  }
}

/**
 * The one free thing publik API gives (publik migration 0059), in micros:
 * paid once per publik account when a phone is first linked to it, or when
 * an install is minted already bound to the signed-in account. A new,
 * unlinked install starts empty, so every metered call answers 402 until the
 * phone is linked, a plan or pack is bought, or the user adds a key. The app
 * never shows this amount.
 */
export const PUBLIK_LINK_STARTER_MICROS = 50_000

/** How Lunara AI is paid for, in words with no amount of money. */
export const PUBLIK_PLAN_SENTENCE =
  'Lunara AI uses your publik plan. Lunara shows how much of the plan limit you used, as a percent, and when it resets.'

/** Where purchase links are not allowed (lib/storefront.ts): the only words about getting a plan. */
export const NO_LINK_PLAN_TEXT = 'To get a plan, search for "publik" on Google.'

/** True when a text names an amount of money: a dollar sign and a digit, or a number with "USD" or "dollars". */
export function namesMoney(text: string): boolean {
  return /\$\s?\d|\d\s?(usd|dollars?)\b/i.test(text)
}

/** A text from the server, or null when it names an amount of money: the app never shows one. */
export function withoutMoney(text: string | null | undefined): string | null {
  const value = typeof text === 'string' ? text.trim() : ''
  return value && !namesMoney(value) ? value : null
}

/** AI use as a share of the publik plan limit. */
export interface PlanUse {
  /** Whole percent of the plan limit used (0 to 100), or null when publik gave no limit to compare with. */
  usedPercent: number | null
  limitReached: boolean
  resetsAt: string | null
}

const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/**
 * The plan use from what publik reported: `used_percent`, else `remaining_percent`,
 * else the week's used and limit values. With none of them, only "limit reached"
 * (nothing left) or not.
 */
export function planUseFrom(usage: PublikUsage | null): PlanUse | null {
  if (!usage) return null
  const used = finite(usage.usedPercent)
  const remaining = finite(usage.remainingPercent)
  const weekUsed = finite(usage.weekUsedMicros)
  const weekLimit = finite(usage.weekBudgetMicros)
  const raw =
    used !== null ? used : remaining !== null ? 100 - remaining : weekUsed !== null && weekLimit !== null && weekLimit > 0 ? (weekUsed / weekLimit) * 100 : null
  const resetsAt = usage.resetsAt ?? usage.weekResetsAt
  if (raw === null) {
    const balance = finite(usage.balanceMicros)
    return { usedPercent: null, limitReached: balance !== null && balance <= 0, resetsAt }
  }
  const limitReached = raw >= 100
  // Floor: the line says 100% only when the limit is really reached.
  const percent = Math.min(limitReached ? 100 : 99, Math.max(0, Math.floor(raw)))
  return { usedPercent: percent, limitReached, resetsAt }
}

const DAY_MS = 86_400_000

/** "today", "tomorrow", a weekday ("Monday") within a week, else "on November 21". Null when unknown or past. */
export function resetsLabel(resetsAt: string | null, now: Date = new Date()): string | null {
  if (!resetsAt) return null
  const at = new Date(resetsAt)
  if (Number.isNaN(at.getTime())) return null
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS)
  if (days < 0) return null
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days < 7) return at.toLocaleDateString('en-US', { weekday: 'long' })
  return `on ${at.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
}

/** The plan-limit message: what happened, when it resets, how to get more (storefront rule), and "use your own key". */
export function planLimitText(resetsAt: string | null, purchaseLinks: boolean, now: Date = new Date()): string {
  const when = resetsLabel(resetsAt, now)
  const first = `Your publik plan limit is reached. ${when ? `It resets ${when}.` : 'It resets at the start of the next plan period.'}`
  return purchaseLinks ? `${first} Add a plan or pack at the link below, or use your own key.` : `${first} ${NO_LINK_PLAN_TEXT} Or use your own key.`
}

/** A phone that is not linked to a publik account yet (no plan to use). */
export function notLinkedText(purchaseLinks: boolean): string {
  return purchaseLinks
    ? 'This phone is not linked to a publik plan yet. Link it at the link below, or use your own key.'
    : `This phone is not linked to a publik plan yet. ${NO_LINK_PLAN_TEXT} Or use your own key.`
}

/** A usage record from a balance only (POST /installs): enough for "Plan active" or "Plan limit reached". */
export function usageFromBalance(balanceMicros: number | null, claimState: PublikClaimState | null): PublikUsage {
  return {
    balanceMicros,
    weekUsedMicros: null,
    weekBudgetMicros: null,
    weekResetsAt: null,
    starterRemainingMicros: null,
    claimState,
    chargeMicros: null,
    usedPercent: null,
    remainingPercent: null,
    resetsAt: null,
  }
}

/** Where an AI chat message goes on publik API. The agreement screen (lib/healthConsent.ts) lists the exact data. */
export const PUBLIK_DATA_PATH =
  'AI chat is optional and asks before it sends anything. Then your question, the earlier messages in this chat and an anonymized summary of the tracker data you tick go through publik’s servers to the AI provider that answers (for example Anthropic, Google or OpenAI). It has no name, email or birth date. publik does not store the content of your messages or answers, and does not use it for ads, analytics, training, or sale. It keeps billing records (model, token counts, cost) without content.'

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
    usedPercent: null,
    remainingPercent: null,
    resetsAt: null,
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
    resets_at?: string
  }
}

const UNREACHABLE = 'publik API is unreachable right now. Nothing is used from your plan. Try again in a minute, or use your own key.'

/**
 * Maps a non-2xx gateway response to a typed error. The body is read only on
 * the publik path: the envelope is publik's own and carries no echoed
 * credential or health context, which is why assistant.ts refuses to read
 * vendor bodies. Every status renders fixed copy: a server message could name
 * an amount of money, and the app never shows one.
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
      const resetsAt = typeof err.resets_at === 'string' ? err.resets_at : null
      if (err.type === 'model_requires_claim') {
        return new PublikApiError('needs_credit', 'The most capable model needs a publik account. Link this phone at the link below, pick another model, or use your own key.', topUp)
      }
      if (!claimed) return new PublikApiError('needs_credit', notLinkedText(true), topUp)
      return new PublikApiError('needs_credit', planLimitText(resetsAt, true), topUp, null, null, true, resetsAt)
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
      const resetsAt = typeof err.resets_at === 'string' ? err.resets_at : null
      if (err.type === 'week_budget_reached') return new PublikApiError('rate_limited', planLimitText(resetsAt, true), topUp, retryAfter, null, true, resetsAt)
      if (err.type === 'daily_cap_reached') {
        return new PublikApiError('rate_limited', 'publik API has reached today’s use limit for this phone. It resets at midnight UTC.', topUp, retryAfter)
      }
      return new PublikApiError('rate_limited', 'publik API is busy. Try again shortly.', null, retryAfter)
    }
    default:
      return new PublikApiError('unreachable', `publik API is unreachable right now (${response.status}). Nothing is used from your plan. Try again in a minute, or use your own key.`, null, retryAfter)
  }
}

export function publikUnreachable(): PublikApiError {
  return new PublikApiError('unreachable', UNREACHABLE)
}

/**
 * The one status line of Settings, the AI header and the first-run card: the plan use as a
 * percent ("62% of your plan used · resets Monday"), else "Plan active" or "Plan limit
 * reached". Never an amount of money, also not on the US storefront.
 */
export function publikStatusLine(usage: PublikUsage | null, now: Date = new Date()): string {
  const use = planUseFrom(usage)
  if (!use) return 'Ready'
  const when = resetsLabel(use.resetsAt, now)
  const tail = when ? ` · resets ${when}` : ''
  if (use.usedPercent === null && usage?.claimState === 'anonymous') return 'Not linked to a publik plan yet'
  if (use.limitReached) return `Plan limit reached${tail}`
  if (use.usedPercent !== null) return `${use.usedPercent}% of your plan used${tail}`
  return `Plan active${tail}`
}

/**
 * Adults only: the AI companion, and publik with it, is hidden under 18 everywhere.
 * Lunara knows only the birth year. A person born in year Y can still be 17 on
 * the last day of Y+18, so the rule is: the current year minus the birth year
 * is 19 or more. Then the person is 18 or older on every day of the year. (An
 * 18-year-old born late in the year waits until January 1.)
 */
export function isAdultBirthYear(birthYear: string | undefined, now = new Date()): boolean {
  if (!birthYear || !/^\d{4}$/.test(birthYear)) return false
  return now.getFullYear() - Number(birthYear) >= 19
}
