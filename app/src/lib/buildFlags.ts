import { isNative, nativePlatform } from '../native/runtime'

/**
 * Build settings of the web bundle. Each is ONE environment value at
 * `vite build` time (vite.config.ts exposes exactly these names):
 *
 *   PUBLIK_GATE_MODE=required   (default) Sign in with publik before any screen.
 *   PUBLIK_GATE_MODE=optional   The tracker opens with no wall; Lunara asks for
 *                               Sign in with publik only when the person opens
 *                               Lunara AI or the publik row in Settings.
 *   APP_STORE_BUILD             An App Store build has no Claude subscription-token
 *                               (`claude setup-token`) option. Anthropic and OpenAI
 *                               API keys stay. Default: on in the iOS app, off
 *                               elsewhere. APP_STORE_BUILD=1 turns it on everywhere;
 *                               APP_STORE_BUILD=0 turns it off, also on iOS (an Xcode
 *                               Release archive then fails: ios/App/scripts/check-release-build.sh).
 *   PUBLIK_TEST_HOOKS=1         A test build: the publik test hooks work
 *                               (PUBLIK_API_BASE_URL, PUBLIK_SELF_TEST). A release
 *                               build refuses it (vite.config.ts). `pnpm dev` has
 *                               the hooks without it.
 *
 * Functions, not constants, so tests can switch a value with vi.stubEnv().
 */
export type GateMode = 'required' | 'optional'

function envValue(name: string): string {
  return String((import.meta.env as Record<string, unknown>)[name] ?? '').trim().toLowerCase()
}

export function gateMode(): GateMode {
  return envValue('PUBLIK_GATE_MODE') === 'optional' ? 'optional' : 'required'
}

export function isAppStoreBuild(): boolean {
  const value = envValue('APP_STORE_BUILD')
  if (['1', 'true', 'yes'].includes(value)) return true
  if (['0', 'false', 'no'].includes(value)) return false
  // Not set: the iOS app is an App Store build by default.
  return isNative && nativePlatform === 'ios'
}

/** The publik test hooks: a development server, or a test build made with PUBLIK_TEST_HOOKS=1. */
export function testHooksOn(): boolean {
  return import.meta.env.DEV === true || envValue('PUBLIK_TEST_HOOKS') === '1'
}
