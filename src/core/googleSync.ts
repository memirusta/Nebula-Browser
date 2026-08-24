import { BROWSER_SHORTCUT_BINDINGS_KEY } from './browserShortcuts'
import { LOCALE_STORAGE_KEY } from './locale'
import { NEBULA_SETTINGS_KEY } from './nebulaSettings'
import {
  LEGACY_PINNED_SHORTCUT_KEYS,
  PINNED_SHORTCUTS_KEY,
} from './pinnedShortcuts'
import { SHORTCUT_POSITIONS_KEY } from './shortcutLayout'
import { SHORTCUT_PREFERENCES_KEY } from './shortcutPreferences'
import { persistLocalStorage, removeLocalStorage } from './storageSync'
import { WIDGET_LAYOUT_KEY } from './widgets'
import {
  parsePasswordVault,
  serializePasswordVault,
  type SavedPassword,
} from './passwordVaultSchema'
import {
  decryptSyncText,
  encryptSyncText,
  type EncryptedSyncPasswordsV1,
} from './googleSyncCrypto'

export { mergeSyncedPasswords } from './googleSyncCrypto'
export type { EncryptedSyncPasswordsV1 } from './googleSyncCrypto'

export const GOOGLE_SYNC_PREFERENCES_KEY = 'nebula-google-sync-preferences-v1'
export const GOOGLE_SYNC_LAST_SUCCESS_KEY = 'nebula-google-sync-last-success-v1'
export const GOOGLE_SYNC_DEVICE_ID_KEY = 'nebula-google-sync-device-id-v1'

const SHORTCUT_FOLDERS_KEY = 'nebula-shortcut-folders-v1'
const SETTINGS_KEYS = [
  NEBULA_SETTINGS_KEY,
  LOCALE_STORAGE_KEY,
  BROWSER_SHORTCUT_BINDINGS_KEY,
  WIDGET_LAYOUT_KEY,
] as const

const BOOKMARK_KEYS = [
  SHORTCUT_PREFERENCES_KEY,
  PINNED_SHORTCUTS_KEY,
  ...LEGACY_PINNED_SHORTCUT_KEYS,
  SHORTCUT_POSITIONS_KEY,
  SHORTCUT_FOLDERS_KEY,
] as const

export interface GoogleSyncPreferences {
  settings: boolean
  bookmarks: boolean
  passwords: boolean
}

export const DEFAULT_GOOGLE_SYNC_PREFERENCES: GoogleSyncPreferences = {
  settings: true,
  bookmarks: true,
  passwords: false,
}

