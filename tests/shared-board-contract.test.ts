import assert from 'node:assert/strict'
import test from 'node:test'
import { createQuotation, createRow, type Quotation } from '../src/features/quotation/model.ts'
import { setRowFactoryMode } from '../src/features/quotation/factory-mode.ts'
import { createHarnessPresetRow } from '../src/features/quotation/harness-preset.ts'
import { changeRowCurrency } from '../src/features/quotation/row-currency.ts'
import {
  BOARD_MAX_BYTES, BOARD_MAX_ENTRIES, BOARD_REQUEST_MAX_BYTES, cloneBoardQuotation, createEmptyBoard,
  parseBoardDocument, quotationBaseline, readBoardDetailResponse, readBoardListResponse, readBoardSaveCommand,
  readBoardSaveResponse, readBoardWorkingContext, serializeBoardDocument, summarizeBoardEntry, toPublicBoardEntry,
} from '../src/features/quotation-board/board-contract.ts'
import type {
  BoardSaveCommand, BoardWorkingContext, SharedBoardDocument, SharedBoardEntry,
} from '../src/features/quotation-board/shared-board-types.ts'

const date = '2026-11-04T12:00:00.000Z'

function quotation(): Quotation {
  return {
    ...createQuotation(), title: 'Synthetic quotation', subtitle: 'Synthetic vehicle',
    exchangeRate: '1.100', exchangeRateMode: 'automatic', createdAt: date, updatedAt: date,
    rows: [{ ...createRow(), concept: 'Synthetic equipment', unitPrice: '100', priceState: 'priced' }],
  }
}

function richQuotation(): Quotation {
  const sale = changeRowCurrency({
    ...createRow(), audioCategory: 'speakers', concept: 'Synthetic speaker', detail: 'Keep this text',
    quantity: '2,5', unitPrice: '25.000', priceState: 'priced',
    provenance: {
      catalogItemId: 'synthetic-speaker', supplier: 'Synthetic supplier', sku: 'SYN-1',
      source: { document: 'Synthetic private source', date: null }, originalUnitPrice: '25.000', originalCurrency: 'ARS',
      priceBasis: 'manual',
    },
  }, 'USD', '1.100')
  const factory = setRowFactoryMode({
    ...createRow(), audioCategory: 'speakers', concept: 'Original factory product', detail: 'Original factory detail',
    unitPrice: '30', priceState: 'priced',
  }, true)
  const pending = { ...createRow(), concept: 'Partial synthetic concept', quantity: 'invalid quantity', unitPrice: 'invalid money' }
  const adapter = {
    ...createRow('extras'), audioCategory: 'adapters' as const, concept: 'Synthetic adapter', quantity: '2',
    unitPrice: '25', priceState: 'priced' as const,
    adapterVariant: { productKey: 'synthetic-adapter', size: '6,5', presentation: 'unit' as const },
  }
  const service = {
    ...createRow('extras'), audioCategory: 'labor' as const, concept: 'Synthetic service', unitPrice: '40,00', priceState: 'priced' as const,
    fixedServiceOrigin: {
      version: 1 as const, quantity: '2', unitPrice: '20', priceState: 'priced' as const, currency: 'ARS' as const, requiresPriceReview: false,
    },
  }
  const rows = [sale, factory, pending, adapter, service, createHarnessPresetRow(false), {
    ...createRow('extras'), concept: 'Synthetic included concept', priceState: 'included' as const,
  }]
  return {
    ...quotation(), rows, notes: 'Synthetic notes', rowOrder: rows.map((row) => row.id).reverse(),
    blockOrder: [`row:${pending.id}`, 'category:speakers', 'category:adapters'],
    discount: { percentage: '10', rowIds: [sale.id] },
    exchangeRateQuote: {
      rate: '1.100', source: 'DolarAPI', market: 'blue', side: 'sell', fetchedAt: date, updatedAt: date,
    },
  }
}

function entry(quote = quotation()): SharedBoardEntry {
  return {
    id: crypto.randomUUID(), name: 'Synthetic saved quote', categoryId: 'audio', revision: 1,
    createdAt: date, updatedAt: date, quotation: quote,
    lastOperationId: crypto.randomUUID(), lastOperationHash: 'a'.repeat(64),
  }
}

function board(saved = entry()): SharedBoardDocument {
  return {
    ...createEmptyBoard(), revision: 1, categories: [{ id: 'audio', name: 'Audio' }], entries: [saved],
  }
}

function command(quote = quotation()): BoardSaveCommand {
  return {
    type: 'save', operationId: crypto.randomUUID(), epoch: 'initial', mode: 'new', entryId: crypto.randomUUID(),
    expectedRevision: null, name: 'Synthetic new quote', categoryId: null, quotation: quote,
  }
}

