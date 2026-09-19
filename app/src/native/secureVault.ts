import { getLunaraNativeBridge } from './bridge'
import { isNative, nativePlatform } from './runtime'

interface LunaraNativeVaultPlugin {
  secureVaultStatus(): Promise<NativeVaultStatus>
  secureSet(options: { key: string; value: string }): Promise<void>
  secureGet(options: { key: string }): Promise<{ value: string | null }>
  secureDelete(options: { key: string }): Promise<void>
  secureClear(): Promise<void>
}

interface NativeVaultStatus {
  available: boolean
  persistence: 'keychain' | 'keystore'
  hardwareBacked: boolean
  platform: 'ios' | 'android'
}

export interface SecureVaultStatus {
  available: boolean
  persistence: 'keychain' | 'keystore' | 'memory'
  hardwareBacked: boolean
  platform: 'ios' | 'android' | 'web'
}

export const SECURE_SECRET_KEYS = {
  openAiApiKey: 'openai-api-key',
  anthropicApiKey: 'anthropic-api-key',
  /** The pk_ key minted by POST /installs; publik API's only secret on this phone. */
  publikApiKey: 'publik-api-key',
} as const

const LunaraNative = getLunaraNativeBridge<LunaraNativeVaultPlugin>()
const browserSecrets = new Map<string, string>()

function assertValidKey(key: string): void {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(key)) {
    throw new Error('Secret keys may only contain letters, numbers, dots, dashes, and underscores.')
  }
}

export async function secureVaultStatus(): Promise<SecureVaultStatus> {
  if (!isNative) {
    return {
      available: true,
      persistence: 'memory',
      hardwareBacked: false,
      platform: 'web',
    }
  }

  return LunaraNative.secureVaultStatus()
}

export async function setSecureSecret(key: string, value: string): Promise<void> {
  assertValidKey(key)
  if (typeof value !== 'string') throw new Error('Secret value must be a string.')

  if (!isNative) {
    browserSecrets.set(key, value)
    return
  }

  await LunaraNative.secureSet({ key, value })
}

export async function getSecureSecret(key: string): Promise<string | null> {
  assertValidKey(key)
  if (!isNative) return browserSecrets.get(key) ?? null
  return (await LunaraNative.secureGet({ key })).value
}

export async function deleteSecureSecret(key: string): Promise<void> {
  assertValidKey(key)
  if (!isNative) {
    browserSecrets.delete(key)
    return
  }

  await LunaraNative.secureDelete({ key })
}

export async function clearSecureSecrets(): Promise<void> {
  if (!isNative) {
    browserSecrets.clear()
    return
  }

  await LunaraNative.secureClear()
}

export function currentVaultPlatform(): SecureVaultStatus['platform'] {
  return isNative && (nativePlatform === 'ios' || nativePlatform === 'android')
    ? nativePlatform
    : 'web'
}
