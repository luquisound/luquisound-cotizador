import { randomUUID } from 'node:crypto'
import { prepareInstalerSnapshot, type InstalerSnapshotReview } from './instaler-snapshot.ts'
import { compareInstalerSnapshot } from './instaler-review.ts'
import {
  InstalerSourceError, INSTALER_SOURCE_MAX_AGE_MS,
  type InstalerSourceBinding, type InstalerSourceMetadata,
} from './instaler-source.ts'
import {
  InstalerObservationStoreError, MAX_OBSERVATION_BYTES, type InstalerObservationStore,
} from './instaler-observation-store.ts'

const HISTORY_LIMIT = 14
const LEASE_MS = 180_000
const MAX_ITEMS = 2000
const FAILURE_CODES = ['configuration', 'oauth', 'access', 'account-mismatch', 'source-invalid',
  'source-changed', 'network', 'rate-limited', 'storage'] as const
type FailureCode = typeof FAILURE_CODES[number]

export interface ObservationTable {
  source: { document: string; checksum: string; version: string }
  headerRow: number
  headers: unknown[]
  rows: { row: number; values: unknown[]; unit?: string; presentation?: string }[]
}

export interface ObservationSnapshot {
  readAt: string
  modifiedTime: string
  table: ObservationTable
}

interface ValueChange<T> { sku: string; before: T | null; after: T | null }

export interface ObservationDifference {
  baselineReadAt: string
  readAt: string
  prices: ValueChange<string>[]
  stock: ValueChange<number>[]
  additions: string[]
  absent: string[]
  excludedDuplicateSkus: string[]
  otherChanged: number
}

export interface ObservationSummary {
  items: number
  issues: number
  duplicateSkus: number
  priceChanges: number
  stockChanges: number
  additions: number
  absent: number
  otherChanged: number
}

export interface ObservationAttempt {
  startedAt: string
  completedAt: string
  status: 'baseline' | 'changed' | 'unchanged' | 'failed'
  summary?: ObservationSummary
  error?: FailureCode
}

export interface InstalerObservationState {
  format: 'luquisound.instaler-observation'
  version: 1
  mode: 'observe'
  publicationAllowed: false
  supplierFreshnessEstablished: false
  binding: { fileId: string; expectedEmail: string }
  current: ObservationSnapshot | null
  previous: ObservationSnapshot | null
  lastPriceChangeAt: string | null
  lastStockChangeAt: string | null
  lastDifference: ObservationDifference | null
  history: ObservationAttempt[]
  lease: { id: string; expiresAt: string } | null
}

export class InstalerObservationError extends Error {
  readonly code: 'state-invalid' | 'storage' | 'conflict'
  constructor(code: InstalerObservationError['code']) {
    super('Cannot complete the private supplier observation.')
    this.code = code
  }
}

function invalid(): never { throw new InstalerObservationError('state-invalid') }
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
function text(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !value || value.length > max) invalid()
  return value
}
function timestamp(value: unknown): string {
  const result = text(value, 40)
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) invalid()
  return result
}
function count(value: unknown, max = 100_000): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) invalid()
  return value
}
function nullableTime(value: unknown): string | null { return value === null ? null : timestamp(value) }
function normalized(value: string): string { return value.trim().replace(/\s+/g, ' ').toLowerCase() }

function parseSnapshot(value: unknown): ObservationSnapshot | null {
  if (value === null) return null
  const snapshot = record(value)
  const table = record(snapshot.table)
  const source = record(table.source)
  if (!Array.isArray(table.headers) || !Array.isArray(table.rows) || table.rows.length > 10_000) invalid()
  const result: ObservationSnapshot = {
    readAt: timestamp(snapshot.readAt), modifiedTime: text(snapshot.modifiedTime, 40),
    table: {
      source: { document: text(source.document, 500), checksum: text(source.checksum, 64), version: text(source.version) },
      headerRow: count(table.headerRow), headers: table.headers.slice(0, 5),
      rows: table.rows.map((value) => {
        const row = record(value)
        if (!Array.isArray(row.values) || row.values.length !== 5) invalid()
        return {
          row: count(row.row, 1_000_000), values: row.values.slice(),
          ...(row.unit === undefined ? {} : { unit: text(row.unit, 200) }),
          ...(row.presentation === undefined ? {} : { presentation: text(row.presentation, 200) }),
        }
      }),
    },
  }
  if (!/^[a-f0-9]{64}$/.test(result.table.source.checksum)
    || !Number.isFinite(Date.parse(result.modifiedTime))) invalid()
  try { prepareInstalerSnapshot(result.table) } catch { invalid() }
  return result
}