export interface NebulaSyncBundleV1 {
  schemaVersion: 1
  updatedAt: number
  deviceId: string
  categories: GoogleSyncPreferences
  storage: Record<string, string>
  passwords?: EncryptedSyncPasswordsV1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function loadGoogleSyncPreferences(): GoogleSyncPreferences {
  try {
    const raw = localStorage.getItem(GOOGLE_SYNC_PREFERENCES_KEY)
    if (!raw) return { ...DEFAULT_GOOGLE_SYNC_PREFERENCES }
    const parsed = JSON.parse(raw) as Partial<GoogleSyncPreferences>
    return {
      settings: parsed.settings !== false,
      bookmarks: parsed.bookmarks !== false,
      passwords: parsed.passwords === true,
    }
  } catch {
    return { ...DEFAULT_GOOGLE_SYNC_PREFERENCES }
  }
}

export function saveGoogleSyncPreferences(preferences: GoogleSyncPreferences): void {
  localStorage.setItem(GOOGLE_SYNC_PREFERENCES_KEY, JSON.stringify(preferences))
}

export function loadGoogleSyncLastSuccess(): number | null {
  const raw = localStorage.getItem(GOOGLE_SYNC_LAST_SUCCESS_KEY)
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

export function saveGoogleSyncLastSuccess(timestamp = Date.now()): void {
  localStorage.setItem(GOOGLE_SYNC_LAST_SUCCESS_KEY, String(timestamp))
}

export function getOrCreateGoogleSyncDeviceId(): string {
  const existing = localStorage.getItem(GOOGLE_SYNC_DEVICE_ID_KEY)?.trim()
  if (existing) return existing
  const id = crypto.randomUUID()
  localStorage.setItem(GOOGLE_SYNC_DEVICE_ID_KEY, id)
  return id
}

export async function encryptSyncedPasswords(
  entries: SavedPassword[],
  password: string,
): Promise<EncryptedSyncPasswordsV1> {
  return encryptSyncText(serializePasswordVault(entries), password)
}

export async function decryptSyncedPasswords(
  envelope: EncryptedSyncPasswordsV1,
  password: string,
): Promise<SavedPassword[]> {
  return parsePasswordVault(await decryptSyncText(envelope, password))
}

function collectStorageKeys(preferences: GoogleSyncPreferences): readonly string[] {
  return [
    ...(preferences.settings ? SETTINGS_KEYS : []),
    ...(preferences.bookmarks ? BOOKMARK_KEYS : []),
  ]
}

export async function buildGoogleSyncBundle(
  preferences: GoogleSyncPreferences,
  passwordEntries: SavedPassword[],
  syncPassword: string,
): Promise<NebulaSyncBundleV1> {
  const storage: Record<string, string> = {}
  for (const key of collectStorageKeys(preferences)) {
    const value = localStorage.getItem(key)
    if (value !== null) storage[key] = value
  }

  const bundle: NebulaSyncBundleV1 = {
    schemaVersion: 1,
    updatedAt: Date.now(),
    deviceId: getOrCreateGoogleSyncDeviceId(),
    categories: { ...preferences },
    storage,
  }
  if (preferences.passwords) {
    bundle.passwords = await encryptSyncedPasswords(passwordEntries, syncPassword)
  }
  return bundle
}

export function parseGoogleSyncBundle(raw: string): NebulaSyncBundleV1 {
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
    throw new Error('Unsupported Nebula sync data.')
  }
  if (
    typeof parsed.updatedAt !== 'number' ||
    !Number.isFinite(parsed.updatedAt) ||
    typeof parsed.deviceId !== 'string' ||
    !isRecord(parsed.categories) ||
    !isRecord(parsed.storage)
  ) {
    throw new Error('Nebula sync data is incomplete.')
  }
  const storage: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed.storage)) {
    if (typeof value !== 'string') throw new Error('Nebula sync storage data is invalid.')
    storage[key] = value
  }
  const categories: GoogleSyncPreferences = {
    settings: parsed.categories.settings === true,
    bookmarks: parsed.categories.bookmarks === true,
    passwords: parsed.categories.passwords === true,
  }

  let passwords: EncryptedSyncPasswordsV1 | undefined
  if (parsed.passwords !== undefined) {
    if (!isRecord(parsed.passwords)) throw new Error('Password sync data is invalid.')
    const candidate = parsed.passwords as Partial<EncryptedSyncPasswordsV1>
    if (
      candidate.version !== 1 ||
      candidate.algorithm !== 'AES-256-GCM' ||
      candidate.kdf !== 'PBKDF2-SHA256' ||
      typeof candidate.iterations !== 'number' ||
      typeof candidate.salt !== 'string' ||
      typeof candidate.iv !== 'string' ||
      typeof candidate.ciphertext !== 'string'
    ) {
      throw new Error('Password sync data is invalid.')
    }
    passwords = candidate as EncryptedSyncPasswordsV1
  }

  return {
    schemaVersion: 1,
    updatedAt: parsed.updatedAt,
    deviceId: parsed.deviceId,
    categories,
    storage,
    passwords,
  }
}


function copyCategoryStorage(
  target: Record<string, string>,
  source: Record<string, string>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    delete target[key]
    const value = source[key]
    if (typeof value === 'string') target[key] = value
  }
}

export function mergeGoogleSyncBackupBundle(
  local: NebulaSyncBundleV1,
  remote: NebulaSyncBundleV1 | null,
): NebulaSyncBundleV1 {
  if (!remote) return local

  const storage = { ...remote.storage }
  if (local.categories.settings) {
    copyCategoryStorage(storage, local.storage, SETTINGS_KEYS)
  }
  if (local.categories.bookmarks) {
    copyCategoryStorage(storage, local.storage, BOOKMARK_KEYS)
  }

  const categories: GoogleSyncPreferences = {
    settings: local.categories.settings || remote.categories.settings,
    bookmarks: local.categories.bookmarks || remote.categories.bookmarks,
    passwords: local.categories.passwords || remote.categories.passwords,
  }

  return {
    schemaVersion: 1,
    updatedAt: local.updatedAt,
    deviceId: local.deviceId,
    categories,
    storage,
    passwords: local.categories.passwords ? local.passwords : remote.passwords,
  }
}

function replaceStorageKeys(keys: readonly string[], storage: Record<string, string>): void {
  for (const key of keys) {
    const next = storage[key]
    if (typeof next === 'string') persistLocalStorage(key, next)
    else removeLocalStorage(key)
  }
}

export function applyGoogleSyncStorage(
  bundle: NebulaSyncBundleV1,
  preferences: GoogleSyncPreferences,
): void {
  if (preferences.settings && bundle.categories.settings) {
    replaceStorageKeys(SETTINGS_KEYS, bundle.storage)
  }
  if (preferences.bookmarks && bundle.categories.bookmarks) {
    replaceStorageKeys(BOOKMARK_KEYS, bundle.storage)
  }
}
