import Anthropic from '@anthropic-ai/sdk'
import { providerFetch } from './providerFetch'
import {
  DEFAULT_PUBLIK_ENDPOINT,
  PublikApiError,
  publikErrorFrom,
  publikUnreachable,
  readPublikUsage,
  resolvePublikModel,
  type PublikEndpoint,
  type PublikUsage,
} from './publikApi'

/**
 * Consent-scoped, bring-your-own-provider assistant transport.
 *
 * No health data is loaded here. Callers must build `approvedContext`
 * explicitly from the toggles the user selected for the current request.
 */
export const ASSISTANT_SYSTEM_PROMPT = `You are Lunara's health companion inside a privacy-first menstrual-health app. Explain cycles, fertility, pregnancy, symptoms, and perimenopause clearly and warmly.

Safety rules:
- You provide general education, not a diagnosis, prescription, or substitute for a clinician.
- Use calibrated language such as "may", "often", and "can"; never claim clinical certainty from tracker data.
- Never present calendar, temperature, or symptom tracking as reliable contraception.
- Do not tell someone to start, stop, or change prescription medicine.
- When symptoms could be urgent (including severe or one-sided pain, fainting, chest pain, trouble breathing, very heavy bleeding, pregnancy bleeding with pain, or thoughts of self-harm), clearly recommend prompt professional or emergency help.
- State when the available information is insufficient.
- Keep answers focused and readable.`

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * 'publik' — publik API, the shipped default: the OpenAI Responses dialect
 *   through https://publikhq.com/api/v1 with the pk_ key minted for this
 *   phone. 'anthropic' and 'openai' are the bring-your-own-key slots and are
 *   never touched by the publik path.
 */
export type AssistantProvider = 'publik' | 'anthropic' | 'openai'
export type VendorProvider = Exclude<AssistantProvider, 'publik'>

/**
 * How an Anthropic credential authenticates.
 *
 * 'api-key'  — a console key (sk-ant-api…), sent as `x-api-key`.
 * 'cli-token' — the subscription token printed by `claude setup-token`
 *   (sk-ant-oat…). It authenticates against the same Messages API but must go
 *   on `Authorization: Bearer` together with the OAuth beta header; sending it
 *   as `x-api-key` fails with a 401. This is the mobile equivalent of shelling
 *   out to `claude -p`, which a WebView cannot do.
 */
export type AnthropicCredentialKind = 'api-key' | 'cli-token'

export const ANTHROPIC_OAUTH_BETA = 'oauth-2025-04-20'
export const CLI_TOKEN_PREFIX = 'sk-ant-oat'
export const ANTHROPIC_API_KEY_PREFIX = 'sk-ant-api'

export interface AssistantConfig {
  provider: AssistantProvider
  /** Kept in the native secure vault by the UI; never written to the cycle database. */
  apiKey?: string
  model: string
  /** OpenAI-compatible base URL. A user-owned BYO override; never the gateway. */
  baseUrl?: string
  /** publik only: what POST /installs announced (base_url, models). Defaults to the compiled values. */
  publik?: PublikEndpoint
}

export interface AssistantReply {
  text: string
  /** Set on the publik provider: the x-publik-* headers of this call. */
  publik?: PublikUsage
}

export type ApprovedAssistantContext = Record<string, unknown>

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5'
export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-terra'

export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 · most capable' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 · balanced' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 · fastest' },
] as const

type FetchLike = typeof fetch

/** Classify a pasted Anthropic credential so it is sent on the right header. */
export function anthropicCredentialKind(key: string): AnthropicCredentialKind | null {
  const trimmed = key.trim()
  if (trimmed.startsWith(CLI_TOKEN_PREFIX)) return 'cli-token'
  if (trimmed.startsWith('sk-ant-')) return 'api-key'
  return null
}

function cleanBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function contextInstructions(approvedContext?: ApprovedAssistantContext): string {
  if (!approvedContext || Object.keys(approvedContext).length === 0) {
    return `${ASSISTANT_SYSTEM_PROMPT}\n\nThe user has not shared tracker data for this request. Do not imply that you can see it.`
  }

  return `${ASSISTANT_SYSTEM_PROMPT}

The following JSON contains only tracker categories the user explicitly approved for this request. Treat it as self-reported, potentially incomplete data. Do not infer or request hidden categories:
${JSON.stringify(approvedContext)}`
}

function apiError(provider: VendorProvider, status: number): Error {
  if (status === 401 || status === 403) {
    return new Error(
      provider === 'openai'
        ? 'OpenAI rejected that key. Add a fresh project key in AI settings.'
        : 'Anthropic rejected that credential. A CLI token from `claude setup-token` expires — generate a new one, or paste a console API key.',
    )
  }
  if (status === 402) return new Error('That account has no available credits.')
  if (status === 429) return new Error('The provider is rate-limiting requests. Try again shortly.')
  return new Error(`Assistant request failed (${status}). Check the provider and model settings.`)
}

function boundedHistory(history: ChatMessage[]): ChatMessage[] {
  return history.slice(-16).map((message) => ({
    role: message.role,
    content:
      message.content.length > 6_000
        ? `${message.content.slice(0, 6_000)}\n[message truncated]`
        : message.content,
  }))
}

