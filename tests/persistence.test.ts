import assert from 'node:assert/strict'
import test from 'node:test'
import { duplicateQuotation } from '../src/features/quotation/model.ts'
import type { CatalogItem, Quotation, QuotationRow, Workspace } from '../src/features/quotation/model.ts'
import { loadWorkspace, parseWorkspace, saveWorkspace, serializeWorkspace, STORAGE_KEY } from '../src/features/quotation/persistence.ts'
import type { StorageAdapter } from '../src/features/quotation/persistence.ts'

function createFixture(): Workspace {
  return {
    version: 1,
    activeQuotationId: 'quotation-1',
    quotations: [{
      id: 'quotation-1', title: 'PRUEBA', subtitle: 'Datos ficticios', currency: 'ARS',
      notes: 'Nota de prueba\nSegunda línea',
      createdAt: '2026-10-16T10:00:00.000Z', updatedAt: '2026-10-16T10:15:00.000Z',
      rows: [
        { id: 'row-1', section: 'equipment', concept: 'Equipo de prueba', detail: 'Descripción', quantity: '2', unitPrice: '10,50', priceState: 'priced' },
        { id: 'row-2', section: 'extras', concept: 'Trabajo sin cargo', detail: '', quantity: '1', unitPrice: '', priceState: 'included' },
        { id: 'row-3', section: 'extras', concept: 'Precio pendiente', detail: '', quantity: '1', unitPrice: '', priceState: 'pending' },
        { id: 'row-4', section: 'extras', concept: 'Cero explícito', detail: '', quantity: '1', unitPrice: '0', priceState: 'priced' },
      ],
    }],
    catalog: [{ id: 'catalog-1', section: 'equipment', concept: 'Equipo de prueba', detail: 'Descripción actualizada', currency: 'ARS', unitPrice: '91,25' }],
  }
}

test('duplicating a maximum-length imported title remains recoverable', () => {
  const workspace = createFixture()
  workspace.quotations[0]!.title = 'A'.repeat(500)
  const duplicate = duplicateQuotation(workspace.quotations[0]!)
  workspace.quotations.push(duplicate)
  workspace.activeQuotationId = duplicate.id
  assert.equal(duplicate.title.length, 500)
  assert.ok(duplicate.title.endsWith(' (copia)'))
  assert.equal(parseWorkspace(serializeWorkspace(workspace)).quotations.length, 2)
  assert.equal(workspace.quotations[0]!.title, 'A'.repeat(500))
})

function createMemoryStorage(initial: string | null = null) {
  let value = initial
  let writes = 0
  return {
    getItem(key: string): string | null {
      assert.equal(key, STORAGE_KEY)
      return value
    },
    setItem(key: string, next: string): void {
      assert.equal(key, STORAGE_KEY)
      writes += 1
      value = next
    },
    current: () => value,
    writeCount: () => writes,
  }
}

function rejectBackup(value: unknown): void {
  assert.throws(() => parseWorkspace(JSON.stringify(value)), /formato válido de Luquisound/)
}

test('an empty storage starts a blank workspace without writing', () => {
  const storage = createMemoryStorage()
  const result = loadWorkspace(storage)
  assert.equal(result.error, null)
  assert.equal(result.stored, false)
  assert.equal(result.workspace.quotations.length, 1)
  assert.equal(result.workspace.activeQuotationId, result.workspace.quotations[0].id)
  assert.deepEqual(result.workspace.catalog, [])
  assert.ok(result.workspace.quotations[0].rows.every((row) => row.concept === '' && row.unitPrice === '' && row.priceState === 'pending'))
  assert.equal(storage.writeCount(), 0)
})

test('saving and loading retains drafts, explicit zero, included and pending amounts', () => {
  const workspace = createFixture()
  const storage = createMemoryStorage()
  assert.deepEqual(saveWorkspace(storage, workspace), { ok: true, error: null })
  assert.equal(storage.writeCount(), 1)
  const loaded = loadWorkspace(storage)
  assert.equal(loaded.error, null)
  assert.equal(loaded.stored, true)
  assert.deepEqual(loaded.workspace, workspace)
  assert.notEqual(loaded.workspace, workspace)
  assert.notEqual(loaded.workspace.quotations[0].rows, workspace.quotations[0].rows)
})

test('JSON backup roundtrips raw draft input without coercion', () => {
  const workspace = createFixture()
  workspace.quotations[0].rows[0].quantity = '1,25'
  workspace.quotations[0].rows[0].unitPrice = 'importe por revisar'
  workspace.quotations[0].currency = 'USD'
  const backup = serializeWorkspace(workspace)
  assert.deepEqual(parseWorkspace(backup), workspace)
  assert.deepEqual(parseWorkspace(`\ufeff${backup}`), workspace)
})

