import { Browser } from '@capacitor/browser'
import { useEffect, useState, type ReactNode } from 'react'
import { gateMode } from '../lib/buildFlags'
import {
  applyChoiceToAi,
  ensureSignedIn,
  gateScreen,
  needsSignInOnDemand,
  onPublikSignOut,
  openWithoutWall,
  signInOnDemand,
  type GateAction,
  type GateResult,
  type GateScreen,
  type GateUI,
} from '../lib/publik'
import { isNative } from '../native/runtime'
import { LunaraMark } from './LunaraMark'

/**
 * Sign in with publik. The words and the order of the screens come from the
 * publik module (lib/publik.ts); this file only draws them. Sign-in opens
 * publik's bare in-app page (inAppClaimUrl in lib/publik.ts) in the in-app
 * browser: SFSafariViewController on iOS, a Custom Tab on Android. The US
 * "Get a plan" link opens the normal publik site there.
 *
 * PUBLIK_GATE_MODE (lib/buildFlags.ts):
 *   required (default)  <PublikGate> is a wall before onboarding, the PIN lock and the tabs.
 *                       After onboarding (the age is known), askPlanAfterOnboarding() shows
 *                       the plan screen to an adult. Every sign-out (Settings, Lunara AI,
 *                       Delete account) shows the wall again at once.
 *   optional            <PublikGate> shows nothing at start. <RequirePublik> around Lunara AI
 *                       and the Settings sign-in row asks for sign-in, with "Not now".
 */

// One screen at a time, shared by every mount (React StrictMode mounts twice in development).
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

/** "Connect your plan" selects publik API for Lunara AI; "Use my own key" keeps the person's own provider. */
async function settle<T extends GateResult | null>(result: T): Promise<T> {
  if (result?.chosenNow && result.choice) await applyChoiceToAi(result.choice).catch(() => undefined)
  draw(null)
  return result
}

let wall: Promise<GateResult> | null = null
let onDemand: Promise<GateResult | null> | null = null

/** Required mode: the wall, one at a time. A failure forgets the promise, so the next call starts again. */
export function startWall(): Promise<GateResult> {
  return (wall ??= ensureSignedIn(ui)
    .then(settle)
    .catch((error: unknown) => {
      wall = null
      throw error
    }))
}

type ShowScreen = (screen: GateScreen) => Promise<GateAction>
const showOnWall: ShowScreen = (screen) => ui.show(screen, new AbortController().signal)

/**
 * The wall until the person is through. It never freezes: when the gate fails
 * in an unexpected way, "publik is not reachable" shows with Retry, and Retry
 * starts the gate again.
 */
export async function passWall(show: ShowScreen = showOnWall): Promise<GateResult> {
  for (;;) {
    try {
      return await startWall()
    } catch (error) {
      await show(gateScreen('unreachable', null, null, error instanceof Error && error.message ? error.message : undefined))
    }
  }
}

/** Required mode, after a sign-out: forget the passed wall, so the next passWall() asks again. */
export function forgetWall(): void {
  wall = null
}

/** Optional mode: the gate on demand, one at a time. Resolves null after "Not now". */
export function signInWithPublik(): Promise<GateResult | null> {
  return (onDemand ??= signInOnDemand(ui)
    .then(settle)
    .finally(() => {
      onDemand = null
    }))
}

/**
 * Required mode, when onboarding ends: the gate runs once more. The person is
 * signed in, and now the age is known, so an adult sees the plan screen
 * (a minor never does). Optional mode asks at Lunara AI instead.
 */
export function askPlanAfterOnboarding(): void {
  if (gateMode() !== 'required') return
  wall = null
  void passWall()
}

function useGateScreen(): [GateScreen | null, boolean, (action: GateAction) => void] {
  const [screen, setScreen] = useState<GateScreen | null>(shown)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const listener = (next: GateScreen | null) => {
      setScreen(next)
      setBusy(false)
    }
    listeners.add(listener)
    setScreen(shown)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  function press(action: GateAction) {
    const resolve = pick
    if (!resolve) return
    pick = null
    setBusy(true)
    resolve(action)
  }
  return [screen, busy, press]
}

function GateCard({ screen, busy, press, overlay }: { screen: GateScreen; busy: boolean; press: (action: GateAction) => void; overlay?: boolean }) {
  return (
    <main className={`startup-failure-shell publik-gate${overlay ? ' publik-gate-overlay' : ''}`} role={overlay ? 'dialog' : undefined} aria-modal={overlay ? true : undefined}>
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
                className={index === 0 ? 'cta' : button.action === 'not_now' ? 'text-button' : 'cta secondary'}
                disabled={busy}
                onClick={() => press(button.action)}
              >
                {button.label}
              </button>
            ))}
          </div>
          {screen.id === 'sign_in' && (
            <p className="microcopy publik-gate-note">
              After you sign in, Lunara tells publik when the app opens. It sends no health data. You can turn
              this off in Settings.
            </p>
          )}
        </section>
      </div>
    </main>
  )
}

/** Any gate screen asked while the app is on screen (the plan after onboarding, an on-demand sign-in). */
function GateOverlay() {
  const [screen, busy, press] = useGateScreen()
  return screen ? <GateCard screen={screen} busy={busy} press={press} overlay /> : null
}

export function PublikGate({ children }: { children: ReactNode }) {
  const required = gateMode() === 'required'
  const [screen, busy, press] = useGateScreen()
  const [passed, setPassed] = useState(!required)
  // A new round after each sign-out: the wall runs again.
  const [round, setRound] = useState(0)

  useEffect(() => {
    let alive = true
    if (required) {
      void passWall().then(() => {
        if (alive) setPassed(true)
      })
    } else {
      void openWithoutWall().catch(() => undefined)
    }
    return () => {
      alive = false
    }
  }, [required, round])

  useEffect(() => {
    if (!required) return
    // Required mode: every sign-out path returns to the wall at once (lib/publik.ts announces it).
    return onPublikSignOut(() => {
      forgetWall()
      draw(null)
      setPassed(false)
      setRound((n) => n + 1)
    })
  }, [required])

  if (passed)
    return (
      <>
        {children}
        <GateOverlay />
      </>
    )
  if (!screen) return <div className="page page-loading" role="status" aria-label="Checking your publik sign-in" />
  return <GateCard screen={screen} busy={busy} press={press} />
}

/**
 * Optional mode: sign in first, then show `children` (Lunara AI). "Not now"
 * calls onCancel and shows nothing. Required mode: the wall already did it.
 */
export function RequirePublik({ children, onCancel }: { children: ReactNode; onCancel: () => void }) {
  const [ready, setReady] = useState(gateMode() === 'required')
  useEffect(() => {
    if (ready) return
    let alive = true
    void (async () => {
      let result: GateResult | true | null = null
      try {
        result = (await needsSignInOnDemand()) ? await signInWithPublik() : true
      } catch {
        result = null // an unexpected failure closes Lunara AI instead of leaving an empty screen
      }
      if (!alive) return
      if (result) setReady(true)
      else onCancel()
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return ready ? <>{children}</> : null
}
