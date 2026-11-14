import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isPublikAppToken, PUBLIK_BUILD, PUBLIK_DEV_APP_TOKEN, publikBuildAvailable } from './publikBuild'

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

  it('the committed dev token is a token the gateway accepts, and the build uses it only without VITE_PUBLIK_APP_TOKEN', () => {
    // A half-edited value would compile and silently disable publik.
    expect(isPublikAppToken(PUBLIK_DEV_APP_TOKEN)).toBe(true)
    expect(isPublikAppToken(PUBLIK_BUILD.appToken)).toBe(true)
    expect(publikBuildAvailable()).toBe(true)
    if (!import.meta.env.VITE_PUBLIK_APP_TOKEN) expect(PUBLIK_BUILD.appToken).toBe(PUBLIK_DEV_APP_TOKEN)
  })
})