test('import and serialization keep only known fields at every data boundary', () => {
  const workspace = createFixture()
  const expanded = {
    ...workspace, unrecognized: 'discard',
    quotations: workspace.quotations.map((quotation) => ({
      ...quotation, unrecognized: 'discard',
      rows: quotation.rows.map((row) => ({ ...row, unrecognized: 'discard' })),
    })),
    catalog: workspace.catalog.map((item) => ({ ...item, unrecognized: 'discard' })),
  }
  assert.deepEqual(parseWorkspace(JSON.stringify(expanded)), workspace)
  assert.deepEqual(JSON.parse(serializeWorkspace(expanded)), workspace)
})

test('unexpected prototype-shaped JSON fields are discarded', () => {
  const backup = serializeWorkspace(createFixture())
  const expanded = backup.replace('"version": 1,', '"version": 1, "__proto__": {"polluted": true}, "constructor": {"polluted": true},')
  const loaded = parseWorkspace(expanded)
  assert.deepEqual(loaded, createFixture())
  assert.equal(Object.hasOwn(loaded, '__proto__'), false)
  assert.equal(Object.hasOwn(loaded, 'constructor'), false)
})

test('corrupted stored data remains untouched and yields a visible safe error', () => {
  const corruptText = '{"privateValue":"do-not-echo",'
  const storage = createMemoryStorage(corruptText)
  const loaded = loadWorkspace(storage)
  assert.match(loaded.error ?? '', /No se pudieron leer/)
  assert.equal(loaded.stored, false)
  assert.doesNotMatch(loaded.error ?? '', /do-not-echo/)
  assert.equal(loaded.workspace.quotations.length, 1)
  assert.equal(storage.current(), corruptText)
  assert.equal(storage.writeCount(), 0)
})

test('an empty or unsupported stored backup is not silently treated as a new workspace', () => {
  for (const text of ['', 'null', JSON.stringify({ version: 9 })]) {
    const storage = createMemoryStorage(text)
    const loaded = loadWorkspace(storage)
    assert.notEqual(loaded.error, null)
    assert.equal(loaded.stored, false)
    assert.equal(storage.current(), text)
    assert.equal(storage.writeCount(), 0)
  }
})

test('storage access failure does not crash or expose the thrown error', () => {
  const storage: StorageAdapter = {
    getItem() { throw new Error('private browser diagnostic') },
    setItem() { assert.fail('load must not write') },
  }
  const loaded = loadWorkspace(storage)
  assert.match(loaded.error ?? '', /No se pudo acceder/)
  assert.equal(loaded.stored, false)
  assert.doesNotMatch(loaded.error ?? '', /private browser diagnostic/)
  assert.equal(loaded.workspace.quotations.length, 1)
})

test('quota or denied writes are reported as failed saves', () => {
  const storage: StorageAdapter = {
    getItem() { return null },
    setItem() { throw new Error('private quota diagnostic') },
  }
  const result = saveWorkspace(storage, createFixture())
  assert.equal(result.ok, false)
  assert.match(result.error ?? '', /No se pudo guardar/)
  assert.doesNotMatch(result.error ?? '', /private quota diagnostic/)
})

test('invalid workspace cannot overwrite an existing stored backup', () => {
  const original = serializeWorkspace(createFixture())
  const storage = createMemoryStorage(original)
  const invalid = createFixture()
  invalid.activeQuotationId = 'missing-quotation'
  assert.equal(saveWorkspace(storage, invalid).ok, false)
  assert.equal(storage.current(), original)
  assert.equal(storage.writeCount(), 0)
})

test('invalid JSON errors are safe and never reproduce the input', () => {
  assert.throws(() => parseWorkspace('{"private":"do-not-echo"'), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /formato válido de Luquisound/)
    assert.doesNotMatch(error.message, /do-not-echo/)
    return true
  })
})

test('import rejects invalid top-level shapes and absent active references', () => {
  const workspace = createFixture()
  const invalids: unknown[] = [
    null, [], 1, true, 'workspace', {},
    { ...workspace, version: '1' }, { ...workspace, version: 2 },
    { ...workspace, activeQuotationId: 'absent' },
    { ...workspace, activeQuotationId: null },
    { ...workspace, quotations: [] }, { ...workspace, quotations: null },
    { ...workspace, catalog: {} }, { ...workspace, activeQuotationId: '' },
  ]
  invalids.forEach(rejectBackup)
})