function parseSummary(value: unknown): ObservationSummary {
  const input = record(value)
  return {
    items: count(input.items, MAX_ITEMS), issues: count(input.issues),
    duplicateSkus: count(input.duplicateSkus, MAX_ITEMS), priceChanges: count(input.priceChanges, MAX_ITEMS),
    stockChanges: count(input.stockChanges, MAX_ITEMS), additions: count(input.additions, MAX_ITEMS),
    absent: count(input.absent, MAX_ITEMS), otherChanged: count(input.otherChanged, MAX_ITEMS),
  }
}

function parseAttempt(value: unknown): ObservationAttempt {
  const input = record(value)
  const status = input.status
  if (status !== 'baseline' && status !== 'changed' && status !== 'unchanged' && status !== 'failed') invalid()
  const result: ObservationAttempt = {
    startedAt: timestamp(input.startedAt), completedAt: timestamp(input.completedAt), status,
  }
  if (result.completedAt < result.startedAt) invalid()
  if (status === 'failed') {
    if (!FAILURE_CODES.includes(input.error as FailureCode)) invalid()
    result.error = input.error as FailureCode
  } else result.summary = parseSummary(input.summary)
  return result
}

function skuList(value: unknown, max = MAX_ITEMS): string[] {
  if (!Array.isArray(value) || value.length > max) invalid()
  return value.map((item) => text(item))
}

function parseDifference(value: unknown): ObservationDifference | null {
  if (value === null) return null
  const input = record(value)
  const changes = <T extends string | number>(raw: unknown, kind: 'string' | 'number'): ValueChange<T>[] => {
    if (!Array.isArray(raw) || raw.length > MAX_ITEMS) invalid()
    return raw.map((value) => {
      const item = record(value)
      for (const amount of [item.before, item.after]) {
        if (amount !== null && (typeof amount !== kind
          || (typeof amount === 'string' && amount.length > 500)
          || (typeof amount === 'number' && (!Number.isFinite(amount) || Math.abs(amount) > Number.MAX_SAFE_INTEGER)))) invalid()
      }
      return { sku: text(item.sku), before: item.before as T | null, after: item.after as T | null }
    })
  }
  return {
    baselineReadAt: timestamp(input.baselineReadAt), readAt: timestamp(input.readAt),
    prices: changes<string>(input.prices, 'string'), stock: changes<number>(input.stock, 'number'),
    additions: skuList(input.additions), absent: skuList(input.absent),
    excludedDuplicateSkus: skuList(input.excludedDuplicateSkus, MAX_ITEMS * 2), otherChanged: count(input.otherChanged, MAX_ITEMS),
  }
}

export function parseObservationState(value: string, binding: InstalerObservationState['binding']): InstalerObservationState {
  if (Buffer.byteLength(value) > MAX_OBSERVATION_BYTES) invalid()
  let input: Record<string, unknown>
  try { input = record(JSON.parse(value)) } catch { invalid() }
  const storedBinding = record(input.binding)
  if (input.format !== 'luquisound.instaler-observation' || input.version !== 1 || input.mode !== 'observe'
    || input.publicationAllowed !== false || input.supplierFreshnessEstablished !== false
    || storedBinding.fileId !== binding.fileId || storedBinding.expectedEmail !== binding.expectedEmail
    || !Array.isArray(input.history) || input.history.length > HISTORY_LIMIT) invalid()
  const current = parseSnapshot(input.current)
  const previous = parseSnapshot(input.previous)
  const history = input.history.map(parseAttempt)
  if ((previous && (!current || previous.readAt > current.readAt))
    || history.some((item, index) => index > 0 && item.startedAt < history[index - 1].startedAt)) invalid()
  let lease: InstalerObservationState['lease'] = null
  if (input.lease !== null) {
    const item = record(input.lease)
    lease = { id: text(item.id), expiresAt: timestamp(item.expiresAt) }
  }
  return {
    format: 'luquisound.instaler-observation', version: 1, mode: 'observe', publicationAllowed: false,
    supplierFreshnessEstablished: false, binding: { ...binding }, current, previous,
    lastPriceChangeAt: nullableTime(input.lastPriceChangeAt), lastStockChangeAt: nullableTime(input.lastStockChangeAt),
    lastDifference: parseDifference(input.lastDifference), history, lease,
  }
}

