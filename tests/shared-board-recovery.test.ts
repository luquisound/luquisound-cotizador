import assert from 'node:assert/strict'
import test from 'node:test'
import { quotationBaseline } from '../src/features/quotation-board/board-contract.ts'
import type { BoardSaveCommand, BoardWorkingContext } from '../src/features/quotation-board/shared-board-types.ts'
import { createQuotation, createRow, hasQuotationContent } from '../src/features/quotation/model.ts'
import type { Quotation } from '../src/features/quotation/model.ts'
import { parseWorkspace, serializeWorkspace, STORAGE_KEY } from '../src/features/quotation/persistence.ts'
import type { StorageAdapter } from '../src/features/quotation/persistence.ts'
import {
  CATALOG_STORAGE_KEY, CURRENT_QUOTATION_STORAGE_KEY, loadCurrentQuotation, saveCurrentQuotation,
} from '../src/features/quotation/working-storage.ts'

const libraryKey = 'luquisound.quotation-library.v1'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const reads: string[] = []
  const writes: { key: string; text: string }[] = []
  const storage: StorageAdapter = {
    getItem(key) { reads.push(key); return values.get(key) ?? null },
    setItem(key, text) { values.set(key, text); writes.push({ key, text }) },
  }
  return { storage, values, reads, writes }
}

function quotationFixture(): Quotation {
  return {
    ...createQuotation(), title: 'Synthetic shared quotation', exchangeRate: '1000', exchangeRateMode: 'frozen',
    rows: [{ ...createRow(), concept: 'Synthetic pending equipment', detail: 'Retained working draft' }],
  }
}

function contextFixture(quotation: Quotation): BoardWorkingContext {
  return {
    entryId: 'synthetic-entry', revision: 3, epoch: 'initial', name: 'Synthetic board name',
    categoryId: 'synthetic-category', baseline: quotationBaseline(quotation),
  }
}

function pendingFixture(quotation: Quotation): BoardSaveCommand {
  return {
    type: 'save', operationId: 'synthetic-pending-operation', epoch: 'initial', mode: 'new',
    entryId: 'synthetic-new-entry', expectedRevision: null, name: 'Synthetic pending save',
    categoryId: null, newCategoryName: 'Synthetic pending category', quotation: structuredClone(quotation),
  }
}

function quotationText(quotation: Quotation): string {
  return serializeWorkspace({ version: 1, activeQuotationId: quotation.id, quotations: [quotation], catalog: [] })
}

function envelope(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>
}

test('older current records load without a context or any read-time migration', () => {
  const quotation = quotationFixture()
  const raw = `\ufeff${quotationText(quotation)}\n`
  const memory = memoryStorage({ [CURRENT_QUOTATION_STORAGE_KEY]: raw })
  assert.deepEqual(loadCurrentQuotation(memory.storage), { quotation, error: null, raw })
  assert.equal(memory.values.get(CURRENT_QUOTATION_STORAGE_KEY), raw)
  assert.deepEqual(memory.writes, [])
  const saved = saveCurrentQuotation(memory.storage, quotation, { expectedRaw: raw })
  assert.equal(saved.ok, true)
  assert.equal(saved.raw, quotationText(quotation))
  assert.equal(Object.hasOwn(envelope(saved.raw!), 'boardContext'), false)
})

test('quotation and source context recover from one atomic current-store write', () => {
  const quotation = quotationFixture()
  const boardContext = contextFixture(quotation)
  const sentinels = {
    [CATALOG_STORAGE_KEY]: 'synthetic catalogue sentinel', [STORAGE_KEY]: 'synthetic legacy sentinel',
    [libraryKey]: 'synthetic historical library sentinel',
  }
  const memory = memoryStorage(sentinels)
  const saved = saveCurrentQuotation(memory.storage, quotation, { expectedRaw: null, boardContext })
  assert.equal(saved.ok, true)
  assert.equal(memory.writes.length, 1)
  assert.equal(memory.writes[0]!.key, CURRENT_QUOTATION_STORAGE_KEY)
  assert.deepEqual(envelope(memory.writes[0]!.text).boardContext, boardContext)
  assert.deepEqual(loadCurrentQuotation(memory.storage), { quotation, error: null, raw: saved.raw, boardContext })
  for (const [key, text] of Object.entries(sentinels)) assert.equal(memory.values.get(key), text)
  assert.equal(memory.reads.every((key) => key === CURRENT_QUOTATION_STORAGE_KEY), true)
})

