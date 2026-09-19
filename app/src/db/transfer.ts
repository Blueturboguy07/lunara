import { decryptJSON, encryptJSON, type Envelope } from '../crypto/vault'
import { db, SK, type ContentBookmark, type DailyLog, type Setting } from './schema'

/**
 * Settings that must never leave the device. The publik install id is the
 * handle for one phone's key: restoring it on a second phone would replay the
 * first phone's install and get no key. The claim link and state go with it.
 */
export const SECRET_KEYS: string[] = [
  SK.pinSalt,
  SK.pinHash,
  SK.aiKey,
  SK.publikInstallId,
  SK.publikClaimUrl,
  SK.publikClaimState,
  SK.publikCardSeen,
]

export interface ExportPayload {
  app: 'lunara'
  v: 1
  exportedAt: string
  dailyLogs: DailyLog[]
  settings: Setting[]
  contentBookmarks: ContentBookmark[]
}

export async function collectExport(): Promise<ExportPayload> {
  const [dailyLogs, settings, contentBookmarks] = await Promise.all([
    db.dailyLogs.toArray(),
    db.settings.toArray(),
    db.contentBookmarks.toArray(),
  ])
  return {
    app: 'lunara',
    v: 1,
    exportedAt: new Date().toISOString(),
    dailyLogs,
    settings: settings.filter((s) => !SECRET_KEYS.includes(s.key)),
    contentBookmarks,
  }
}

export async function applyImport(payload: ExportPayload): Promise<number> {
  if (payload.app !== 'lunara' || payload.v !== 1) throw new Error('Not a Lunara export file')
  await db.transaction('rw', db.dailyLogs, db.settings, db.contentBookmarks, async () => {
    await db.dailyLogs.bulkPut(payload.dailyLogs)
    await db.settings.bulkPut(payload.settings.filter((s) => !SECRET_KEYS.includes(s.key)))
    await db.contentBookmarks.bulkPut(payload.contentBookmarks)
  })
  return payload.dailyLogs.length
}

export async function encryptedExport(passphrase: string): Promise<Envelope> {
  return encryptJSON(await collectExport(), passphrase)
}

export async function decryptImport(env: Envelope, passphrase: string): Promise<number> {
  return applyImport(await decryptJSON<ExportPayload>(env, passphrase))
}

/** Share-sheet first (iOS → Save to Files → iCloud Drive), download fallback. */
export async function shareOrDownload(filename: string, contents: string): Promise<void> {
  const blob = new Blob([contents], { type: 'application/json' })
  const file = new File([blob], filename, { type: 'application/json' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return
    } catch {
      // fall through to download (user cancel or share failure)
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
