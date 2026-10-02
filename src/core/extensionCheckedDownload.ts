export interface CheckedExtensionDownload {
  path: string
  version: string
  bytes: number
  compatibility: {
    runtimeVersion: string
    manifest: Record<string, unknown>
    loadTest: 'passed'
    functionalityTest: 'not-run'
    source: 'registered-package' | 'chrome-web-store-crx'
    sourceId: string
    sha256: string
  }
}

/** An older backend's download-only response must never look like a passed test. */
export function checkedExtensionDownload(value: unknown): CheckedExtensionDownload {
  const result = value as Partial<CheckedExtensionDownload> | null
  const check = result?.compatibility
  if (!result || typeof result.path !== 'string' || !result.path || typeof result.version !== 'string'
    || typeof result.bytes !== 'number' || !Number.isSafeInteger(result.bytes) || result.bytes <= 0
    || check?.loadTest !== 'passed' || check.functionalityTest !== 'not-run'
    || (check.source !== 'registered-package' && check.source !== 'chrome-web-store-crx')
    || typeof check.sourceId !== 'string' || !check.sourceId
    || typeof check.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(check.sha256)
    || typeof check.runtimeVersion !== 'string' || !/^\d+(?:\.\d+){0,3}$/.test(check.runtimeVersion)
    || !check.manifest || typeof check.manifest !== 'object' || Array.isArray(check.manifest)
    || check.manifest.version !== result.version) {
    throw new Error('The download did not return a completed compatibility test')
  }
  return result as CheckedExtensionDownload
}
