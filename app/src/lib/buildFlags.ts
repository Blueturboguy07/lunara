/**
 * Build settings of the web bundle. Each is ONE environment value at
 * `vite build` time (vite.config.ts exposes exactly these names):
 *
 *   PUBLIK_GATE_MODE=required   (default) Sign in with publik before any screen.
 *   PUBLIK_GATE_MODE=optional   The tracker opens with no wall; Lunara asks for
 *                               Sign in with publik only when the person opens
 *                               Lunara AI or the publik row in Settings.
 *   APP_STORE_BUILD=1           An App Store build: no Claude subscription-token
 *                               (`claude setup-token`) option. Anthropic and
 *                               OpenAI API keys stay. Unset = today's behaviour.
 *
 * Functions, not constants, so tests can switch a value with vi.stubEnv().
 */
export type GateMode = 'required' | 'optional'

export function gateMode(): GateMode {
  return String(import.meta.env.PUBLIK_GATE_MODE ?? '').trim().toLowerCase() === 'optional' ? 'optional' : 'required'
}

export function isAppStoreBuild(): boolean {
  const value = String(import.meta.env.APP_STORE_BUILD ?? '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}
