import { useEffect, useState } from 'react'
import { loadStorefront, purchaseLinksAllowed } from '../lib/storefront'

/** True only on the US App Store storefront (lib/storefront.ts). False until the storefront is read. */
export function usePurchaseLinks(): boolean {
  const [allowed, setAllowed] = useState(purchaseLinksAllowed())
  useEffect(() => {
    let alive = true
    void loadStorefront().then(() => {
      if (alive) setAllowed(purchaseLinksAllowed())
    })
    return () => {
      alive = false
    }
  }, [])
  return allowed
}
