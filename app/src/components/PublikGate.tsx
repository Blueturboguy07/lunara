import { Browser } from '@capacitor/browser'
import { useEffect, useState, type ReactNode } from 'react'
import {
  applyChoiceToAi,
  ensureSignedIn,
  type GateAction,
  type GateResult,
  type GateScreen,
  type GateUI,
} from '../lib/publik'
import { isNative } from '../native/runtime'
import { LunaraMark } from './LunaraMark'

/**
 * Sign in with publik, before any screen of Lunara's own (onboarding, the PIN
 * lock, the tabs). The words and the order of the screens come from the
 * publik module (lib/publik.ts); this file only draws them. Links open in the
 * system browser: SFSafariViewController on iOS, a Custom Tab on Android.
 */

// One gate per app start, shared by every mount (React StrictMode mounts twice in development).
let shown: GateScreen | null = null
let pick: ((action: GateAction) => void) | null = null
const listeners = new Set<(screen: GateScreen | null) => void>()

function draw(screen: GateScreen | null): void {
  shown = screen
  for (const listener of listeners) listener(screen)
}

const ui: GateUI = {
  show(screen, signal) {
    return new Promise<GateAction>((resolve) => {
      pick = resolve
      draw(screen)
      signal.addEventListener(
        'abort',
        () => {
          if (pick === resolve) pick = null
        },
        { once: true },
      )
    })
  },
  openUrl(url) {
    if (isNative) void Browser.open({ url }).catch(() => undefined)
    else window.open(url, '_blank', 'noopener,noreferrer')
  },
}

let run: Promise<GateResult> | null = null

function startGate(): Promise<GateResult> {
  return (run ??= ensureSignedIn(ui).then(async (result) => {
    // "Connect your plan" selects publik API for Lunara AI; "Use my own key" keeps the person's own provider.
    if (result.chosenNow && result.choice) await applyChoiceToAi(result.choice).catch(() => undefined)
    draw(null)
    return result
  }))
}

export function PublikGate({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<GateScreen | null>(shown)
  const [busy, setBusy] = useState(false)
  const [passed, setPassed] = useState(false)

  useEffect(() => {
    let alive = true
    const listener = (next: GateScreen | null) => {
      setScreen(next)
      setBusy(false)
    }
    listeners.add(listener)
    void startGate().then(() => {
      if (alive) setPassed(true)
    })
    return () => {
      alive = false
      listeners.delete(listener)
    }
  }, [])

  if (passed) return <>{children}</>
  if (!screen) return <div className="page page-loading" role="status" aria-label="Checking your publik sign-in" />

  function press(action: GateAction) {
    const resolve = pick
    if (!resolve) return
    pick = null
    setBusy(true)
    resolve(action)
  }

  return (
    <main className="startup-failure-shell publik-gate">
      <div className="page startup-failure-page">
        <section className="card startup-failure-card publik-gate-card" aria-live="polite">
          <span className="startup-failure-mark" aria-hidden="true">
            <LunaraMark decorative size={34} />
          </span>
          <p className="page-kicker">publik</p>
          <h1>{screen.title}</h1>
          <p className="muted">{screen.body}</p>
          {screen.note && (
            <p className="muted publik-gate-note" role="status">
              {screen.note}
            </p>
          )}
          <div className="publik-gate-actions">
            {screen.buttons.map((button, index) => (
              <button
                key={button.action}
                type="button"
                className={index === 0 ? 'cta' : 'cta secondary'}
                disabled={busy}
                onClick={() => press(button.action)}
              >
                {button.label}
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
