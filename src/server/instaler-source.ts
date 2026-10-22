export const INSTALER_SOURCE_MAX_BYTES = 3 * 1024 * 1024
export const INSTALER_SOURCE_MAX_AGE_MS = 10 * 60_000

export interface InstalerSourceBinding {
  fileId: string
  expectedEmail: string
}

export interface InstalerSourceMetadata {
  id: string
  name: string
  mimeType: string
  size: string
  md5Checksum: string
  modifiedTime: string
  version: string
  capabilities: { canDownload: true }
}

export const INSTALER_SOURCE_ERROR_CODES = [
  'configuration', 'oauth', 'access', 'account-mismatch', 'source-invalid',
  'source-changed', 'network', 'rate-limited',
] as const

export type InstalerSourceErrorCode = typeof INSTALER_SOURCE_ERROR_CODES[number]

export class InstalerSourceError extends Error {
  readonly code: InstalerSourceErrorCode

  constructor(code: InstalerSourceErrorCode) {
    super(`Instaler source failed (${code}).`)
    this.name = 'InstalerSourceError'
    this.code = code
  }
}

export function validateInstalerSourceBinding(binding: InstalerSourceBinding): void {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(binding.fileId)
    || binding.expectedEmail.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(binding.expectedEmail)) {
    throw new InstalerSourceError('configuration')
  }
}
