/**
 * Build-time identity of this Lunara build on publik API.
 *
 * `appToken` is a publishable identifier, not a secret: it names the app so
 * the gateway can attribute an install to Lunara and rate-limit minting. It
 * holds no balance and cannot read anything. The pk_ key minted from it is
 * the secret, and that lives in the native vault (secureVault.ts).
 *
 * Lunara has no binary and no CI release — the reviewed commit pinned by the
 * publik guide IS the release — so the token is committed here, in the open.
 *
 * `pat_lunara_REPLACE_ME` is a placeholder. A publik-side script
 * (`scripts/mint-app-token.mts` in the publik repo) mints the real
 * `pat_lunara_<32 base36>` token and replaces the placeholder in this file in
 * the same commit that the publik guide then pins. Until that happens, a
 * checkout compiles and tests but `publikBuildAvailable()` is false, so the
 * publik option is simply not offered — the app falls back to the two BYO
 * providers exactly as before.
 *
 * A private build can override the token without editing source:
 *   VITE_PUBLIK_APP_TOKEN=pat_lunara_… in `app/.env.native` (read by
 *   `pnpm native:sync`, which builds with `--mode native`) or in
 *   `app/.env.production` (read by `pnpm build`). Both files are gitignored.
 */
export const PUBLIK_APP_TOKEN_PLACEHOLDER = 'pat_lunara_REPLACE_ME'

const envToken = (import.meta.env.VITE_PUBLIK_APP_TOKEN as string | undefined)?.trim()

export const PUBLIK_BUILD = {
  appSlug: 'lunara',
  /** Mirrors app/package.json `version`; publikBuild.test.ts pins them equal. */
  appVersion: '0.2.0',
  appToken: envToken || PUBLIK_APP_TOKEN_PLACEHOLDER,
  /** Compiled default; the `base_url` field of POST /installs wins over it (CONTRACT §1). */
  baseUrl: 'https://publikhq.com/api/v1',
  /** Recorded by the gateway with the install; bump when the disclosure copy changes. */
  disclosureVersion: 2,
  dialects: ['responses'] as const,
} as const

/** The token shape the publik gateway mints: `pat_<slug>_<32 base36 chars>`. */
const APP_TOKEN_PATTERN = /^pat_lunara_[a-z0-9]{32}$/

export function isPublikAppToken(token: string): boolean {
  return APP_TOKEN_PATTERN.test(token)
}

/** False for the placeholder: a checkout without a minted token never offers publik. */
export function publikBuildAvailable(): boolean {
  return isPublikAppToken(PUBLIK_BUILD.appToken)
}