test('the initial board is an independent empty document and initial epoch remains valid after saving', () => {
  assert.deepEqual(parseBoardDocument(serializeBoardDocument(createEmptyBoard())), {
    schema: 'luquisound.quotation-board', version: 1, epoch: 'initial', revision: 0, categories: [], entries: [],
  })
  const empty = createEmptyBoard()
  empty.categories.push({ id: 'temporary', name: 'Temporary' })
  assert.equal(createEmptyBoard().categories.length, 0)
  const saved = parseBoardDocument(serializeBoardDocument(board()))
  assert.equal(saved.epoch, 'initial')
  assert.equal(saved.revision, 1)
})

test('stored snapshots roundtrip every editable partial, provenance and special mode without mutating the original', () => {
  const quote = richQuotation()
  const before = structuredClone(quote)
  const result = parseBoardDocument(serializeBoardDocument(board(entry(quote))))
  assert.deepEqual(result.entries[0]!.quotation, { ...before, exchangeRateMode: 'frozen' })
  assert.deepEqual(quote, before)
  assert.equal(result.entries[0]!.quotation.rows[2]!.quantity, 'invalid quantity')
  assert.equal(result.entries[0]!.quotation.rows[2]!.unitPrice, 'invalid money')
  assert.equal(result.entries[0]!.quotation.rows[5]!.harnessSelection!.enabled, false)
  assert.equal(summarizeBoardEntry(result.entries[0]!).pending, true)
})

test('the board accepts name-only shells and explicit zero or included without treating saving as PNG approval', () => {
  const shell = createQuotation()
  shell.title = ''
  const shellEntry = parseBoardDocument(serializeBoardDocument(board(entry(shell)))).entries[0]!
  assert.equal(shellEntry.quotation.title, '')
  assert.equal(summarizeBoardEntry(shellEntry).pending, true)
  const quote = quotation()
  quote.rows[0]!.unitPrice = '0'
  quote.rows.push({ ...createRow('extras'), concept: 'Synthetic included', priceState: 'included' })
  const saved = parseBoardDocument(serializeBoardDocument(board(entry(quote)))).entries[0]!
  assert.equal(saved.quotation.rows[0]!.unitPrice, '0')
  assert.equal(saved.quotation.rows[1]!.priceState, 'included')
  assert.equal(summarizeBoardEntry(saved).pending, false)
})

test('cloning remaps order and discount references together while preserving customer text and deep metadata', () => {
  const original = richQuotation()
  const before = structuredClone(original)
  const copy = cloneBoardQuotation(original)
  const rowIds = new Map(original.rows.map((row, index) => [row.id, copy.rows[index]!.id]))
  assert.notEqual(copy.id, original.id)
  assert.equal(copy.title, original.title)
  assert.equal(copy.exchangeRateMode, 'frozen')
  assert.deepEqual(copy.rowOrder, original.rowOrder!.map((id) => rowIds.get(id)))
  assert.deepEqual(copy.blockOrder, original.blockOrder!.map((id) => id.startsWith('row:') ? `row:${rowIds.get(id.slice(4))}` : id))
  assert.deepEqual(copy.discount!.rowIds, original.discount!.rowIds.map((id) => rowIds.get(id)))
  for (const [index, source] of original.rows.entries()) {
    assert.notEqual(copy.rows[index]!.id, source.id)
    assert.deepEqual({ ...copy.rows[index], id: source.id }, source)
  }
  copy.rows[0]!.provenance!.source!.document = 'Changed after copying'
  copy.rows[1]!.factoryEquipment!.original.detail = 'Changed after copying'
  assert.deepEqual(original, before)
})

test('baselines are canonical across property ordering, timestamps and mode but detect row identity or content changes', () => {
  const original = richQuotation()
  const baseline = quotationBaseline(original)
  const reordered = Object.fromEntries(Object.entries(original).reverse()) as unknown as Quotation
  assert.equal(quotationBaseline(reordered), baseline)
  assert.equal(quotationBaseline({ ...original, createdAt: '2026-11-05T12:00:00.000Z', updatedAt: '2026-11-05T12:00:00.000Z', exchangeRateMode: 'frozen' }), baseline)
  assert.equal(JSON.parse(baseline).id, original.id)
  assert.equal(JSON.parse(baseline).createdAt, undefined)
  const changed = structuredClone(original)
  changed.rows[0]!.detail = 'Changed'
  assert.notEqual(quotationBaseline(changed), baseline)
  assert.notEqual(quotationBaseline(cloneBoardQuotation(original)), baseline)
})

