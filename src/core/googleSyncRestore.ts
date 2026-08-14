import {
  applyGoogleSyncStorage,
  decryptSyncedPasswords,
  mergeSyncedPasswords,
  parseGoogleSyncBundle,
  saveGoogleSyncLastSuccess,
  saveGoogleSyncPreferences,
  type GoogleSyncPreferences,
  type NebulaSyncBundleV1,
} from './googleSync'
import {
  createGooglePkceRequest,
  getGoogleClientId,
} from './googleSignIn'
import {
  loadPasswordVault,
  savePasswordVault,
} from './passwordVault'
import {
  enableGoogleSyncLoopback,
  getGoogleSyncStatus,
  pullGoogleSyncData,
} from '../platform/googleSync'

export type GoogleSyncRestoreProbe =
  | {
      status: 'empty'
    }
  | {
      status: 'ready'
      bundle: NebulaSyncBundleV1
      needsPassword: boolean
    }

export async function probeGoogleSyncRestore(
  email: string,
): Promise<GoogleSyncRestoreProbe> {
  const clientId = getGoogleClientId()

  if (!clientId) {
    throw new Error('Google OAuth client is not configured.')
  }

  const status = await getGoogleSyncStatus()
  const linkedEmail = status.email?.trim()
  const needsAuthorization =
    !status.enabled ||
    Boolean(
      linkedEmail &&
      email.trim() &&
      linkedEmail.toLowerCase() !== email.trim().toLowerCase(),
    )

  // New installs already stored the offline credential during profile sign-in.
  // Keep this fallback for older installs or a changed Google account.
  if (needsAuthorization) {
    const {
      verifier,
      challenge,
      state,
    } = await createGooglePkceRequest()

    await enableGoogleSyncLoopback({
      clientId,
      codeVerifier: verifier,
      codeChallenge: challenge,
      state,
      expectedEmail: email,
    })
  }

  const cloud = await pullGoogleSyncData(clientId)

  if (!cloud) {
    return {
      status: 'empty',
    }
  }

  const bundle = parseGoogleSyncBundle(cloud.content)

  return {
    status: 'ready',
    bundle,
    needsPassword: Boolean(
      bundle.categories.passwords &&
      bundle.passwords,
    ),
  }
}

export async function applyGoogleSyncRestore(args: {
  bundle: NebulaSyncBundleV1
  preferences: GoogleSyncPreferences
  syncPassword?: string
}): Promise<number> {
  const {
    bundle,
    preferences,
    syncPassword,
  } = args

  if (
    preferences.passwords &&
    bundle.categories.passwords &&
    bundle.passwords
  ) {
    if (!syncPassword || syncPassword.length < 8) {
      throw new Error('Nebula Sync password is required.')
    }

    const remotePasswords =
      await decryptSyncedPasswords(
        bundle.passwords,
        syncPassword,
      )

    const localPasswords =
      await loadPasswordVault()

    await savePasswordVault(
      mergeSyncedPasswords(
        localPasswords,
        remotePasswords,
      ),
    )
  }

  applyGoogleSyncStorage(
    bundle,
    preferences,
  )

  saveGoogleSyncPreferences(
    preferences,
  )

  const now = Date.now()
  saveGoogleSyncLastSuccess(now)

  return now
}
