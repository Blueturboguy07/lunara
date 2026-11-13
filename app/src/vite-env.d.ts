/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The publik module's test hook: another publik to talk to (src/lib/publik.ts). */
  readonly PUBLIK_API_BASE_URL?: string
  /** "required" (default) or "optional" (src/lib/buildFlags.ts). */
  readonly PUBLIK_GATE_MODE?: string
  /** "1" for an App Store build (src/lib/buildFlags.ts). */
  readonly APP_STORE_BUILD?: string
  readonly VITE_PUBLIK_APP_TOKEN?: string
}