function duplicateSkus(review: InstalerSnapshotReview): string[] {
  const rows = new Set(review.issues.filter((issue) => issue.code === 'duplicate-sku').map((issue) => issue.row))
  return review.items.filter((item) => item.source?.row !== undefined && rows.has(item.source.row)).map((item) => item.sku)
}

export function compareObservations(current: ObservationSnapshot, previous: ObservationSnapshot | null): {
  summary: ObservationSummary; difference: ObservationDifference | null;
} {
  const review = prepareInstalerSnapshot(current.table)
  const baseline = previous ? prepareInstalerSnapshot(previous.table) : null
  const duplicates = [...new Map([...duplicateSkus(review), ...(baseline ? duplicateSkus(baseline) : [])]
    .map((sku) => [normalized(sku), sku])).values()]
  const excluded = new Set(duplicates.map(normalized))
  const summary: ObservationSummary = {
    items: review.items.length, issues: review.issues.length, duplicateSkus: duplicateSkus(review).length,
    priceChanges: 0, stockChanges: 0, additions: 0, absent: 0, otherChanged: 0,
  }
  if (!previous || !baseline) return { summary, difference: null }
  // The preparer retains one blocked placeholder per duplicate. Never compare its arbitrary values.
  const comparison = compareInstalerSnapshot({ ...review, items: review.items.filter((item) => !excluded.has(normalized(item.sku))) }, {
    format: 'luquisound.catalog', version: 1, items: baseline.items.filter((item) => !excluded.has(normalized(item.sku))),
  })
  const difference: ObservationDifference = {
    baselineReadAt: previous.readAt, readAt: current.readAt, prices: [], stock: [],
    additions: comparison.additions.map((item) => item.sku), absent: comparison.absentExisting.map((item) => item.sku),
    excludedDuplicateSkus: duplicates, otherChanged: 0,
  }
  for (const match of comparison.matches) {
    for (const change of match.changes) {
      if (change.field === 'listPrice.amount') {
        difference.prices.push({ sku: match.sku, before: change.before as string | null, after: change.after as string | null })
      } else if (change.field === 'stock.quantity') {
        difference.stock.push({ sku: match.sku, before: change.before as number | null, after: change.after as number | null })
      }
    }
    if (match.changes.some((change) => change.field !== 'listPrice.amount' && change.field !== 'stock.quantity')) {
      difference.otherChanged++
    }
  }
  Object.assign(summary, {
    priceChanges: difference.prices.length, stockChanges: difference.stock.length,
    additions: difference.additions.length, absent: difference.absent.length, otherChanged: difference.otherChanged,
  })
  return { summary, difference }
}

export function makeObservationSnapshot(
  table: ObservationTable, metadata: Pick<InstalerSourceMetadata, 'modifiedTime'>, readAt: string,
): ObservationSnapshot {
  return parseSnapshot({ readAt, modifiedTime: metadata.modifiedTime, table })!
}

function emptyState(binding: InstalerObservationState['binding']): InstalerObservationState {
  return {
    format: 'luquisound.instaler-observation', version: 1, mode: 'observe', publicationAllowed: false,
    supplierFreshnessEstablished: false, binding, current: null, previous: null,
    lastPriceChangeAt: null, lastStockChangeAt: null, lastDifference: null, history: [], lease: null,
  }
}

