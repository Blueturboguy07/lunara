import { describe, expect, it } from 'vitest'
import { buildInfo, buildProblems } from './buildCheck'

const TOKEN = 'pat_lunara_' + 'a1'.repeat(16)

describe('vite build refuses a bundle that must not ship', () => {
  it('--mode native: a token that is not pat_lunara_ + 32 letters and digits stops the build', () => {
    expect(buildProblems('native', { VITE_PUBLIK_APP_TOKEN: TOKEN })).toEqual([])
    expect(buildProblems('native', {})).toEqual([]) // the dev token of src/lib/publikBuild.ts
    expect(buildProblems('native', { VITE_PUBLIK_APP_TOKEN: 'pat_lunara_REPLACE_ME' })).toHaveLength(1)
    expect(buildProblems('native', { VITE_PUBLIK_APP_TOKEN: 'pk_live_x' })).toHaveLength(1)
  })

  it('a release build (LUNARA_RELEASE=1) needs the token and has no test hooks', () => {
    expect(buildProblems('native', { LUNARA_RELEASE: '1', VITE_PUBLIK_APP_TOKEN: TOKEN })).toEqual([])
    expect(buildProblems('native', { LUNARA_RELEASE: '1' })[0]).toMatch(/needs VITE_PUBLIK_APP_TOKEN/)
    expect(buildProblems('native', { LUNARA_RELEASE: '1', VITE_PUBLIK_APP_TOKEN: TOKEN, PUBLIK_TEST_HOOKS: '1' })[0]).toMatch(/PUBLIK_TEST_HOOKS/)
  })

  it('a release build keeps the publik gate: PUBLIK_GATE_MODE=optional stops it', () => {
    for (const value of ['optional', ' Optional ', 'OPTIONAL']) {
      expect(buildProblems('native', { LUNARA_RELEASE: '1', VITE_PUBLIK_APP_TOKEN: TOKEN, PUBLIK_GATE_MODE: value })).toEqual([
        'A release build needs the publik gate. Remove PUBLIK_GATE_MODE=optional (it is for test builds).',
      ])
    }
    expect(buildProblems('native', { LUNARA_RELEASE: '1', VITE_PUBLIK_APP_TOKEN: TOKEN, PUBLIK_GATE_MODE: 'required' })).toEqual([])
    // A test build may open with no wall.
    expect(buildProblems('native', { VITE_PUBLIK_APP_TOKEN: TOKEN, PUBLIK_GATE_MODE: 'optional', PUBLIK_TEST_HOOKS: '1' })).toEqual([])
  })

  it('PUBLIK_API_BASE_URL needs PUBLIK_TEST_HOOKS=1 in any build', () => {
    expect(buildProblems('native', { PUBLIK_API_BASE_URL: 'http://127.0.0.1:8787' })[0]).toMatch(/test hook/)
    expect(buildProblems('production', { PUBLIK_API_BASE_URL: 'http://127.0.0.1:8787' })[0]).toMatch(/test hook/)
    expect(buildProblems('native', { PUBLIK_API_BASE_URL: 'http://127.0.0.1:8787', PUBLIK_TEST_HOOKS: '1' })).toEqual([])
  })

  it('lunara-build.json tells the Xcode Release check what the bundle holds', () => {
    expect(JSON.parse(buildInfo('native', { VITE_PUBLIK_APP_TOKEN: TOKEN }))).toEqual({ mode: 'native', testHooks: false, claudeTokenOnIos: false, appToken: 'env', gateMode: 'required' })
    expect(JSON.parse(buildInfo('native', { PUBLIK_TEST_HOOKS: '1', APP_STORE_BUILD: '0', PUBLIK_GATE_MODE: 'optional' }))).toEqual({
      mode: 'native',
      testHooks: true,
      claudeTokenOnIos: true,
      appToken: 'dev',
      gateMode: 'optional',
    })
    // The shell check greps these exact strings.
    expect(buildInfo('native', { VITE_PUBLIK_APP_TOKEN: TOKEN })).toContain('"testHooks":false')
    expect(buildInfo('native', { VITE_PUBLIK_APP_TOKEN: TOKEN })).toContain('"claudeTokenOnIos":false')
    expect(buildInfo('native', { VITE_PUBLIK_APP_TOKEN: TOKEN })).toContain('"appToken":"env"')
    expect(buildInfo('native', { VITE_PUBLIK_APP_TOKEN: TOKEN })).toContain('"gateMode":"required"')
  })
})
