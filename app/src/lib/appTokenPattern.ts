/**
 * The token shape the publik gateway mints for Lunara: `pat_lunara_` and 32
 * lower-case letters and digits. publikBuild.ts and vite.config.ts (the
 * `vite build --mode native` check) both use this one pattern.
 */
export const APP_TOKEN_PATTERN = /^pat_lunara_[a-z0-9]{32}$/