test('a linked blank shell remains recoverable and clearing its context restores the blank contract', () => {
  const quotation = createQuotation()
  assert.equal(hasQuotationContent(quotation), false)
  const boardContext = contextFixture(quotation)
  const memory = memoryStorage()
  const saved = saveCurrentQuotation(memory.storage, quotation, { expectedRaw: null, boardContext })
  assert.equal(saved.ok, true)
  assert.deepEqual(loadCurrentQuotation(memory.storage), { quotation, error: null, raw: saved.raw, boardContext })
  assert.equal(parseWorkspace(saved.raw!).quotations.length, 1)
  const cleared = saveCurrentQuotation(memory.storage, quotation, { expectedRaw: saved.raw, boardContext: null })
  assert.equal(cleared.ok, true)
  assert.deepEqual(parseWorkspace(cleared.raw!), { version: 1, activeQuotationId: null, quotations: [], catalog: [] })
  assert.equal(Object.hasOwn(envelope(cleared.raw!), 'boardContext'), false)
  assert.equal(Object.hasOwn(loadCurrentQuotation(memory.storage), 'boardContext'), false)
})

test('explicit context clearing keeps meaningful working content unchanged', () => {
  const quotation = quotationFixture()
  const memory = memoryStorage()
  const saved = saveCurrentQuotation(memory.storage, quotation, { boardContext: contextFixture(quotation) })
  assert.equal(saved.ok, true)
  const cleared = saveCurrentQuotation(memory.storage, quotation, { expectedRaw: saved.raw, boardContext: null })
  assert.equal(cleared.ok, true)
  assert.deepEqual(loadCurrentQuotation(memory.storage), { quotation, error: null, raw: cleared.raw })
  assert.equal(cleared.raw, quotationText(quotation))
})

test('corrupt context exposes the valid quotation but cannot enable replacement or be overwritten implicitly', () => {
  const quotation = quotationFixture()
  const raw = JSON.stringify({ ...envelope(quotationText(quotation)), boardContext: { ...contextFixture(quotation), revision: 0 } })
  const memory = memoryStorage({ [CURRENT_QUOTATION_STORAGE_KEY]: raw })
  const loaded = loadCurrentQuotation(memory.storage)
  assert.deepEqual(loaded.quotation, quotation)
  assert.notEqual(loaded.error, null)
  assert.equal(loaded.raw, raw)
  assert.equal(Object.hasOwn(loaded, 'boardContext'), false)
  const saved = saveCurrentQuotation(memory.storage, quotation, { expectedRaw: raw, boardContext: contextFixture(quotation) })
  assert.equal(saved.ok, false)
  assert.equal(saved.conflict, false)
  assert.equal(memory.values.get(CURRENT_QUOTATION_STORAGE_KEY), raw)
  assert.deepEqual(memory.writes, [])
  const replaced = saveCurrentQuotation(memory.storage, quotation, { expectedRaw: raw, overwriteInvalid: true, boardContext: null })
  assert.equal(replaced.ok, true)
  assert.deepEqual(loadCurrentQuotation(memory.storage), { quotation, error: null, raw: replaced.raw })
})

test('context without a recoverable quotation is invalid and preserves its stored bytes', () => {
  const quotation = quotationFixture()
  const raw = JSON.stringify({ version: 1, activeQuotationId: null, quotations: [], catalog: [], boardContext: contextFixture(quotation) })
  const memory = memoryStorage({ [CURRENT_QUOTATION_STORAGE_KEY]: raw })
  const loaded = loadCurrentQuotation(memory.storage)
  assert.notEqual(loaded.error, null)
  assert.equal(Object.hasOwn(loaded, 'boardContext'), false)
  assert.equal(loaded.raw, raw)
  assert.equal(memory.values.get(CURRENT_QUOTATION_STORAGE_KEY), raw)
  assert.deepEqual(memory.writes, [])
})

test('context-only concurrent changes conflict before any working session is written', () => {
  const quotation = quotationFixture()
  const memory = memoryStorage()
  const original = saveCurrentQuotation(memory.storage, quotation, { boardContext: contextFixture(quotation) }).raw!
  const concurrent = JSON.stringify({ ...envelope(original), boardContext: { ...contextFixture(quotation), revision: 4 } })
  memory.values.set(CURRENT_QUOTATION_STORAGE_KEY, concurrent)
  memory.writes.length = 0
  const saved = saveCurrentQuotation(memory.storage, { ...quotation, notes: 'Synthetic later work' }, {
    expectedRaw: original, boardContext: contextFixture(quotation),
  })
  assert.equal(saved.ok, false)
  assert.equal(saved.conflict, true)
  assert.equal(saved.raw, concurrent)
  assert.deepEqual(memory.writes, [])
  assert.equal(memory.values.get(CURRENT_QUOTATION_STORAGE_KEY), concurrent)
})