async function askAnthropic(
  config: AssistantConfig,
  history: ChatMessage[],
  approvedContext: ApprovedAssistantContext | undefined,
  fetchImpl: FetchLike,
): Promise<string> {
  const credential = config.apiKey?.trim()
  if (!credential) {
    throw new Error('Add an Anthropic key or a `claude setup-token` CLI token before sending a message.')
  }
  const kind = anthropicCredentialKind(credential)
  if (kind === null) {
    throw new Error('That does not look like an Anthropic credential (expected sk-ant-…).')
  }

  // A CLI token is an OAuth credential: Bearer header plus the OAuth beta.
  // A console key is an x-api-key credential. Sending either on the other's
  // header is a 401, so the kind decides the client shape.
  const client = new Anthropic({
    ...(kind === 'cli-token'
      ? { authToken: credential, defaultHeaders: { 'anthropic-beta': ANTHROPIC_OAUTH_BETA } }
      : { apiKey: credential }),
    fetch: fetchImpl,
    // The credential is the user's own, entered on their device, and is never
    // sent anywhere but Anthropic. There is no server to proxy through in a
    // local-first app.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
  })

  let response
  try {
    response = await client.messages.create({
      model: config.model || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 1200,
      system: contextInstructions(approvedContext),
      messages: boundedHistory(history),
    })
  } catch (reason) {
    if (reason instanceof Anthropic.APIError && typeof reason.status === 'number') {
      throw apiError('anthropic', reason.status)
    }
    throw new Error('Could not reach Anthropic. Check your network connection.')
  }

  // Safety classifiers can decline a request; that arrives as a normal 200 with
  // an empty content array, so this must be checked before reading content.
  if (response.stop_reason === 'refusal') {
    throw new Error(
      'Anthropic’s safety system declined this request. Rephrasing it usually helps; for urgent symptoms, contact a clinician.',
    )
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
  if (!text) throw new Error('Anthropic returned no readable text.')
  return text
}

function extractOpenAIText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const data = payload as {
    output_text?: unknown
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: unknown }> }>
  }
  if (typeof data.output_text === 'string') return data.output_text.trim()

  return (data.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('')
    .trim()
}

/**
 * The OpenAI Responses dialect, for both the user's own OpenAI key and publik
 * API. The request body is identical; the endpoint, the default model and the
 * error path differ. The gateway's base already ends in /api/v1; the vendor's
 * is host-only, so the publik endpoint is computed from its own base and
 * never from `config.baseUrl`.
 */
async function askResponses(
  config: AssistantConfig,
  history: ChatMessage[],
  approvedContext: ApprovedAssistantContext | undefined,
  fetchImpl: FetchLike,
): Promise<AssistantReply> {
  const publik = config.provider === 'publik'
  const key = config.apiKey?.trim()
  if (!key) {
    throw publik
      ? new PublikApiError('disconnected', 'publik API is not connected on this phone. Connect it in AI settings, or use your own key.')
      : new Error('Add an OpenAI API key before sending a message.')
  }
  const endpoint = publik
    ? `${(config.publik ?? DEFAULT_PUBLIK_ENDPOINT).baseUrl}/responses`
    : `${cleanBaseUrl(config.baseUrl || 'https://api.openai.com')}/v1/responses`
  const model = publik
    ? resolvePublikModel(config.model, config.publik ?? DEFAULT_PUBLIK_ENDPOINT)
    : config.model || DEFAULT_OPENAI_MODEL

  let response: Response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        instructions: contextInstructions(approvedContext),
        input: boundedHistory(history).map((message) => ({
          role: message.role,
          content: message.content,
        })),
        reasoning: { effort: 'low' },
        text: { verbosity: 'low' },
        max_output_tokens: 1200,
        store: false,
      }),
    })
  } catch (reason) {
    if (publik) throw publikUnreachable()
    throw reason
  }

  if (!response.ok) {
    // publik's own envelope carries no echoed credential or health context;
    // a vendor body is never read.
    if (publik) throw await publikErrorFrom(response)
    await response.body?.cancel().catch(() => undefined)
    throw apiError('openai', response.status)
  }
  const usage = publik ? readPublikUsage(response.headers) : undefined
  const text = extractOpenAIText(await response.json())
  if (!text) throw new Error(publik ? 'publik API returned no readable text.' : 'OpenAI returned no readable text.')
  return usage ? { text, publik: usage } : { text }
}

export async function askAssistantDetailed(
  config: AssistantConfig,
  history: ChatMessage[],
  approvedContext?: ApprovedAssistantContext,
  fetchImpl: FetchLike = providerFetch,
): Promise<AssistantReply> {
  if (history.length === 0) throw new Error('Write a message first.')
  if (config.provider === 'anthropic') {
    return { text: await askAnthropic(config, history, approvedContext, fetchImpl) }
  }
  return askResponses(config, history, approvedContext, fetchImpl)
}

/** Unchanged signature for existing callers and tests. */
export async function askAssistant(
  config: AssistantConfig,
  history: ChatMessage[],
  approvedContext?: ApprovedAssistantContext,
  fetchImpl: FetchLike = providerFetch,
): Promise<string> {
  return (await askAssistantDetailed(config, history, approvedContext, fetchImpl)).text
}
