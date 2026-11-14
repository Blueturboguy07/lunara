import { APP_TOKEN_PATTERN } from './appTokenPattern'

/**
 * Build-time identity of this Lunara build on publik API.
 *
 * `appToken` names the app to the gateway: POST /installs attributes an install
 * to Lunara and rate-limits minting by it. It holds no balance and cannot read
 * anything. The pk_ key minted from it is the secret, and that lives in the
 * native vault (secureVault.ts).
 *
 * Where the token comes from:
 *   - VITE_PUBLIK_APP_TOKEN at build time: release.yml and the CI test builds
 *     pass the PUBLIK_APP_TOKEN secret; a local build reads it from
 *     `app/.env.native` (`--mode native`) or `app/.env.production` (both gitignored).
 *     vite.config.ts fails `vite build --mode native` when this value is not
 *     pat_lunara_ + 32 letters and digits, and fails a release build
 *     (LUNARA_RELEASE=1) when it is missing.
 *   - PUBLIK_DEV_APP_TOKEN below, only when that value is not set: a real,
 *     minted token, committed as the fallback for development and test builds.
 *     A release never uses it: release.yml always passes the secret, and an
 *     Xcode Release archive refuses a bundle built on it
 *     (ios/App/scripts/check-release-build.sh).
 */
export const PUBLIK_DEV_APP_TOKEN = 'pat_lunara_x49sudxqfhc9s0vgssy48apq9r8eqiex'

const envToken = (import.meta.env.VITE_PUBLIK_APP_TOKEN as string | undefined)?.trim()

export const PUBLIK_BUILD = {
  appSlug: 'lunara',
  /** Mirrors app/package.json `version`; publikBuild.test.ts pins them equal. */
  appVersion: '0.2.1',
  appToken: envToken || PUBLIK_DEV_APP_TOKEN,
  /** Compiled default; the `base_url` field of POST /installs wins over it (CONTRACT §1). */
  baseUrl: 'https://publikhq.com/api/v1',
  /**
   * Recorded by the gateway with the install; bump when the disclosure copy changes.
   * 3: a new phone starts at $0.00; linking a publik account gives $0.05 of free use, once.
   */
  disclosureVersion: 3,
  dialects: ['responses'] as const,
} as const

export function isPublikAppToken(token: string): boolean {
  return APP_TOKEN_PATTERN.test(token)
}

/** False for a malformed token: such a build never offers publik API (and `--mode native` does not build). */
export function publikBuildAvailable(): boolean {
  return isPublikAppToken(PUBLIK_BUILD.appToken)
}
