/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The publik module's test hook: another publik to talk to (src/lib/publik.ts). */
  readonly PUBLIK_API_BASE_URL?: string
  readonly VITE_PUBLIK_APP_TOKEN?: string
}