test('working context validates canonical baseline, source revision and bounded safe identifiers', () => {
  const quote = quotation()
  const context: BoardWorkingContext = {
    entryId: 'saved-entry', revision: 1, epoch: 'initial', name: 'Synthetic source', categoryId: null,
    baseline: quotationBaseline(quote),
  }
  assert.deepEqual(readBoardWorkingContext(context), context)
  assert.deepEqual(readBoardWorkingContext({ ...context, baseline: JSON.stringify(JSON.parse(context.baseline), null, 2) }), context)
  for (const changes of [
    { entryId: '' }, { entryId: '../unsafe' }, { revision: 0 }, { revision: 1.5 }, { epoch: 'bad-epoch' },
    { name: '' }, { name: 'x'.repeat(121) }, { categoryId: '' }, { baseline: '{}' }, { baseline: 'not JSON' },
    { extra: true },
  ]) assert.throws(() => readBoardWorkingContext({ ...context, ...changes }))
})

test('entry names can repeat while category IDs and normalized category names remain unique', () => {
  const document = board()
  document.entries.push({ ...entry(), name: document.entries[0]!.name })
  assert.equal(parseBoardDocument(serializeBoardDocument(document)).entries.length, 2)
  for (const category of [
    { id: 'other', name: '  AUDIO  ' }, { id: 'other', name: 'Ａｕｄｉｏ' }, { id: 'audio', name: 'Different name' },
  ]) assert.throws(() => serializeBoardDocument({ ...document, categories: [...document.categories, category] }))
  const whitespace = { ...document, categories: [{ id: 'a', name: 'Audio Auto' }, { id: 'b', name: ' audio   auto ' }] }
  assert.throws(() => serializeBoardDocument(whitespace))
})

test('structural corruption, invalid metadata and unresolved categories never serialize as a valid board', () => {
  const document = board()
  for (const changes of [
    { schema: 'other' }, { version: 2 }, { epoch: 'not-an-epoch' }, { revision: -1 }, { revision: 0 }, { extra: true },
  ]) assert.throws(() => parseBoardDocument(JSON.stringify({ ...document, ...changes })))
  for (const changes of [
    { id: '../unsafe' }, { categoryId: 'missing' }, { revision: 0 }, { updatedAt: '2026-02-30T12:00:00.000Z' },
    { createdAt: '2026-11-05T12:00:00.000Z' }, { lastOperationId: '' }, { lastOperationHash: 'invalid' }, { extra: true },
    { quotation: { ...quotation(), rows: [{ ...createRow(), currency: 'INVALID' }] } },
  ]) assert.throws(() => parseBoardDocument(JSON.stringify({ ...document, entries: [{ ...document.entries[0], ...changes }] })))
  assert.throws(() => serializeBoardDocument({ ...document, entries: [document.entries[0]!, document.entries[0]!] }))
})

test('collection and UTF-8 byte caps reject excess data without silently dropping entries or truncating text', () => {
  const document = board()
  const entries = Array.from({ length: BOARD_MAX_ENTRIES }, () => entry())
  assert.equal(parseBoardDocument(serializeBoardDocument({ ...document, entries })).entries.length, BOARD_MAX_ENTRIES)
  assert.throws(() => serializeBoardDocument({ ...document, entries: [...entries, entry()] }))
  const manyCategories = Array.from({ length: BOARD_MAX_ENTRIES + 1 }, (_, index) => ({ id: `category-${index}`, name: `Category ${index}` }))
  assert.throws(() => serializeBoardDocument({ ...document, categories: manyCategories }))
  const oversizedText = `"${'é'.repeat(Math.floor(BOARD_MAX_BYTES / 2))}"`
  assert.ok(oversizedText.length < BOARD_MAX_BYTES)
  assert.throws(() => parseBoardDocument(oversizedText), /tamaño permitido/)
  assert.throws(() => readBoardSaveCommand({ ...command(), oversized: 'é'.repeat(BOARD_REQUEST_MAX_BYTES / 2) }), /tamaño permitido/)
})

test('save commands validate create and replacement intent independently from editable quote completeness', () => {
  const create = command(createQuotation())
  assert.deepEqual(readBoardSaveCommand(create), create)
  const replace = { ...create, mode: 'replace' as const, expectedRevision: 3, newCategoryName: '  New category  ' }
  assert.equal(readBoardSaveCommand(replace).newCategoryName, 'New category')
  assert.equal(readBoardSaveCommand(command()).quotation.exchangeRateMode, 'automatic')
  for (const changes of [
    { type: 'delete' }, { mode: 'invalid' }, { operationId: '' }, { entryId: '../unsafe' }, { expectedRevision: 1 },
    { mode: 'replace', expectedRevision: null }, { name: ' ' }, { name: 'x'.repeat(121) },
    { newCategoryName: '' }, { newCategoryName: 'x'.repeat(81) }, { newCategoryName: 'New', categoryId: 'audio' },
    { extra: true },
  ]) assert.throws(() => readBoardSaveCommand({ ...create, ...changes }))
})

