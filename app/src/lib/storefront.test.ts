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

  it('storefront unknown (the simulator answers none): no "Add a plan or pack" button anywhere; the Google sentence instead', async () => {
    bridge.answer = () => Promise.resolve({ countryCode: null })
    const s = await freshStorefront()
    await s.loadStorefront()
    const allowed = s.purchaseLinksAllowed()
    expect(allowed).toBe(false)
    const api = await import('./publikApi')
    const needsCredit = { kind: 'needs_credit' as const, link: 'https://publikhq.com/wallet?top_up=1' }
    expect(api.publikErrorLinkLabel(needsCredit, 'claimed', allowed)).toBeNull()
    expect(api.publikErrorLinkLabel({ kind: 'rate_limited', link: 'https://publikhq.com/wallet' }, 'claimed', allowed)).toBeNull()
    expect(api.notLinkedText(allowed)).toContain('To get a plan, search for "publik" on Google.')
    expect(api.planLimitText(null, allowed)).toContain('To get a plan, search for "publik" on Google.')
    expect(api.planLimitText(null, allowed)).not.toMatch(/Add a plan|link below/)
    // The US storefront keeps the button and opens the normal site.
    expect(api.publikErrorLinkLabel(needsCredit, 'claimed', true)).toBe('Add a plan or pack')
  })
})