export interface ObservationResult {
  mode: 'observe'
  publicationAllowed: false
  supplierFreshnessEstablished: false
  status: ObservationAttempt['status'] | 'busy' | 'already-attempted'
  readAt?: string
  summary?: ObservationSummary
  error?: FailureCode
}

export async function runInstalerObservation(
  config: InstalerSourceBinding,
  store: InstalerObservationStore,
  read: () => Promise<ObservationSnapshot>,
  now: () => Date = () => new Date(),
): Promise<ObservationResult> {
  const startedAt = now().toISOString()
  const binding = { fileId: config.fileId, expectedEmail: config.expectedEmail.trim().toLowerCase() }
  const resultBase = { mode: 'observe' as const, publicationAllowed: false as const, supplierFreshnessEstablished: false as const }
  let loaded: Awaited<ReturnType<InstalerObservationStore['read']>>
  try { loaded = await store.read() } catch { throw new InstalerObservationError('storage') }
  const state = loaded ? parseObservationState(loaded.text, binding) : emptyState(binding)
  if (state.lease && state.lease.expiresAt > startedAt) return { ...resultBase, status: 'busy' }
  if (state.history.some((item) => item.startedAt.slice(0, 10) === startedAt.slice(0, 10))) {
    return { ...resultBase, status: 'already-attempted' }
  }
  if (state.current && state.current.readAt > startedAt) throw new InstalerObservationError('state-invalid')
  const claimed = { ...state, lease: { id: randomUUID(), expiresAt: new Date(Date.parse(startedAt) + LEASE_MS).toISOString() } }
  let etag: string
  try { etag = await store.write(JSON.stringify(claimed), loaded?.etag ?? null) } catch (error) {
    if (error instanceof InstalerObservationStoreError && error.code === 'conflict') {
      return { ...resultBase, status: 'busy' }
    }
    throw new InstalerObservationError('storage')
  }
  let next: InstalerObservationState
  let result: ObservationResult
  try {
    const snapshot = parseSnapshot(await read())!
    const completedAt = now().toISOString()
    const readTime = Date.parse(snapshot.readAt)
    // Apps Script downloads before posting; receipt must not invent a newer source reading.
    if (readTime < Date.parse(startedAt) - INSTALER_SOURCE_MAX_AGE_MS || snapshot.readAt > completedAt
      || (state.current && snapshot.readAt < state.current.readAt)) throw new Error('Invalid observation time.')
    const { summary, difference } = compareObservations(snapshot, state.current)
    const changed = summary.priceChanges + summary.stockChanges + summary.additions + summary.absent + summary.otherChanged > 0
    const status = state.current === null ? 'baseline' : changed ? 'changed' : 'unchanged'
    const attempt: ObservationAttempt = { startedAt, completedAt, status, summary }
    next = {
      ...state, current: snapshot, previous: state.current, lease: null,
      lastPriceChangeAt: summary.priceChanges ? snapshot.readAt : state.lastPriceChangeAt,
      lastStockChangeAt: summary.stockChanges ? snapshot.readAt : state.lastStockChangeAt,
      lastDifference: changed ? difference : state.lastDifference,
      history: [...state.history, attempt].slice(-HISTORY_LIMIT),
    }
    result = { ...resultBase, status, readAt: snapshot.readAt, summary }
    // Check the persisted contract before replacing the last usable state.
    parseObservationState(JSON.stringify(next), binding)
  } catch (error) {
    const code: FailureCode = error instanceof InstalerSourceError ? error.code : 'source-invalid'
    next = {
      ...state, lease: null,
      history: [...state.history, { startedAt, completedAt: now().toISOString(), status: 'failed' as const, error: code }].slice(-HISTORY_LIMIT),
    }
    result = { ...resultBase, status: 'failed', error: code }
  }
  try { await store.write(JSON.stringify(next), etag) } catch (error) {
    throw new InstalerObservationError(error instanceof InstalerObservationStoreError && error.code === 'conflict' ? 'conflict' : 'storage')
  }
  return result
}