test('the second byte comparison also protects a source-context race during validation', () => {
  const quotation = quotationFixture()
  const memory = memoryStorage()
  const original = saveCurrentQuotation(memory.storage, quotation, { boardContext: contextFixture(quotation) }).raw!
  const concurrent = JSON.stringify({ ...envelope(original), boardContext: { ...contextFixture(quotation), revision: 4 } })
  let reads = 0
  let writes = 0
  const storage: StorageAdapter = {
    getItem() { reads += 1; return reads === 1 ? original : concurrent },
    setItem() { writes += 1 },
  }
  const saved = saveCurrentQuotation(storage, quotation, { expectedRaw: original, boardContext: contextFixture(quotation) })
  assert.equal(saved.ok, false)
  assert.equal(saved.conflict, true)
  assert.equal(saved.raw, concurrent)
  assert.equal(reads, 2)
  assert.equal(writes, 0)
})

test('write failure cannot advance the saved context or mutate the caller state', () => {
  const quotation = quotationFixture()
  const boardContext = contextFixture(quotation)
  const memory = memoryStorage()
  const original = saveCurrentQuotation(memory.storage, quotation, { boardContext }).raw!
  const snapshot = structuredClone({ quotation, boardContext })
  let writes = 0
  const storage: StorageAdapter = {
    getItem() { return original },
    setItem() { writes += 1; throw new Error('Synthetic storage full') },
  }
  const saved = saveCurrentQuotation(storage, { ...quotation, notes: 'Synthetic later work' }, {
    expectedRaw: original, boardContext: { ...boardContext, revision: 4 },
  })
  assert.equal(saved.ok, false)
  assert.equal(saved.conflict, false)
  assert.equal(saved.raw, original)
  assert.equal(writes, 1)
  assert.deepEqual({ quotation, boardContext }, snapshot)
  assert.deepEqual(loadCurrentQuotation(memory.storage).boardContext, boardContext)
})

test('invalid incoming context and an oversized combined envelope leave previous recovery intact', () => {
  const quotation = quotationFixture()
  const memory = memoryStorage()
  const original = saveCurrentQuotation(memory.storage, quotation, { boardContext: contextFixture(quotation) }).raw!
  memory.writes.length = 0
  const invalid = saveCurrentQuotation(memory.storage, quotation, {
    expectedRaw: original, boardContext: { ...contextFixture(quotation), baseline: 'not valid JSON' },
  })
  assert.equal(invalid.ok, false)
  const largeQuotation = {
    ...quotation,
    rows: Array.from({ length: 900 }, () => ({ ...createRow(), concept: 'Synthetic large draft', detail: '\u754c'.repeat(1700) })),
  }
  assert.doesNotThrow(() => quotationText(largeQuotation))
  const previousBaseline = {
    ...quotation,
    rows: Array.from({ length: 500 }, () => ({ ...createRow(), concept: 'Synthetic previous baseline', detail: 'x'.repeat(1000) })),
  }
  const oversized = saveCurrentQuotation(memory.storage, largeQuotation, {
    expectedRaw: original, boardContext: contextFixture(previousBaseline),
  })
  assert.equal(oversized.ok, false)
  assert.equal(memory.values.get(CURRENT_QUOTATION_STORAGE_KEY), original)
  assert.deepEqual(memory.writes, [])
})

test('pending save snapshot and operation identity recover atomically without replay or other-store access', () => {
  const quotation = quotationFixture()
  const boardContext = contextFixture(quotation)
  const boardPendingSave = pendingFixture(quotation)
  const sentinels = {
    [CATALOG_STORAGE_KEY]: 'synthetic catalogue sentinel', [STORAGE_KEY]: 'synthetic legacy sentinel',
    [libraryKey]: 'synthetic historical library sentinel',
  }
  const memory = memoryStorage(sentinels)
  const saved = saveCurrentQuotation(memory.storage, quotation, { expectedRaw: null, boardContext, boardPendingSave })
  assert.equal(saved.ok, true)
  assert.equal(memory.writes.length, 1)
  assert.equal(memory.writes[0]!.key, CURRENT_QUOTATION_STORAGE_KEY)
  assert.deepEqual(envelope(saved.raw!).boardPendingSave, boardPendingSave)
  assert.deepEqual(loadCurrentQuotation(memory.storage), { quotation, boardContext, boardPendingSave, error: null, raw: saved.raw })
  assert.equal(memory.writes.length, 1)
  for (const [key, text] of Object.entries(sentinels)) assert.equal(memory.values.get(key), text)
  assert.equal(memory.reads.every((key) => key === CURRENT_QUOTATION_STORAGE_KEY), true)
})

