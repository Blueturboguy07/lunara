import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ isNative: true, nativePlatform: 'ios' as string }))
vi.mock('../native/runtime', () => ({
  get isNative() {
    return runtime.isNative
  },
  get nativePlatform() {
    return runtime.nativePlatform
  },
}))

const bridge = vi.hoisted(() => ({ calls: 0, answer: (): Promise<{ countryCode?: string | null }> => Promise.resolve({ countryCode: 'USA' }) }))
vi.mock('../native/bridge', () => ({
  getLunaraNativeBridge: () => ({
    appStoreStorefront: () => {
      bridge.calls += 1
      return bridge.answer()
    },
  }),
}))

async function freshStorefront() {
  vi.resetModules()
  return import('./storefront')
}

beforeEach(() => {
  runtime.isNative = true
  runtime.nativePlatform = 'ios'
  bridge.calls = 0
  bridge.answer = () => Promise.resolve({ countryCode: 'USA' })
})

describe('purchase links follow the App Store storefront', () => {
  it('the US storefront allows purchase links', async () => {
    const s = await freshStorefront()
    expect(await s.loadStorefront()).toBe('USA')
    expect(s.purchaseLinksAllowed()).toBe(true)
  })

  it('every other storefront: no purchase links', async () => {
    for (const code of ['CAN', 'GBR', 'DEU', 'IND', 'BRA', 'JPN']) {
      bridge.answer = () => Promise.resolve({ countryCode: code })
      const s = await freshStorefront()
      expect(await s.loadStorefront()).toBe(code)
      expect(s.purchaseLinksAllowed()).toBe(false)
    }
  })

  it('unknown storefront: no purchase links (no answer, an empty answer, an error, Android, a browser)', async () => {
    for (const answer of [() => Promise.resolve({}), () => Promise.resolve({ countryCode: null }), () => Promise.resolve({ countryCode: '  ' }), () => Promise.reject(new Error('no StoreKit'))]) {
      bridge.answer = answer
      const s = await freshStorefront()
      expect(await s.loadStorefront()).toBeNull()
      expect(s.purchaseLinksAllowed()).toBe(false)
    }
    runtime.nativePlatform = 'android'
    let s = await freshStorefront()
    expect(await s.loadStorefront()).toBeNull()
    expect(s.purchaseLinksAllowed()).toBe(false)
    runtime.isNative = false
    runtime.nativePlatform = 'web'
    s = await freshStorefront()
    expect(await s.loadStorefront()).toBeNull()
    expect(s.purchaseLinksAllowed()).toBe(false)
    expect(bridge.calls).toBe(4) // Android and the browser never ask StoreKit
  })

  it('no links until the storefront is read; the storefront is read once per launch', async () => {
    const s = await freshStorefront()
    expect(s.purchaseLinksAllowed()).toBe(false)
    await Promise.all([s.loadStorefront(), s.loadStorefront()])
    await s.loadStorefront()
    expect(bridge.calls).toBe(1)
    expect(s.purchaseLinksAllowed()).toBe(true)
  })

  it('a lower-case answer is read as the same storefront', async () => {
    bridge.answer = () => Promise.resolve({ countryCode: ' usa ' })
    const s = await freshStorefront()
    expect(await s.loadStorefront()).toBe('USA')
    expect(s.purchaseLinksAllowed()).toBe(true)
  })

  it('the text outside the US names no price, no link and no button', async () => {
    const s = await freshStorefront()
    expect(s.NO_LINK_PLAN_TEXT).toBe('To get a plan, search for "publik" on Google.')
    for (const text of [s.NO_LINK_PLAN_TEXT]) {
      expect(text).not.toMatch(/\$|https?:|publikhq\.com|top up|buy|price/i)
      expect(text).not.toContain('Get a plan') // the US button label
    }
  })
})
