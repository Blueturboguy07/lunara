import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The wall's own promise: a failure is never cached, and a sign-out makes the wall ask again. */

vi.mock('../native/runtime', () => ({ isNative: false, nativePlatform: 'web' }))
vi.mock('@capacitor/browser', () => ({ Browser: { open: async () => undefined } }))

const gate = vi.hoisted(() => ({ results: [] as Array<'fail' | 'pass'>, calls: 0 }))
vi.mock('../lib/publik', () => ({
  applyChoiceToAi: async () => undefined,
  ensureSignedIn: async () => {
    gate.calls++
    if (gate.results.shift() === 'fail') throw new Error('The database is closed.')
    return { key: 'pk_live_x', wallet: null, choice: null, chosenNow: false, offline: false }
  },
  gateScreen: (id: string, _w: unknown, note: string | null, message?: string) => ({
    id,
    title: 'Sign in with publik',
    body: message ?? 'publik is not reachable. Check your connection.',
    note,
    buttons: [{ action: 'retry', label: 'Retry' }],
  }),
  needsSignInOnDemand: async () => false,
  onPublikSignOut: () => () => undefined,
  openWithoutWall: async () => undefined,
  signInOnDemand: async () => null,
}))

import { forgetWall, passWall, startWall } from './PublikGate'

beforeEach(() => {
  forgetWall()
  gate.results = []
  gate.calls = 0
})

describe('the wall never freezes', () => {
  it('a failed gate is not cached: "not reachable" with Retry shows, and Retry runs the gate again', async () => {
    gate.results = ['fail', 'pass']
    const shown: Array<{ id: string; body: string }> = []
    const result = await passWall(async (screen) => {
      shown.push({ id: screen.id, body: screen.body })
      return 'retry'
    })
    expect(result).toMatchObject({ key: 'pk_live_x' })
    expect(shown).toEqual([{ id: 'unreachable', body: 'The database is closed.' }])
    expect(gate.calls).toBe(2)
  })

  it('startWall() forgets a failed promise by itself', async () => {
    gate.results = ['fail', 'pass']
    await expect(startWall()).rejects.toThrow('The database is closed.')
    await expect(startWall()).resolves.toMatchObject({ key: 'pk_live_x' })
    expect(gate.calls).toBe(2)
  })

  it('a passed wall is shared; after a sign-out (forgetWall) the gate runs again', async () => {
    await passWall(async () => 'retry')
    await passWall(async () => 'retry')
    expect(gate.calls).toBe(1)
    forgetWall()
    await passWall(async () => 'retry')
    expect(gate.calls).toBe(2)
  })
})
