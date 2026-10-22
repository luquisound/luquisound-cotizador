import { createHash } from 'node:crypto'
import { parseCatalogImport } from '../features/quotation/catalog.ts'
import { makeObservationSnapshot, type ObservationSnapshot } from './instaler-observation.ts'
import { buildInstalerCatalogCandidate, parseInstalerCatalogPolicy } from './instaler-catalog.ts'
import { InstalerCatalogStoreError, type InstalerCatalogStore } from './instaler-catalog-store.ts'

export type InstalerPublicationErrorCode = 'storage' | 'conflict' | 'candidate-invalid' | 'policy-invalid' | 'stale-observation'

export class InstalerPublicationError extends Error {
  readonly code: InstalerPublicationErrorCode

  constructor(code: InstalerPublicationErrorCode) {
    super(`Instaler catalogue publication failed (${code}).`)
    this.name = 'InstalerPublicationError'
    this.code = code
  }
}

export interface InstalerPublicationResult {
  status: 'published' | 'unchanged'
  readAt: string
  items: number
  blocked: number
  absent: number
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function storageError(error: unknown): InstalerPublicationError {
  return new InstalerPublicationError(error instanceof InstalerCatalogStoreError && error.code === 'conflict' ? 'conflict' : 'storage')
}

/** Publish only an already validated reading; this operation never contacts Drive. */
export async function publishInstalerCatalog(
  snapshot: ObservationSnapshot, store: InstalerCatalogStore, now: Date = new Date(),
): Promise<InstalerPublicationResult> {
  let reading: ObservationSnapshot
  try {
    reading = makeObservationSnapshot(snapshot.table, { modifiedTime: snapshot.modifiedTime }, snapshot.readAt)
    if (!Number.isFinite(now.getTime()) || Date.parse(reading.readAt) > now.getTime()) throw new Error('Future reading')
  } catch { throw new InstalerPublicationError('candidate-invalid') }

  let loaded: Awaited<ReturnType<InstalerCatalogStore['read']>>
  let policyText: string | null
  try {
    loaded = await store.read()
    policyText = await store.readPolicy()
  } catch (error) { throw storageError(error) }
  let current: ReturnType<typeof parseCatalogImport>
  try { current = parseCatalogImport(loaded.text) }
  catch { throw new InstalerPublicationError('storage') }
  const previous = current.instalerObservation
  if (previous && (reading.readAt < previous.readAt
    || (reading.readAt === previous.readAt && reading.table.source.checksum !== previous.checksum))) {
    throw new InstalerPublicationError('stale-observation')
  }
  let policy: ReturnType<typeof parseInstalerCatalogPolicy> | undefined
  try { policy = policyText === null ? undefined : parseInstalerCatalogPolicy(JSON.parse(policyText)) }
  catch { throw new InstalerPublicationError('policy-invalid') }
  let candidate: ReturnType<typeof buildInstalerCatalogCandidate>
  try { candidate = buildInstalerCatalogCandidate(reading, current, policy) }
  catch { throw new InstalerPublicationError('candidate-invalid') }
  const result = {
    readAt: reading.readAt, items: candidate.summary.items,
    blocked: candidate.summary.blocked, absent: candidate.summary.absent,
  }
  if (!candidate.changed) return { status: 'unchanged', ...result }
  const text = JSON.stringify(candidate.document)
  try {
    // Keep the exact previous bytes recoverable before attempting the active CAS.
    await store.archive(loaded.text)
    if (await store.readPolicy() !== policyText) throw new InstalerPublicationError('conflict')
    await store.write(text, loaded.etag)
  } catch (error) {
    if (error instanceof InstalerPublicationError) throw error
    // A timeout may occur after the conditional write was committed. Never retry blindly.
    try {
      const actual = await store.read()
      if (digest(actual.text) === digest(text)) return { status: 'published', ...result }
    } catch { /* Preserve the original classified failure. */ }
    throw storageError(error)
  }
  try {
    if (digest((await store.read()).text) !== digest(text)) throw new InstalerPublicationError('conflict')
  } catch (error) {
    if (error instanceof InstalerPublicationError) throw error
    throw storageError(error)
  }
  return { status: 'published', ...result }
}

/** Restore reviewed bytes only against the active version the operator inspected. */
export async function restoreInstalerCatalog(
  text: string, expectedEtag: string, store: InstalerCatalogStore,
): Promise<void> {
  try {
    const { validateSharedCatalogDocument, SHARED_CATALOG_MAX_BYTES } = await import('../features/quotation/shared-catalog.ts')
    validateSharedCatalogDocument(parseCatalogImport(text))
    if (Buffer.byteLength(text) > SHARED_CATALOG_MAX_BYTES) throw new Error('Oversized catalogue')
  } catch { throw new InstalerPublicationError('candidate-invalid') }
  try {
    let current: { text: string; etag: string }
    let corrupt = false
    try { current = await store.read() }
    catch {
      if (!store.readForRecovery || !store.quarantine) throw new InstalerPublicationError('storage')
      current = await store.readForRecovery()
      try {
        const { validateSharedCatalogDocument } = await import('../features/quotation/shared-catalog.ts')
        validateSharedCatalogDocument(parseCatalogImport(current.text))
      } catch { corrupt = true }
    }
    if (current.etag !== expectedEtag) throw new InstalerPublicationError('conflict')
    if (corrupt) await store.quarantine!(current.text)
    else await store.archive(current.text)
    await store.write(text, expectedEtag)
  } catch (error) {
    if (error instanceof InstalerPublicationError) throw error
    try { if (digest((await store.read()).text) === digest(text)) return }
    catch { /* An unconfirmed restore stays a failure. */ }
    throw storageError(error)
  }
  try {
    if (digest((await store.read()).text) !== digest(text)) throw new InstalerPublicationError('conflict')
  } catch (error) {
    if (error instanceof InstalerPublicationError) throw error
    throw storageError(error)
  }
}
