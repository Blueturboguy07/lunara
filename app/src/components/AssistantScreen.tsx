import { Browser } from '@capacitor/browser'
import { useEffect, useRef, useState } from 'react'
import { getSetting, removeSetting, setSetting, SK } from '../db/schema'
import {
  anthropicCredentialKind,
  ANTHROPIC_MODELS,
  askAssistantDetailed,
  CLI_TOKEN_PREFIX,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  type AssistantConfig,
  type AssistantProvider,
  type ChatMessage,
} from '../lib/assistant'
import {
  collectApprovedAssistantContext,
  NO_ASSISTANT_CONSENT,
  parseAssistantConsent,
  type AssistantConsent,
} from '../lib/assistantContext'
import { screenAssistantUrgency } from '../lib/assistantSafety'
import {
  DEFAULT_PUBLIK_MODEL,
  disconnectPublik,
  dollars,
  fetchPublikWallet,
  hasPublikKey,
  markPublikCardSeen,
  provisionPublik,
  PUBLIK_BUILD,
  PUBLIK_DATA_PATH,
  PUBLIK_MODELS,
  PUBLIK_WHY_IT_COSTS,
  publikAvailable,
  publikBalanceLine,
  publikEndpoint,
  publikLinkButtonLabel,
  publikLocalState,
  publikStatusLine,
  PublikApiError,
  type PublikClaimState,
  type PublikEndpoint,
  type PublikUsage,
} from '../lib/publik'
import {
  deleteSecureSecret,
  getSecureSecret,
  SECURE_SECRET_KEYS,
  secureVaultStatus,
  setSecureSecret,
} from '../native/secureVault'
import { useApp } from '../state/appStore'
import { LunaraMark } from './LunaraMark'
import '../styles/assistant.css'

const CONSENT_OPTIONS: Array<{
  key: keyof AssistantConsent
  title: string
  detail: string
  sensitive?: boolean
}> = [
  { key: 'cycle', title: 'Cycle summary', detail: 'Period starts and current prediction' },
  { key: 'symptoms', title: 'Symptoms & mood', detail: 'Up to 30 recent logged days' },
  {
    key: 'fertility',
    title: 'Fertility & intimacy',
    detail: 'BBT, tests, discharge, sex, and pregnancy timing',
    sensitive: true,
  },
  { key: 'notes', title: 'Private notes', detail: 'Up to 12 recent notes', sensitive: true },
]

const STARTERS = [
  'What can change cycle length?',
  'Help me prepare questions for my doctor.',
  'Explain my fertile-window estimate.',
]

function defaultModel(provider: AssistantProvider): string {
  if (provider === 'publik') return DEFAULT_PUBLIK_MODEL
  return provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL
}

function vaultKeyFor(provider: AssistantProvider) {
  if (provider === 'publik') return SECURE_SECRET_KEYS.publikApiKey
  return provider === 'anthropic'
    ? SECURE_SECRET_KEYS.anthropicApiKey
    : SECURE_SECRET_KEYS.openAiApiKey
}

function providerLabel(provider: AssistantProvider): string {
  if (provider === 'publik') return 'publik API'
  return provider === 'anthropic' ? 'Anthropic' : 'OpenAI'
}

/** The link an app opens must be the user's publik sign-in in the system browser, never the WebView. */
function openPublikLink(url: string) {
  void Browser.open({ url })
}

/** What the first-run card (CONTRACT §12.1) shows: the real balance plus the justification. */
interface PublikCard {
  balanceMicros: number | null
  claimState: PublikClaimState | null
  claimUrl: string | null
  costSentence: string
}