test('public entry and response validators whitelist fields and never forward server operation hashes', () => {
  const saved = entry()
  const publicSaved = toPublicBoardEntry(saved)
  assert.equal('lastOperationId' in publicSaved, false)
  assert.equal('lastOperationHash' in publicSaved, false)
  assert.equal('createdAt' in publicSaved, false)
  assert.equal(publicSaved.quotation.exchangeRateMode, 'frozen')
  const detail = readBoardDetailResponse({ epoch: 'initial', entry: saved, secret: 'discard' })
  assert.deepEqual(detail, { epoch: 'initial', entry: publicSaved })
  const response = readBoardSaveResponse({ ...detail, operationId: 'operation-1', serverHash: 'discard' })
  assert.deepEqual(response, { ...detail, operationId: 'operation-1' })
  const summary = summarizeBoardEntry(saved)
  const listed = readBoardListResponse({
    epoch: 'initial', revision: 1, categories: [{ id: 'audio', name: 'Audio', secret: 'discard' }],
    entries: [{ ...summary, quotation: saved.quotation, lastOperationHash: saved.lastOperationHash }], secret: 'discard',
  })
  assert.deepEqual(listed, { epoch: 'initial', revision: 1, categories: [{ id: 'audio', name: 'Audio' }], entries: [summary] })
  assert.equal('quotation' in listed.entries[0]!, false)
  assert.throws(() => readBoardListResponse({ ...listed, entries: [{ ...summary, categoryId: 'missing' }] }))
  assert.throws(() => readBoardDetailResponse({ ...detail, entry: { ...publicSaved, revision: 0 } }))
})

test('response envelopes accept metadata growth around a maximum-size command while retaining quote and envelope caps', () => {
  const submitted = command()
  submitted.newCategoryName = 'A'
  submitted.quotation.rows = Array.from({ length: 967 }, (_, index) => ({
    ...createRow(), id: `row-${String(index).padStart(32, '0')}`, concept: 'A', detail: 'x'.repeat(2000),
  }))
  const padding = BOARD_REQUEST_MAX_BYTES - new TextEncoder().encode(JSON.stringify(submitted)).byteLength
  assert.ok(padding >= 0 && padding <= 10000)
  submitted.quotation.notes = 'x'.repeat(padding)
  assert.equal(new TextEncoder().encode(JSON.stringify(submitted)).byteLength, BOARD_REQUEST_MAX_BYTES)
  assert.deepEqual(readBoardSaveCommand(submitted), submitted)
  const saved: SharedBoardEntry = {
    ...entry({ ...submitted.quotation, exchangeRateMode: 'frozen' }),
    id: submitted.entryId, name: submitted.name, categoryId: '00000000-0000-4000-8000-000000000001',
  }
  const detail = { epoch: 'initial', entry: toPublicBoardEntry(saved) }
  const response = { ...detail, operationId: submitted.operationId }
  const responseBytes = new TextEncoder().encode(JSON.stringify(response)).byteLength
  assert.ok(responseBytes > BOARD_REQUEST_MAX_BYTES && responseBytes < BOARD_MAX_BYTES)
  assert.deepEqual(readBoardDetailResponse(detail), detail)
  assert.deepEqual(readBoardSaveResponse(response), response)
  const oversized = { ...response, unexpectedPadding: 'x'.repeat(BOARD_MAX_BYTES) }
  assert.throws(() => readBoardDetailResponse(oversized), /tamaño permitido/)
  assert.throws(() => readBoardSaveResponse(oversized), /tamaño permitido/)
  assert.throws(() => readBoardListResponse({
    epoch: 'initial', revision: 0, entries: [], categories: [], unexpectedPadding: 'x'.repeat(BOARD_MAX_BYTES),
  }), /tamaño permitido/)
  const overlargeQuote = {
    ...response, entry: { ...response.entry, quotation: { ...response.entry.quotation, unexpectedPadding: 'x'.repeat(BOARD_REQUEST_MAX_BYTES) } },
  }
  assert.throws(() => readBoardSaveResponse(overlargeQuote), /tamaño permitido/)
  assert.throws(() => readBoardSaveResponse({ ...response, operationId: '' }))
})
