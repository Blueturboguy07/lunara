/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The publik module's test hook: another publik to talk to (src/lib/publik.ts). Needs PUBLIK_TEST_HOOKS=1 outside `pnpm dev`. */
  readonly PUBLIK_API_BASE_URL?: string
  /** "required" (default) or "optional" (src/lib/buildFlags.ts). */
  readonly PUBLIK_GATE_MODE?: string
  /** "1" or "0"; not set = on in the iOS app only (src/lib/buildFlags.ts). */
  readonly APP_STORE_BUILD?: string
  /** "1" in a test build: the publik test hooks work (src/lib/buildFlags.ts). */
  readonly PUBLIK_TEST_HOOKS?: string
  readonly VITE_PUBLIK_APP_TOKEN?: string
}
