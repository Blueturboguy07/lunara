import { describe, expect, it } from 'vitest'
import { SK } from './schema'
import { SECRET_KEYS } from './transfer'

describe('backup export guard', () => {
  it('keeps the device-bound publik install identity out of every export', () => {
    for (const key of [SK.publikInstallId, SK.publikClaimUrl, SK.publikClaimState, SK.publikCardSeen]) {
      expect(SECRET_KEYS).toContain(key)
    }
    // Consent records and the non-secret endpoint may travel, like aiConsent does.
    for (const key of [SK.publikDisclosureVersion, SK.publikBaseUrl, SK.publikModels, SK.aiConsent]) {
      expect(SECRET_KEYS).not.toContain(key)
    }
  })

  it('still excludes the PIN material and the legacy plaintext key', () => {
    expect(SECRET_KEYS).toEqual(expect.arrayContaining([SK.pinSalt, SK.pinHash, SK.aiKey]))
  })
})
