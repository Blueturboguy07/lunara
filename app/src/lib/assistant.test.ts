import { describe, expect, it, vi } from 'vitest'
import {
  anthropicCredentialKind,
  ANTHROPIC_OAUTH_BETA,
  askAssistant,
  askAssistantDetailed,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  type ChatMessage,
} from './assistant'
import { PublikApiError } from './publikApi'

const history: ChatMessage[] = [{ role: 'user', content: 'Why might cycle length vary?' }]

function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name)
}

function anthropicReply(text: string, stopReason = 'end_turn'): Response {
  return new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: DEFAULT_ANTHROPIC_MODEL,
      content: [{ type: 'text', text }],
      stop_reason: stopReason,
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe('assistant transport', () => {
  it('classifies Anthropic credentials so each goes on the right header', () => {
    expect(anthropicCredentialKind('sk-ant-api03-abc')).toBe('api-key')
    expect(anthropicCredentialKind('sk-ant-oat01-abc')).toBe('cli-token')
    expect(anthropicCredentialKind('sk-proj-abc')).toBeNull()
    expect(anthropicCredentialKind('')).toBeNull()
  })

  it('sends a console API key as x-api-key', async () => {
    let captured: RequestInit | undefined
    let capturedUrl: RequestInfo | URL | undefined
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = url
      captured = init
      return anthropicReply('Cycles can vary for several reasons.')
    })

    const result = await askAssistant(
      { provider: 'anthropic', apiKey: 'sk-ant-api03-key', model: DEFAULT_ANTHROPIC_MODEL },
      history,
      { cycle: { cycleDay: 12 } },
      fetchMock,
    )

    expect(result).toBe('Cycles can vary for several reasons.')
    expect(String(capturedUrl)).toContain('/v1/messages')
    expect(headerOf(captured, 'x-api-key')).toBe('sk-ant-api03-key')
    expect(headerOf(captured, 'authorization')).toBeNull()
    expect(headerOf(captured, 'anthropic-version')).toBe('2023-06-01')
    const body = JSON.parse(String(captured?.body))
    expect(body.model).toBe(DEFAULT_ANTHROPIC_MODEL)
    expect(body.system).toContain('"cycle":{"cycleDay":12}')
    expect(body.messages).toEqual(history)
  })

  it('sends a `claude setup-token` CLI token as a bearer token with the OAuth beta', async () => {
    // The CLI token is an OAuth credential — on x-api-key it would 401, so the
    // header choice is the whole point of the cli-token path.
    let captured: RequestInit | undefined
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      captured = init
      return anthropicReply('A subscription-billed answer.')
    })

    const result = await askAssistant(
      { provider: 'anthropic', apiKey: 'sk-ant-oat01-token', model: DEFAULT_ANTHROPIC_MODEL },
      history,
      {},
      fetchMock,
    )

    expect(result).toBe('A subscription-billed answer.')
    expect(headerOf(captured, 'authorization')).toBe('Bearer sk-ant-oat01-token')
    expect(headerOf(captured, 'x-api-key')).toBeNull()
    expect(headerOf(captured, 'anthropic-beta')).toContain(ANTHROPIC_OAUTH_BETA)
  })

  it('does not imply access to tracker data when no categories are approved', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.system).toContain('has not shared tracker data')
      expect(body.system).not.toContain('cycleDay')
      expect(body.system).not.toContain('periodStarts')
      return anthropicReply('A general answer.')
    })

    await askAssistant(
      { provider: 'anthropic', apiKey: 'sk-ant-api03-key', model: DEFAULT_ANTHROPIC_MODEL },
      history,
      {},
      fetchMock,
    )
  })

  it('surfaces a safety refusal instead of reading an empty content array', async () => {
    // A declined request is a 200 with stop_reason "refusal"; indexing content
    // unconditionally would throw instead of explaining what happened.
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'msg_2',
          type: 'message',
          role: 'assistant',
          model: DEFAULT_ANTHROPIC_MODEL,
          content: [],
          stop_reason: 'refusal',
          usage: { input_tokens: 4, output_tokens: 0 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(
      askAssistant(
        { provider: 'anthropic', apiKey: 'sk-ant-api03-key', model: DEFAULT_ANTHROPIC_MODEL },
        history,
        {},
        fetchMock,
      ),
    ).rejects.toThrow(/safety system declined/)
  })

  it('explains that a CLI token expires when Anthropic rejects the credential', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(
      askAssistant(
        { provider: 'anthropic', apiKey: 'sk-ant-oat01-token', model: DEFAULT_ANTHROPIC_MODEL },
        history,
        {},
        fetchMock,
      ),
    ).rejects.toThrow(/claude setup-token/)
  })

  it('rejects a credential that is not an Anthropic one before any request', async () => {
    const fetchMock = vi.fn(async () => anthropicReply('should not be reached'))

    await expect(
      askAssistant(
        { provider: 'anthropic', apiKey: 'sk-proj-openai', model: DEFAULT_ANTHROPIC_MODEL },
        history,
        {},
        fetchMock,
      ),
    ).rejects.toThrow(/does not look like an Anthropic credential/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the OpenAI Responses API without server-side storage', async () => {
    let capturedUrl: RequestInfo | URL | undefined
    let capturedInit: RequestInit | undefined
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = url
      capturedInit = init
      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Cycles can vary for several reasons.' }],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const result = await askAssistant(
      { provider: 'openai', apiKey: 'test-key', model: DEFAULT_OPENAI_MODEL },
      history,
      { cycle: { cycleDay: 12 } },
      fetchMock,
    )

    expect(result).toBe('Cycles can vary for several reasons.')
    expect(capturedUrl).toBe('https://api.openai.com/v1/responses')
    expect((capturedInit?.headers as Record<string, string>).authorization).toBe('Bearer test-key')
    const body = JSON.parse(String(capturedInit?.body))
    expect(body.store).toBe(false)
    expect(body.input).toEqual(history)
    expect(body.instructions).toContain('"cycle":{"cycleDay":12}')
  })

  it('never includes provider error bodies in user-facing errors', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('server echoed test-key and sensitive tracker text', { status: 500 }),
    )

    await expect(
      askAssistant(
        { provider: 'openai', apiKey: 'test-key', model: DEFAULT_OPENAI_MODEL },
        history,
        undefined,
        fetchMock,
      ),
    ).rejects.toThrow('Assistant request failed (500). Check the provider and model settings.')
  })

  it('sends publik through the gateway base (no /v1/v1) with the tier alias and no server-side storage', async () => {
    let capturedUrl: RequestInfo | URL | undefined
    let capturedInit: RequestInit | undefined
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = url
      capturedInit = init
      return new Response(
        JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Answer from publik.' }] }] }),
        { status: 200, headers: { 'content-type': 'application/json', 'x-publik-balance': '410000', 'x-publik-claim-state': 'anonymous', 'x-publik-charge-micros': '1400' } },
      )
    })

    const reply = await askAssistantDetailed(
      { provider: 'publik', apiKey: 'pk_live_test', model: '' },
      history,
      { cycle: { cycleDay: 12 } },
      fetchMock,
    )

    expect(reply.text).toBe('Answer from publik.')
    expect(reply.publik?.balanceMicros).toBe(410000)
    expect(reply.publik?.chargeMicros).toBe(1400)
    expect(reply.publik?.claimState).toBe('anonymous')
    expect(capturedUrl).toBe('https://publikhq.com/api/v1/responses')
    expect((capturedInit?.headers as Record<string, string>).authorization).toBe('Bearer pk_live_test')
    const body = JSON.parse(String(capturedInit?.body))
    expect(body.model).toBe('publik-balanced')
    expect(body.store).toBe(false)
    expect(body.max_output_tokens).toBe(1200)
    expect(body.input).toEqual(history)
  })

  it('honours the base_url and model slugs announced by POST /installs', async () => {
    let capturedUrl: RequestInfo | URL | undefined
    let capturedInit: RequestInit | undefined
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = url
      capturedInit = init
      return new Response(JSON.stringify({ output_text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    await askAssistant(
      {
        provider: 'publik',
        apiKey: 'pk_live_test',
        model: 'publik-fast',
        baseUrl: 'https://user-override.example',
        publik: { baseUrl: 'https://preview.publikhq.com/api/v1', models: { fast: 'publik-fast-v2', balanced: 'publik-balanced', smart: 'publik-smart' } },
      },
      history,
      undefined,
      fetchMock,
    )
    expect(capturedUrl).toBe('https://preview.publikhq.com/api/v1/responses')
    expect(JSON.parse(String(capturedInit?.body)).model).toBe('publik-fast-v2')
  })

  it('renders a 402 as a PublikApiError with exactly one link, top_up_url', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            type: 'insufficient_credit',
            message: 'Not enough publik credit for this request. Link this computer and pick a plan at the link below, or use your own key.',
            claim_state: 'anonymous',
            top_up_url: 'https://publikhq.com/claim/HK7F-2QWD',
            claim_url: 'https://publikhq.com/claim/HK7F-2QWD',
            add_credit_url: 'https://publikhq.com/dashboard/api/add',
          },
        }),
        { status: 402, headers: { 'content-type': 'application/json' } },
      ),
    )
    const failure = await askAssistant({ provider: 'publik', apiKey: 'pk_live_test', model: 'publik-balanced' }, history, undefined, fetchMock).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(PublikApiError)
    const error = failure as PublikApiError
    expect(error.kind).toBe('needs_credit')
    expect(error.link).toBe('https://publikhq.com/claim/HK7F-2QWD')
    expect(error.message).toContain('pick a plan')
  })

  it('a fetch that throws on publik becomes unreachable; on openai the original error propagates', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('Could not reach the AI provider. Check your network connection.')
    })
    const publikFailure = await askAssistant({ provider: 'publik', apiKey: 'pk_live_test', model: '' }, history, undefined, fetchMock).catch((e: unknown) => e)
    expect(publikFailure).toBeInstanceOf(PublikApiError)
    expect((publikFailure as PublikApiError).kind).toBe('unreachable')
    await expect(
      askAssistant({ provider: 'openai', apiKey: 'test-key', model: DEFAULT_OPENAI_MODEL }, history, undefined, fetchMock),
    ).rejects.toThrow('Could not reach the AI provider. Check your network connection.')
  })

  it('refuses to send on publik without a key and never fetches', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    const failure = await askAssistant({ provider: 'publik', model: '' }, history, undefined, fetchMock).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(PublikApiError)
    expect((failure as PublikApiError).kind).toBe('disconnected')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