test('pending save retains its exact earlier snapshot while the working quotation changes or becomes a different blank quote', () => {
  const previous = quotationFixture()
  const boardPendingSave = pendingFixture(previous)
  const memory = memoryStorage()
  const edited = { ...previous, notes: 'Synthetic later unsaved edit' }
  const saved = saveCurrentQuotation(memory.storage, edited, { boardPendingSave })
  assert.equal(saved.ok, true)
  assert.deepEqual(loadCurrentQuotation(memory.storage).quotation, edited)
  assert.deepEqual(loadCurrentQuotation(memory.storage).boardPendingSave?.quotation, previous)
  const quotation = createQuotation()
  assert.equal(hasQuotationContent(quotation), false)
  const changed = saveCurrentQuotation(memory.storage, quotation, { expectedRaw: saved.raw, boardContext: null, boardPendingSave })
  assert.equal(changed.ok, true)
  const loaded = loadCurrentQuotation(memory.storage)
  assert.deepEqual(loaded.quotation, quotation)
  assert.deepEqual(loaded.boardPendingSave, boardPendingSave)
  assert.notEqual(loaded.quotation.id, loaded.boardPendingSave!.quotation.id)
  assert.equal(Object.hasOwn(loaded, 'boardContext'), false)
  assert.equal(parseWorkspace(changed.raw!).quotations.length, 1)
})

test('clearing a pending save retains its board context and working data, and no pending field leaks into older records', () => {
  const quotation = quotationFixture()
  const boardContext = contextFixture(quotation)
  const memory = memoryStorage()
  const saved = saveCurrentQuotation(memory.storage, quotation, { boardContext, boardPendingSave: pendingFixture(quotation) })
  const cleared = saveCurrentQuotation(memory.storage, quotation, { expectedRaw: saved.raw, boardContext, boardPendingSave: null })
  assert.equal(cleared.ok, true)
  assert.deepEqual(loadCurrentQuotation(memory.storage), { quotation, boardContext, error: null, raw: cleared.raw })
  assert.equal(Object.hasOwn(envelope(cleared.raw!), 'boardPendingSave'), false)
  const unlinked = saveCurrentQuotation(memory.storage, quotation, { expectedRaw: cleared.raw, boardContext: null, boardPendingSave: null })
  assert.equal(unlinked.ok, true)
  assert.equal(unlinked.raw, quotationText(quotation))
  assert.deepEqual(loadCurrentQuotation(memory.storage), { quotation, error: null, raw: unlinked.raw })
})

test('corrupt pending metadata preserves the valid quote but discards every unsafe board association', () => {
  const quotation = quotationFixture()
  const boardContext = contextFixture(quotation)
  const boardPendingSave = pendingFixture(quotation)
  const raw = JSON.stringify({
    ...envelope(quotationText(quotation)), boardContext,
    boardPendingSave: { ...boardPendingSave, expectedRevision: 5 },
  })
  const memory = memoryStorage({ [CURRENT_QUOTATION_STORAGE_KEY]: raw })
  const loaded = loadCurrentQuotation(memory.storage)
  assert.deepEqual(loaded.quotation, quotation)
  assert.notEqual(loaded.error, null)
  assert.equal(loaded.raw, raw)
  assert.equal(Object.hasOwn(loaded, 'boardContext'), false)
  assert.equal(Object.hasOwn(loaded, 'boardPendingSave'), false)
  const rejected = saveCurrentQuotation(memory.storage, quotation, { expectedRaw: raw, boardContext, boardPendingSave })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.conflict, false)
  assert.equal(memory.values.get(CURRENT_QUOTATION_STORAGE_KEY), raw)
  assert.deepEqual(memory.writes, [])
  const cleared = saveCurrentQuotation(memory.storage, quotation, {
    expectedRaw: raw, overwriteInvalid: true, boardContext: null, boardPendingSave: null,
  })
  assert.equal(cleared.ok, true)
  assert.deepEqual(loadCurrentQuotation(memory.storage), { quotation, error: null, raw: cleared.raw })
})

