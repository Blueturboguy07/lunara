import { getLunaraNativeBridge } from '../native/bridge'
import { isNative, nativePlatform } from '../native/runtime'

/**
 * Purchase links follow the App Store storefront (founder decision, Nov 14 2026).
 *
 *   US storefront ("USA"): "Get a plan", the link and top-up buttons, and
 *   prices, as built.
 *   Every other storefront, or an unknown one (StoreKit gave no answer, the
 *   Android app, a browser build): no purchase link, no purchase button, no
 *   price. The app shows NO_LINK_PLAN_TEXT instead.
 *
 * "Connect your plan" and "Use my own key" stay on every storefront. Until the
 * storefront is read, the answer is "no links" (the safe side).
 */
export { NO_LINK_PLAN_TEXT } from './publikApi'

/** ISO 3166-1 alpha-3, as StoreKit gives it. */
const US_STOREFRONT = 'USA'

let storefront: string | null = null
let reading: Promise<string | null> | null = null

interface StorefrontBridge {
  appStoreStorefront(): Promise<{ countryCode?: string | null }>
}

async function readStorefront(): Promise<string | null> {
  if (!isNative || nativePlatform !== 'ios') return null
  try {
    const { countryCode } = await getLunaraNativeBridge<StorefrontBridge>().appStoreStorefront()
    return typeof countryCode === 'string' && countryCode.trim() ? countryCode.trim().toUpperCase() : null
  } catch {
    return null
  }
}

/** Reads the App Store storefront once per launch. Never throws. */
export function loadStorefront(): Promise<string | null> {
  if (!reading) {
    reading = readStorefront().then((code) => {
      storefront = code
      return code
    })
  }
  return reading
}

/** True only on the US App Store storefront. */
export function purchaseLinksAllowed(): boolean {
  return storefront === US_STOREFRONT
}

export function _setStorefrontForTests(code: string | null): void {
  storefront = code
  reading = Promise.resolve(code)
}