test('a stored empty workspace roundtrips without creating phantom quotation IDs', () => {
  const workspace: Workspace = { version: 1, activeQuotationId: null, quotations: [], catalog: createFixture().catalog }
  const serialized = serializeWorkspace(workspace)
  assert.deepEqual(parseWorkspace(serialized), workspace)
  const storage = createMemoryStorage(serialized)
  const loaded = loadWorkspace(storage)
  assert.equal(loaded.error, null)
  assert.equal(loaded.stored, true)
  assert.deepEqual(loaded.workspace, workspace)
  assert.equal(storage.writeCount(), 0)
  assert.equal(storage.current(), serialized)
  assert.deepEqual(saveWorkspace(storage, loaded.workspace), { ok: true, error: null })
  assert.deepEqual(parseWorkspace(storage.current() ?? ''), workspace)
})

test('import rejects invalid row, catalogue, currency and price-state shapes', () => {
  const workspace = createFixture()
  const quotation = workspace.quotations[0]
  const row = quotation.rows[0]
  const item = workspace.catalog[0]
  const invalidQuotations: unknown[] = [
    { ...quotation, currency: 'EUR' }, { ...quotation, rows: {} },
    { ...quotation, title: null }, { ...quotation, notes: 0 },
    ...[
      { ...row, section: 'other' }, { ...row, priceState: 'free' },
      { ...row, unitPrice: 0 }, { ...row, quantity: 1 },
      { ...row, detail: null }, { ...row, concept: undefined },
    ].map((invalidRow) => ({ ...quotation, rows: [invalidRow] })),
  ]
  invalidQuotations.forEach((invalidQuotation) => rejectBackup({ ...workspace, quotations: [invalidQuotation] }))
  for (const invalidItem of [null, { ...item, currency: 'EUR' }, { ...item, section: 'other' }, { ...item, unitPrice: 0 }]) {
    rejectBackup({ ...workspace, catalog: [invalidItem] })
  }
})

test('import rejects duplicate identities and unsafe or overlong IDs', () => {
  const workspace = createFixture()
  const quotation = workspace.quotations[0]
  const row = quotation.rows[0]
  const item = workspace.catalog[0]
  rejectBackup({ ...workspace, quotations: [quotation, quotation] })
  rejectBackup({ ...workspace, quotations: [{ ...quotation, rows: [row, row] }] })
  rejectBackup({ ...workspace, quotations: [quotation, { ...quotation, id: 'quotation-2' }] })
  rejectBackup({ ...workspace, catalog: [item, item] })
  rejectBackup({ ...workspace, catalog: [{ ...item, id: row.id }] })
  for (const id of ['', 'with spaces', '../path', 'a'.repeat(129)]) {
    rejectBackup({ ...workspace, catalog: [{ ...item, id }] })
  }
})

test('import validates full ISO timestamps including real calendar dates', () => {
  const workspace = createFixture()
  const quotation = workspace.quotations[0]
  for (const timestamp of ['', 'yesterday', '2026-10-16', '2026-02-30T10:00:00.000Z', '2026-10-16T10:00:00Z', '2026-10-16T10:00:00.000+00:00']) {
    rejectBackup({ ...workspace, quotations: [{ ...quotation, createdAt: timestamp }] })
    rejectBackup({ ...workspace, quotations: [{ ...quotation, updatedAt: timestamp }] })
  }
})

test('import rejects excessive field and collection lengths', () => {
  const workspace = createFixture()
  const quotation = workspace.quotations[0]
  const row = quotation.rows[0]
  const item = workspace.catalog[0]
  for (const longQuotation of [
    { ...quotation, title: 'a'.repeat(501) }, { ...quotation, subtitle: 'a'.repeat(1001) },
    { ...quotation, notes: 'a'.repeat(10001) },
    { ...quotation, rows: [{ ...row, concept: 'a'.repeat(501) }] },
    { ...quotation, rows: [{ ...row, detail: 'a'.repeat(2001) }] },
    { ...quotation, rows: [{ ...row, quantity: '1'.repeat(65) }] },
    { ...quotation, rows: [{ ...row, unitPrice: '1'.repeat(65) }] },
    { ...quotation, rows: Array.from({ length: 1001 }, (_, index) => ({ ...row, id: `long-row-${index}` })) },
  ]) rejectBackup({ ...workspace, quotations: [longQuotation] })
  rejectBackup({ ...workspace, quotations: Array.from({ length: 501 }, (_, index) => ({ ...quotation, id: `long-quotation-${index}`, rows: [] })) })
  rejectBackup({ ...workspace, catalog: Array.from({ length: 2001 }, (_, index) => ({ ...item, id: `long-catalog-${index}` })) })
})

