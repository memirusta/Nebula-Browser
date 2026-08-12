export interface EncryptedSyncPasswordsV1 {
  version: 1
  algorithm: 'AES-256-GCM'
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  iv: string
  ciphertext: string
}

export interface SyncPasswordEntryLike {
  id: string
  url?: string
  username: string
  updatedAt: number
}

const SYNC_CRYPTO_AAD = 'NebulaSyncPasswordsV1'
const PBKDF2_ITERATIONS = 600_000
const MIN_SYNC_PASSWORD_LENGTH = 8

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function deriveSyncKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function validateSyncPassword(password: string): void {
  if (password.length < MIN_SYNC_PASSWORD_LENGTH) {
    throw new Error(`Sync password must be at least ${MIN_SYNC_PASSWORD_LENGTH} characters.`)
  }
}

export async function encryptSyncText(
  plaintext: string,
  password: string,
): Promise<EncryptedSyncPasswordsV1> {
  validateSyncPassword(password)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveSyncKey(password, salt, PBKDF2_ITERATIONS)
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(SYNC_CRYPTO_AAD),
    },
    key,
    new TextEncoder().encode(plaintext),
  )
  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  }
}

export async function decryptSyncText(
  envelope: EncryptedSyncPasswordsV1,
  password: string,
): Promise<string> {
  validateSyncPassword(password)
  if (
    envelope.version !== 1 ||
    envelope.algorithm !== 'AES-256-GCM' ||
    envelope.kdf !== 'PBKDF2-SHA256' ||
    !Number.isInteger(envelope.iterations) ||
    envelope.iterations < 100_000 ||
    envelope.iterations > 2_000_000
  ) {
    throw new Error('Unsupported password sync encryption format.')
  }
  const salt = base64ToBytes(envelope.salt)
  const iv = base64ToBytes(envelope.iv)
  if (salt.length < 16 || iv.length !== 12) {
    throw new Error('Password sync encryption metadata is invalid.')
  }
  const key = await deriveSyncKey(password, salt, envelope.iterations)
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: new TextEncoder().encode(SYNC_CRYPTO_AAD),
      },
      key,
      base64ToBytes(envelope.ciphertext),
    )
    return new TextDecoder().decode(plaintext)
  } catch (error) {
    throw new Error('Sync password is incorrect or the cloud password data is damaged.', {
      cause: error,
    })
  }
}

function passwordIdentity(entry: SyncPasswordEntryLike): string {
  return `${(entry.url ?? '').trim().toLowerCase()}\0${entry.username.trim().toLowerCase()}`
}

export function mergeSyncedPasswords<T extends SyncPasswordEntryLike>(
  local: T[],
  remote: T[],
): T[] {
  const merged = new Map<string, T>()
  for (const entry of [...local, ...remote]) {
    const key = passwordIdentity(entry)
    const previous = merged.get(key)
    if (!previous || entry.updatedAt >= previous.updatedAt) {
      merged.set(key, entry)
    }
  }
  return Array.from(merged.values()).sort((a, b) => b.updatedAt - a.updatedAt)
}