test('pending metadata without a retained working quote is invalid and is not rewritten', () => {
  const raw = JSON.stringify({
    version: 1, activeQuotationId: null, quotations: [], catalog: [],
    boardPendingSave: pendingFixture(quotationFixture()),
  })
  const memory = memoryStorage({ [CURRENT_QUOTATION_STORAGE_KEY]: raw })
  const loaded = loadCurrentQuotation(memory.storage)
  assert.notEqual(loaded.error, null)
  assert.equal(Object.hasOwn(loaded, 'boardPendingSave'), false)
  assert.equal(memory.values.get(CURRENT_QUOTATION_STORAGE_KEY), raw)
  assert.deepEqual(memory.writes, [])
})

test('pending-command-only races preserve concurrent bytes before and during validation', () => {
  const quotation = quotationFixture()
  const boardPendingSave = pendingFixture(quotation)
  const memory = memoryStorage()
  const original = saveCurrentQuotation(memory.storage, quotation, { boardPendingSave }).raw!
  const concurrent = JSON.stringify({
    ...envelope(original), boardPendingSave: { ...boardPendingSave, operationId: 'synthetic-other-pending-operation' },
  })
  for (const changesDuringValidation of [false, true]) {
    let reads = 0
    let writes = 0
    const storage: StorageAdapter = {
      getItem() { reads += 1; return changesDuringValidation && reads === 1 ? original : concurrent },
      setItem() { writes += 1 },
    }
    const saved = saveCurrentQuotation(storage, quotation, { expectedRaw: original, boardPendingSave })
    assert.equal(saved.ok, false)
    assert.equal(saved.conflict, true)
    assert.equal(saved.raw, concurrent)
    assert.equal(writes, 0)
  }
})

test('pending-command write failures and invalid new commands do not advance the saved recovery record', () => {
  const quotation = quotationFixture()
  const boardPendingSave = pendingFixture(quotation)
  const memory = memoryStorage()
  const original = saveCurrentQuotation(memory.storage, quotation, { boardPendingSave }).raw!
  memory.writes.length = 0
  const invalid = saveCurrentQuotation(memory.storage, quotation, {
    expectedRaw: original, boardPendingSave: { ...boardPendingSave, expectedRevision: 5 },
  })
  assert.equal(invalid.ok, false)
  assert.deepEqual(memory.writes, [])
  let attempted = 0
  const storage: StorageAdapter = {
    getItem() { return original },
    setItem() { attempted += 1; throw new Error('Synthetic full storage') },
  }
  const nextPending = { ...boardPendingSave, operationId: 'synthetic-next-operation' }
  const snapshot = structuredClone(nextPending)
  const saved = saveCurrentQuotation(storage, quotation, { expectedRaw: original, boardPendingSave: nextPending })
  assert.equal(saved.ok, false)
  assert.equal(saved.conflict, false)
  assert.equal(saved.raw, original)
  assert.equal(attempted, 1)
  assert.deepEqual(nextPending, snapshot)
  assert.deepEqual(loadCurrentQuotation(memory.storage).boardPendingSave, boardPendingSave)
})

test('the combined working quotation and pending snapshot obey the existing 5 MiB recovery limit', () => {
  const quotation = quotationFixture()
  const memory = memoryStorage()
  const original = saveCurrentQuotation(memory.storage, quotation, { boardPendingSave: pendingFixture(quotation) }).raw!
  memory.writes.length = 0
  const largeQuotation = {
    ...quotation,
    rows: Array.from({ length: 900 }, () => ({ ...createRow(), concept: 'Synthetic large current draft', detail: '\u754c'.repeat(1700) })),
  }
  assert.doesNotThrow(() => quotationText(largeQuotation))
  const pendingQuotation = {
    ...quotation,
    rows: Array.from({ length: 500 }, () => ({ ...createRow(), concept: 'Synthetic older pending snapshot', detail: 'x'.repeat(1000) })),
  }
  const oversized = saveCurrentQuotation(memory.storage, largeQuotation, {
    expectedRaw: original, boardPendingSave: pendingFixture(pendingQuotation),
  })
  assert.equal(oversized.ok, false)
  assert.equal(memory.values.get(CURRENT_QUOTATION_STORAGE_KEY), original)
  assert.deepEqual(memory.writes, [])
})
