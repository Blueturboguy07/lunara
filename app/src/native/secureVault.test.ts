import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./runtime', () => ({ isNative: true, nativePlatform: 'android' }))

const bridge = vi.hoisted(() => ({
  store: new Map<string, string>(),
  readError: null as null | { code: string; message: string },
}))
vi.mock('./bridge', () => ({
  getLunaraNativeBridge: () => ({
    secureGet: async ({ key }: { key: string }) => {
      if (bridge.readError) throw Object.assign(new Error(bridge.readError.message), { code: bridge.readError.code })
      return { value: bridge.store.get(key) ?? null }
    },
    secureDelete: async ({ key }: { key: string }) => {
      bridge.store.delete(key)
    },
  }),
}))

import { getSecureSecretOrForget } from './secureVault'

beforeEach(() => {
  bridge.store.clear()
  bridge.readError = null
})

describe('an own key that the vault cannot read never locks the person out', () => {
  it('reads a key as usual', async () => {
    bridge.store.set('anthropic-api-key', 'sk-ant-api03-key')
    expect(await getSecureSecretOrForget('anthropic-api-key')).toBe('sk-ant-api03-key')
  })

  it('"Secret could not be decrypted": the item is deleted and counts as no key', async () => {
    bridge.store.set('openai-api-key', 'unreadable')
    bridge.readError = { code: 'KEYSTORE_READ_FAILED', message: 'Secret could not be decrypted.' }
    expect(await getSecureSecretOrForget('openai-api-key')).toBeNull()
    expect(bridge.store.has('openai-api-key')).toBe(false)
  })

  it('KEYCHAIN_LOCKED: the item stays and the caller sees the error', async () => {
    bridge.store.set('openai-api-key', 'sk-abc')
    bridge.readError = { code: 'KEYCHAIN_LOCKED', message: 'The phone is locked.' }
    await expect(getSecureSecretOrForget('openai-api-key')).rejects.toMatchObject({ code: 'KEYCHAIN_LOCKED' })
    expect(bridge.store.has('openai-api-key')).toBe(true)
  })
})