test('valid collection boundaries are accepted', () => {
  const workspace = createFixture()
  const quotation = workspace.quotations[0]
  const row = quotation.rows[0]
  const item = workspace.catalog[0]
  const quotations: Quotation[] = Array.from({ length: 500 }, (_, index) => ({ ...quotation, id: `limit-quotation-${index}`, rows: [] }))
  const rows: QuotationRow[] = Array.from({ length: 1000 }, (_, index) => ({ ...row, id: `limit-row-${index}` }))
  const catalog: CatalogItem[] = Array.from({ length: 2000 }, (_, index) => ({ ...item, id: `limit-catalog-${index}` }))
  assert.equal(parseWorkspace(JSON.stringify({ ...workspace, activeQuotationId: quotations[0].id, quotations })).quotations.length, 500)
  assert.equal(parseWorkspace(JSON.stringify({ ...workspace, quotations: [{ ...quotation, rows }] })).quotations[0].rows.length, 1000)
  assert.equal(parseWorkspace(JSON.stringify({ ...workspace, catalog })).catalog.length, 2000)
})

test('backup size is limited by UTF-8 bytes as well as character count', () => {
  assert.throws(() => parseWorkspace(' '.repeat(5 * 1024 * 1024 + 1)), /límite de 5 MB/)
  assert.throws(() => parseWorkspace('á'.repeat(3 * 1024 * 1024)), /límite de 5 MB/)
  const workspace = createFixture()
  workspace.quotations[0].rows = Array.from({ length: 1000 }, (_, index) => ({
    ...workspace.quotations[0].rows[0], id: `oversized-row-${index}`, concept: '€'.repeat(500), detail: '€'.repeat(2000),
  }))
  assert.throws(() => serializeWorkspace(workspace), /límite de 5 MB/)
  const storage = createMemoryStorage('previous backup')
  assert.equal(saveWorkspace(storage, workspace).ok, false)
  assert.equal(storage.writeCount(), 0)
  assert.equal(storage.current(), 'previous backup')
})

test('duplicating regenerates quotation and row IDs while preserving price snapshots', () => {
  const original = createFixture().quotations[0]
  const before = structuredClone(original)
  const copy = duplicateQuotation(original)
  assert.notEqual(copy.id, original.id)
  assert.equal(copy.title, 'PRUEBA (copia)')
  assert.equal(copy.currency, original.currency)
  assert.equal(copy.notes, original.notes)
  assert.notEqual(copy.rows, original.rows)
  assert.equal(new Set([copy.id, ...copy.rows.map((row) => row.id)]).size, copy.rows.length + 1)
  copy.rows.forEach((row, index) => {
    assert.notEqual(row.id, original.rows[index].id)
    assert.deepEqual({ ...row, id: original.rows[index].id }, original.rows[index])
  })
  copy.rows[0].concept = 'Cambio en copia'
  copy.rows[0].unitPrice = '999,00'
  copy.rows.push({ ...copy.rows[0], id: 'new-copy-row' })
  assert.deepEqual(original, before)
  const workspace = createFixture()
  workspace.quotations.push(copy)
  assert.deepEqual(parseWorkspace(serializeWorkspace(workspace)), workspace)
})

test('catalogue edits and removal never update saved quotation prices or their copies', () => {
  const workspace = parseWorkspace(serializeWorkspace(createFixture()))
  const original = structuredClone(workspace.quotations[0])
  workspace.catalog[0].unitPrice = '125,50'
  workspace.catalog[0].detail = 'Nueva descripción del catálogo'
  assert.deepEqual(workspace.quotations[0], original)
  const copy = duplicateQuotation(workspace.quotations[0])
  workspace.quotations.push(copy)
  workspace.catalog = []
  const storage = createMemoryStorage()
  assert.equal(saveWorkspace(storage, workspace).ok, true)
  const loaded = loadWorkspace(storage)
  assert.equal(loaded.error, null)
  assert.deepEqual(loaded.workspace.quotations[0], original)
  assert.equal(loaded.workspace.quotations[1].rows[0].unitPrice, '10,50')
  loaded.workspace.quotations[1].rows[0].unitPrice = '25,00'
  assert.equal(loaded.workspace.quotations[0].rows[0].unitPrice, '10,50')
})