export function AssistantScreen() {
  const setAssistantOpen = useApp((state) => state.setAssistantOpen)
  const [provider, setProvider] = useState<AssistantProvider>('anthropic')
  const [model, setModel] = useState(DEFAULT_ANTHROPIC_MODEL)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [consent, setConsent] = useState<AssistantConsent>(NO_ASSISTANT_CONSENT)
  const [vaultLabel, setVaultLabel] = useState('secure storage')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [setupOpen, setSetupOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // publik API
  const [publikHere, setPublikHere] = useState(false)
  const [publikUsage, setPublikUsage] = useState<PublikUsage | null>(null)
  const [publikError, setPublikError] = useState<PublikApiError | null>(null)
  const [publikBusy, setPublikBusy] = useState(false)
  const [publikEndpointState, setPublikEndpointState] = useState<PublikEndpoint | null>(null)
  const [claimUrl, setClaimUrl] = useState<string | null>(null)
  const [claimState, setClaimState] = useState<PublikClaimState | null>(null)
  const [starterMicros, setStarterMicros] = useState<number | null>(null)
  const [costSentence, setCostSentence] = useState(PUBLIK_WHY_IT_COSTS)
  const [publikCard, setPublikCard] = useState<PublikCard | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const composerInput = useRef<HTMLTextAreaElement>(null)

  const credentialKind = apiKey ? anthropicCredentialKind(apiKey) : null

  async function refreshWallet() {
    try {
      const wallet = await fetchPublikWallet()
      setPublikUsage(wallet)
      if (wallet.claimState) setClaimState(wallet.claimState)
      if (wallet.claimUrl) setClaimUrl(wallet.claimUrl)
      return wallet
    } catch {
      // the line stays "Ready"; nothing is charged by a failed read
      return null
    }
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [
        savedProvider,
        savedModel,
        savedBaseUrl,
        savedConsent,
        status,
        legacyKey,
        savedOpenAiKey,
        savedAnthropicKey,
        available,
        publikKey,
        local,
        endpoint,
      ] = await Promise.all([
        getSetting(SK.aiProvider),
        getSetting(SK.aiModel),
        getSetting(SK.aiBaseUrl),
        getSetting(SK.aiConsent),
        secureVaultStatus(),
        getSetting(SK.aiKey),
        getSecureSecret(SECURE_SECRET_KEYS.openAiApiKey),
        getSecureSecret(SECURE_SECRET_KEYS.anthropicApiKey),
        publikAvailable(),
        hasPublikKey(),
        publikLocalState(),
        publikEndpoint(),
      ])
      const nextProvider: AssistantProvider =
        savedProvider === 'openai'
          ? 'openai'
          : savedProvider === 'anthropic'
            ? 'anthropic'
            : savedProvider === 'publik' && available
              ? 'publik'
              : available
                ? 'publik' // fresh install on a publik-capable build: preselected
                : 'anthropic'

      // One-time migration from the old Dexie implementation. Plaintext is
      // removed immediately after the secure bridge accepts it.
      if (legacyKey) {
        await setSecureSecret(SECURE_SECRET_KEYS.openAiApiKey, legacyKey)
        await removeSetting(SK.aiKey)
      }
      const key =
        nextProvider === 'publik'
          ? publikKey
            ? await getSecureSecret(SECURE_SECRET_KEYS.publikApiKey)
            : null
          : nextProvider === 'anthropic'
            ? savedAnthropicKey
            : legacyKey || savedOpenAiKey
      if (!alive) return
      setPublikHere(available)
      setPublikEndpointState(endpoint)
      setClaimUrl(local.claimUrl)
      setClaimState(local.claimState)
      setStarterMicros(local.starterMicros)
      if (local.costSentence) setCostSentence(local.costSentence)
      setProvider(nextProvider)
      setModel(savedModel || defaultModel(nextProvider))
      setBaseUrl(savedBaseUrl || '')
      setConsent(parseAssistantConsent(savedConsent))
      setApiKey(key)
      setVaultLabel(
        status.persistence === 'memory'
          ? 'memory only for this browser tab'
          : `${status.persistence}${status.hardwareBacked ? ' · hardware protected' : ''}`,
      )
      setSetupOpen(!key)
      setLoading(false)
      if (nextProvider === 'publik' && key) {
        // Never a silent starter (CONTRACT §12.4): the card is shown before the first send.
        if (!local.cardSeen) {
          setPublikCard({
            balanceMicros: local.starterMicros,
            claimState: local.claimState,
            claimUrl: local.claimUrl,
            costSentence: local.costSentence ?? PUBLIK_WHY_IT_COSTS,
          })
        }
        void refreshWallet().then((wallet) => {
          if (!alive || !wallet) return
          setPublikCard((card) =>
            card ? { ...card, balanceMicros: wallet.balanceMicros, claimState: wallet.claimState ?? card.claimState, claimUrl: wallet.topUpUrl ?? card.claimUrl } : card,
          )
        })
      }
    })().catch((reason: unknown) => {
      if (!alive) return
      setError(reason instanceof Error ? reason.message : 'Could not load AI settings.')
      setLoading(false)
      setSetupOpen(true)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => {
    const textarea = composerInput.current
    if (!textarea) return
    textarea.style.height = '0px'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 104)}px`
  }, [input])

  async function chooseProvider(next: AssistantProvider) {
    setProvider(next)
    setModel(defaultModel(next))
    setBaseUrl('')
    setKeyInput('')
    setError(null)
    setNotice(null)
    setPublikError(null)
    setApiKey(await getSecureSecret(vaultKeyFor(next)))
  }

  /** Consent first: only the "Continue with publik API" tap mints, never a load. */
  async function connectPublik(options: { fresh?: boolean } = {}): Promise<string | null> {
    setPublikBusy(true)
    setPublikError(null)
    setError(null)
    try {
      const install = await provisionPublik(options)
      const key = install.key ?? (await getSecureSecret(SECURE_SECRET_KEYS.publikApiKey))
      setApiKey(key)
      setPublikEndpointState(install.endpoint)
      setClaimUrl(install.claimUrl)
      setClaimState(install.claimState)
      if (install.starterMicros > 0) setStarterMicros(install.starterMicros)
      if (install.costSentence) setCostSentence(install.costSentence)
      await Promise.all([
        setSetting(SK.aiProvider, 'publik'),
        setSetting(SK.aiModel, PUBLIK_MODELS.some((m) => m.id === model) ? model : DEFAULT_PUBLIK_MODEL),
        setSetting(SK.aiBaseUrl, ''),
        setSetting(SK.publikDisclosureVersion, String(PUBLIK_BUILD.disclosureVersion)),
      ])
      // The first-run card, immediately after POST /installs succeeds (CONTRACT §12.1).
      setPublikCard({
        balanceMicros: install.balanceMicros,
        claimState: install.claimState,
        claimUrl: install.claimUrl,
        costSentence: install.costSentence ?? PUBLIK_WHY_IT_COSTS,
      })
      return key
    } catch (reason) {
      if (reason instanceof PublikApiError) setPublikError(reason)
      else setError(reason instanceof Error ? reason.message : 'Could not connect publik API.')
      return null
    } finally {
      setPublikBusy(false)
    }
  }

  async function saveConfiguration() {
    const cleanModel = model.trim() || defaultModel(provider)
    setError(null)
    setNotice(null)
    setPublikError(null)
    if (provider === 'publik') {
      if (!apiKey) {
        const key = await connectPublik()
        if (!key) return
        setModel(cleanModel)
        setSetupOpen(false)
        return
      }
      await Promise.all([
        setSetting(SK.aiProvider, 'publik'),
        setSetting(SK.aiModel, PUBLIK_MODELS.some((m) => m.id === cleanModel) ? cleanModel : DEFAULT_PUBLIK_MODEL),
        setSetting(SK.aiBaseUrl, ''),
      ])
      setModel(cleanModel)
      setSetupOpen(false)
      setNotice('AI connection settings saved.')
      return
    }
    try {
      const suppliedKey = keyInput.trim()
      if (suppliedKey) {
        if (provider === 'anthropic' && anthropicCredentialKind(suppliedKey) === null) {
          setError('Anthropic credentials start with sk-ant- (an API key or a `claude setup-token` token).')
          return
        }
        if (provider === 'openai' && !suppliedKey.startsWith('sk-')) {
          setError('That does not look like an OpenAI API key.')
          return
        }
        await setSecureSecret(vaultKeyFor(provider), suppliedKey)
        setApiKey(suppliedKey)
        setKeyInput('')
      }
      await Promise.all([
        setSetting(SK.aiProvider, provider),
        setSetting(SK.aiModel, cleanModel),
        setSetting(SK.aiBaseUrl, baseUrl.trim()),
      ])
      setModel(cleanModel)
      if (!apiKey && !suppliedKey) {
        setError(
          provider === 'anthropic'
            ? 'Add an Anthropic API key, or paste a token from `claude setup-token`.'
            : 'Add an OpenAI project key, or choose another provider.',
        )
        return
      }
      setSetupOpen(false)
      setNotice('AI connection settings saved.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save AI settings.')
    }
  }

  async function removeKey() {
    await deleteSecureSecret(vaultKeyFor(provider))
    setApiKey(null)
    setKeyInput('')
    setNotice(
      provider === 'anthropic'
        ? 'Anthropic credential removed from this device. Revoke it in the Anthropic console to invalidate it everywhere.'
        : 'OpenAI key removed.',
    )
  }

  async function disconnect() {
    setPublikBusy(true)
    try {
      await disconnectPublik()
    } finally {
      setPublikBusy(false)
    }
    setApiKey(null)
    setPublikUsage(null)
    setPublikCard(null)
    setClaimUrl(null)
    setClaimState(null)
    setStarterMicros(null)
    setNotice('publik API disconnected from this phone.')
  }

  async function dismissPublikCard() {
    setPublikCard(null)
    await markPublikCardSeen()
  }

  async function toggleConsent(key: keyof AssistantConsent) {
    const next = { ...consent, [key]: !consent[key] }
    setConsent(next)
    await setSetting(SK.aiConsent, JSON.stringify(next))
  }

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim()
    if (!text || busy) return
    if (!apiKey) {
      setSetupOpen(true)
      setError(
        provider === 'publik'
          ? 'Connect publik API before sending a message, or use your own key.'
          : provider === 'anthropic'
            ? 'Add an Anthropic key or CLI token before sending a message.'
            : 'Add an OpenAI key before sending a message.',
      )
      return
    }

    const next = [...messages, { role: 'user' as const, content: text }]
    setMessages(next)
    setInput('')
    const safetyIntercept = screenAssistantUrgency(text)
    if (safetyIntercept) {
      setMessages([...next, { role: 'assistant', content: safetyIntercept.response }])
      setError(null)
      setNotice('This safety message was generated on device; no provider request was made.')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    setPublikError(null)
    try {
      const approvedContext = await collectApprovedAssistantContext(consent)
      const ask = async (key: string) => {
        const config: AssistantConfig = {
          provider,
          apiKey: key,
          model,
          baseUrl: baseUrl || undefined,
          publik: provider === 'publik' ? (publikEndpointState ?? undefined) : undefined,
        }
        return askAssistantDetailed(config, next, approvedContext)
      }
      let reply
      try {
        reply = await ask(apiKey)
      } catch (reason) {
        // An idle-swept key (reprovision: true) is re-keyed once on the same install and the send retried once.
        if (reason instanceof PublikApiError && reason.kind === 'disconnected' && reason.reprovision === true) {
          const fresh = await connectPublik()
          if (!fresh) throw reason
          reply = await ask(fresh)
        } else {
          throw reason
        }
      }
      setMessages([...next, { role: 'assistant', content: reply.text }])
      if (reply.publik) {
        setPublikUsage(reply.publik)
        if (reply.publik.claimState) setClaimState(reply.publik.claimState)
      }
    } catch (reason) {
      if (reason instanceof PublikApiError) setPublikError(reason)
      else setError(reason instanceof Error ? reason.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  function publikErrorAction(failure: PublikApiError): { label: string; run: () => void } | null {
    switch (failure.kind) {
      case 'needs_credit':
        return failure.link ? { label: claimState === 'claimed' ? 'Add a plan or pack' : 'Link this phone & pick a plan', run: () => openPublikLink(failure.link as string) } : null
      case 'rate_limited':
        return failure.link ? { label: publikLinkButtonLabel(claimState), run: () => openPublikLink(failure.link as string) } : { label: 'Retry', run: () => void send(messages.at(-1)?.content) }
      case 'unreachable':
        return { label: 'Retry', run: () => void send(messages.at(-1)?.content) }
      case 'disconnected':
        return { label: 'Reconnect publik API', run: () => void connectPublik({ fresh: failure.reprovision === false }) }
      case 'rejected':
        return { label: 'Reconnect publik API', run: () => void connectPublik({ fresh: true }) }
    }
  }

  const sharedCount = Object.values(consent).filter(Boolean).length
  const linkTarget = claimUrl
  const linkLabel = publikLinkButtonLabel(claimState)

  const publikErrorBlock = publikError && (
    <div className="assistant-error" role="alert">
      <span>{publikError.message}</span>
      <div className="assistant-error-actions">
        {(() => {
          const action = publikErrorAction(publikError)
          return action ? (
            <button className="text-button" onClick={action.run} disabled={publikBusy}>
              {action.label}
            </button>
          ) : null
        })()}
        <button
          className="text-button"
          onClick={() => {
            setPublikError(null)
            setSetupOpen(true)
            void chooseProvider('anthropic')
          }}
        >
          Use my own key instead
        </button>
      </div>
    </div>
  )

  return (
    <div
      className="overlay assistant-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Lunara AI assistant"
    >
      <header className="overlay-head assistant-head">
        <button className="back-btn" onClick={() => setAssistantOpen(false)} aria-label="Close">
          ‹
        </button>
        <div className="assistant-title">
          <LunaraMark decorative size={25} />
          <span>
            <span className="assistant-kicker">Private companion</span>
            <h2>Lunara AI</h2>
          </span>
        </div>
        <button
          className={`icon-button assistant-settings-button ${setupOpen ? 'is-active' : ''}`}
          onClick={() => setSetupOpen((open) => !open)}
          aria-label={setupOpen ? 'Close AI settings' : 'Open AI settings'}
          aria-pressed={setupOpen}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="12" r="1.25" />
            <circle cx="12" cy="12" r="1.25" />
            <circle cx="19" cy="12" r="1.25" />
          </svg>
        </button>
      </header>

      {loading ? (
        <div className="overlay-body assistant-loading">
          <LunaraMark decorative size={30} />
          <span>Preparing your private space…</span>
        </div>
      ) : publikCard && !setupOpen ? (
        <div className="overlay-body assistant-setup">
          <section className="assistant-setup-intro">
            <p className="eyebrow">publik API</p>
            <h3>Lunara AI is ready</h3>
            <p className="publik-balance">{publikBalanceLine(publikCard.balanceMicros, publikCard.claimState)}</p>
          </section>
          <section className="card ai-setup-card">
            <p className="microcopy">{publikCard.costSentence}</p>
            <p className="microcopy">{PUBLIK_DATA_PATH}</p>
          </section>
          {publikCard.claimUrl && (
            <button className="cta" onClick={() => openPublikLink(publikCard.claimUrl as string)}>
              {publikLinkButtonLabel(publikCard.claimState)}
            </button>
          )}
          <button className="text-button" onClick={() => void dismissPublikCard()}>
            {publikCard.claimState === 'claimed' ? 'Start chatting' : 'Not now — keep the free starter'}
          </button>
        </div>
      ) : setupOpen ? (
        <div className="overlay-body assistant-setup">
          <section className="assistant-setup-intro">
            <p className="eyebrow">Connection</p>
            <h3>Choose where answers come from</h3>
            <p>
              {publikHere
                ? 'publik API needs no account or key. Your own key, if you add one, stays on this device.'
                : 'Your key stays on this device.'}
            </p>
            <div className="ai-provider-grid">
              {publikHere && (
                <button
                  className={`choice-card compact ${provider === 'publik' ? 'selected' : ''}`}
                  onClick={() => void chooseProvider('publik')}
                >
                  <span className="choice-icon">◐</span>
                  <span>
                    <strong>publik API</strong>
                    <small>{apiKey && provider === 'publik' ? publikStatusLine(publikUsage) : 'No key needed · free starter usage'}</small>
                  </span>
                </button>
              )}
              <button
                className={`choice-card compact ${provider === 'anthropic' ? 'selected' : ''}`}
                onClick={() => void chooseProvider('anthropic')}
              >
                <span className="choice-icon">✳</span>
                <span><strong>Anthropic</strong><small>API key or Claude CLI login</small></span>
              </button>
              <button
                className={`choice-card compact ${provider === 'openai' ? 'selected' : ''}`}
                onClick={() => void chooseProvider('openai')}
              >
                <span className="choice-icon">✦</span>
                <span><strong>OpenAI</strong><small>Cloud · your key</small></span>
              </button>
            </div>
          </section>

          <section className="card ai-setup-card">
            {provider === 'publik' ? (
              <>
                <div className="field">
                  <label htmlFor="assistant-model">Model</label>
                  <select
                    id="assistant-model"
                    value={PUBLIK_MODELS.some((entry) => entry.id === model) ? model : DEFAULT_PUBLIK_MODEL}
                    onChange={(event) => setModel(event.target.value)}
                  >
                    {PUBLIK_MODELS.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </div>
                {apiKey && <p className="microcopy"><strong>{publikStatusLine(publikUsage)}</strong></p>}
                <p className="microcopy">
                  <strong>Cost.</strong> {costSentence}
                  {!apiKey && starterMicros === null ? ' Every new phone starts with free usage and no card.' : ''}
                  {starterMicros !== null ? ` Your first ${dollars(starterMicros)} is free.` : ''}
                </p>
                <p className="microcopy">
                  <strong>Where your messages go.</strong> {PUBLIK_DATA_PATH}
                </p>
                {apiKey && linkTarget && (
                  <button className="text-button" onClick={() => openPublikLink(linkTarget)}>
                    {linkLabel}
                  </button>
                )}
                <a className="microcopy" href="https://publikhq.com/developers#why" target="_blank" rel="noreferrer">
                  How pricing works · publik API terms
                </a>
                {apiKey && (
                  <button className="text-button danger" onClick={() => void disconnect()} disabled={publikBusy}>
                    Disconnect publik API
                  </button>
                )}
                <button className="text-button" onClick={() => void chooseProvider('anthropic')}>
                  Use my own key instead
                </button>
              </>
            ) : provider === 'anthropic' ? (
              <>
                <div className="field">
                  <label htmlFor="assistant-key">Anthropic API key or CLI token</label>
                  <input
                    id="assistant-key"
                    type="password"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={apiKey ? 'Saved securely · enter to replace' : 'sk-ant-api… or sk-ant-oat…'}
                    value={keyInput}
                    onChange={(event) => setKeyInput(event.target.value)}
                  />
                  {apiKey && (
                    <small className="field-hint">
                      Currently using{' '}
                      {credentialKind === 'cli-token'
                        ? 'a Claude CLI subscription token'
                        : 'a console API key'}
                      .
                    </small>
                  )}
                </div>

                <details className="assistant-key-fallback">
                  <summary>Use your Claude subscription instead (CLI login)</summary>
                  <p className="microcopy">
                    Lunara runs in a mobile WebView, so it cannot shell out to the{' '}
                    <code>claude</code> CLI the way a server can. Run this once on a computer
                    where you are signed in:
                  </p>
                  <pre className="cli-snippet"><code>claude setup-token</code></pre>
                  <p className="microcopy">
                    Paste the <code>{CLI_TOKEN_PREFIX}…</code> token it prints into the field
                    above. Lunara sends it as an OAuth bearer credential, so answers are billed
                    to your Claude subscription rather than to API credits. The token expires —
                    rerun the command to refresh it.
                  </p>
                </details>

                <div className="field">
                  <label htmlFor="assistant-model">Model</label>
                  <select
                    id="assistant-model"
                    value={ANTHROPIC_MODELS.some((entry) => entry.id === model) ? model : DEFAULT_ANTHROPIC_MODEL}
                    onChange={(event) => setModel(event.target.value)}
                  >
                    {ANTHROPIC_MODELS.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="assistant-key">OpenAI project API key</label>
                  <input
                    id="assistant-key"
                    type="password"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={apiKey ? 'Saved securely · enter to replace' : 'sk-proj-…'}
                    value={keyInput}
                    onChange={(event) => setKeyInput(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="assistant-model">Model</label>
                  <input
                    id="assistant-model"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                  />
                </div>
              </>
            )}
            <p className="microcopy">
              Storage: {vaultLabel}. Credentials never enter the cycle database or a backup.
            </p>
            {apiKey && provider !== 'publik' && (
              <button className="text-button danger" onClick={removeKey}>
                Remove saved credential
              </button>
            )}
          </section>

          {notice && <div className="assistant-notice" role="status">{notice}</div>}
          {publikErrorBlock}
          {error && <div className="assistant-error" role="alert">{error}</div>}
          <button className="cta" onClick={saveConfiguration} disabled={publikBusy}>
            {publikBusy
              ? 'Connecting publik API…'
              : provider === 'publik' && !apiKey
                ? 'Continue with publik API'
                : 'Save connection'}
          </button>
        </div>
      ) : (
        <>
          <section className={`assistant-context-panel ${contextOpen ? 'is-open' : ''}`}>
            <button
              className="assistant-context-summary"
              onClick={() => setContextOpen((open) => !open)}
              aria-expanded={contextOpen}
              aria-controls="assistant-consent-options"
            >
              <span className="assistant-context-mark" aria-hidden="true">
                <LunaraMark decorative size={18} />
              </span>
              <span className="assistant-context-copy">
                <strong>Tracker context</strong>
                <small>
                  {sharedCount === 0
                    ? 'Nothing shared'
                    : `${sharedCount} categor${sharedCount === 1 ? 'y' : 'ies'} selected`}
                </small>
              </span>
              <span className="privacy-pill">
                <i aria-hidden="true" />
                {providerLabel(provider)}
              </span>
              <svg className="assistant-context-chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m7 9.5 5 5 5-5" />
              </svg>
            </button>
            {provider === 'publik' && publikUsage && (
              <p className="assistant-publik-line">{publikStatusLine(publikUsage)}</p>
            )}

            {contextOpen && (
              <div className="assistant-context-disclosure" id="assistant-consent-options">
                <div className="assistant-context-note">
                  <strong>Choose what travels with your next message.</strong>
                  <span>Nothing is attached unless you select it here.</span>
                </div>
                <div className="consent-grid">
                  {CONSENT_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      className={`consent-row ${consent[option.key] ? 'selected' : ''}`}
                      onClick={() => toggleConsent(option.key)}
                      aria-pressed={consent[option.key]}
                    >
                      <span>
                        <strong>{option.title}</strong>
                        <small>
                          {option.detail}
                          {option.sensitive ? ' · Sensitive' : ''}
                        </small>
                      </span>
                      <span className="toggle-dot" aria-hidden="true"><i /></span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <div
            className={`overlay-body assistant-messages ${messages.length === 0 ? 'is-empty' : ''}`}
            ref={scroller}
            aria-live="polite"
          >
            {messages.length === 0 && (
              <div className="assistant-empty">
                <div className="assistant-orb" aria-hidden="true">
                  <span />
                  <LunaraMark decorative size={38} />
                </div>
                <span className="assistant-empty-kicker">Private by design</span>
                <h3>What would you like to understand?</h3>
                <p>
                  Ask a general question, or selectively share tracker context for a more
                  personal answer.
                </p>
                <div className="starter-list" aria-label="Starter questions">
                  {STARTERS.map((starter) => (
                    <button key={starter} onClick={() => send(starter)}>
                      <span>{starter}</span>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M7 17 17 7M9 7h8v8" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={index} className={`chat-bubble ${message.role}`}>
                {message.role === 'assistant' && (
                  <span className="chat-bubble-mark" aria-hidden="true">
                    <LunaraMark decorative size={14} />
                  </span>
                )}
                <span>{message.content}</span>
              </div>
            ))}
            {busy && (
              <div className="chat-bubble assistant typing" aria-label="Lunara is thinking">
                <span className="chat-bubble-mark" aria-hidden="true">
                  <LunaraMark decorative size={14} />
                </span>
                <span>Thinking</span>
                <i /><i /><i />
              </div>
            )}
            {notice && <div className="assistant-notice" role="status">{notice}</div>}
            {publikErrorBlock}
            {error && <div className="assistant-error" role="alert">{error}</div>}
          </div>
        </>
      )}

      {!loading && !setupOpen && !publikCard && (
        <form
          className="assistant-compose"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <div className="assistant-compose-row">
            <textarea
              ref={composerInput}
              rows={1}
              placeholder="Message Lunara…"
              aria-label="Message Lunara"
              enterKeyHint="send"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }}
            />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send message">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 18V6m-5 5 5-5 5 5" />
              </svg>
            </button>
          </div>
          <p>Educational support only · not diagnosis or emergency care</p>
        </form>
      )}
    </div>
  )
}
