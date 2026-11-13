import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isPublikAppToken, PUBLIK_APP_TOKEN_PLACEHOLDER, PUBLIK_BUILD, publikBuildAvailable } from './publikBuild'

describe('publik build constant', () => {
  it('mirrors package.json and the publik module so the gateway attributes usage to the right app version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
    const moduleSource = readFileSync(new URL('./publik.ts', import.meta.url), 'utf8')
    expect(PUBLIK_BUILD.appVersion).toBe(pkg.version)
    // The module keeps the slug and the version as literals: the publik scan reads `APP_SLUG = "lunara"`.
    expect(moduleSource).toContain(`export const APP_VERSION = "${pkg.version}"`)
    expect(moduleSource).toContain('export const APP_SLUG = "lunara"')
    expect(PUBLIK_BUILD.appSlug).toBe('lunara')
    expect(PUBLIK_BUILD.baseUrl).toBe('https://publikhq.com/api/v1')
    expect(PUBLIK_BUILD.dialects).toEqual(['responses'])
  })

  it('recognises only a minted pat_lunara_<32 base36> token', () => {
    expect(isPublikAppToken('pat_lunara_' + 'a1'.repeat(16))).toBe(true)
    expect(isPublikAppToken('pat_lunara_REPLACE_ME')).toBe(false)
    expect(isPublikAppToken('pat_cue_' + 'a'.repeat(32))).toBe(false)
    expect(isPublikAppToken('pat_lunara_' + 'A'.repeat(32))).toBe(false)
    expect(isPublikAppToken('')).toBe(false)
  })

  it('is the committed token or a token the gateway would accept — never anything else', () => {
    // The publik-side mint script wrote the minted token into this file; a
    // half-edited value would compile and silently disable publik.
    expect(PUBLIK_BUILD.appToken === PUBLIK_APP_TOKEN_PLACEHOLDER || isPublikAppToken(PUBLIK_BUILD.appToken)).toBe(true)
    expect(publikBuildAvailable()).toBe(isPublikAppToken(PUBLIK_BUILD.appToken))
  })
})
