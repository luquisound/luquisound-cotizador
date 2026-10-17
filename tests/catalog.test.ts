import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyCatalogImport, buildCatalogImportPreview, CATALOG_IMPORT_MAX_BYTES, CATALOG_REPLACEMENT_MAX_DOCUMENTS,
  getCatalogCategories, getCatalogChoices, getCatalogDefaultCurrency, parseCatalogImport, queryCatalog,
} from '../src/features/quotation/catalog.ts'
import type {
  CatalogEntry, CatalogImportDocument, CatalogImportItem, CatalogReferencePrice,
  CatalogSource,
} from '../src/features/quotation/catalog.ts'
import type { CatalogStockSnapshot } from '../src/features/quotation/catalog-stock.ts'

function item(changes: Partial<CatalogImportItem> = {}): CatalogImportItem {
  return {
    supplier: 'Synthetic Supplier', sku: 'TEST-001', brand: 'Example Brand', name: 'Example speaker',
    description: 'Synthetic data only', category: 'Audio', section: 'equipment',
    source: { document: 'synthetic-source.pdf', page: 1, date: '2024-02-29' },
    referencePrices: [{ amount: '15.123456', currency: 'USD', role: 'list', date: null, historical: true }],
    ...changes,
  }
}

function document(items: CatalogImportItem[] = [item()]): CatalogImportDocument {
  return { format: 'luquisound.catalog', version: 1, items }
}

function replacement(items: CatalogImportItem[] = [item()], sources = ['synthetic-source.pdf']): CatalogImportDocument {
  return { ...document(items), replaceSourceDocuments: sources }
}

function stock(quantity: number | null = 3): CatalogStockSnapshot {
  return {
    quantity, checkedAt: '2026-10-17T15:00:00.000Z', validUntil: '2026-10-17T16:00:00.000Z',
    source: { document: 'synthetic-stock-source', sheet: 'Products', row: 12, date: null },
  }
}

function parse(value: unknown): CatalogImportDocument {
  return parseCatalogImport(JSON.stringify(value))
}

function entries(items: CatalogImportItem[] = [item()]): CatalogEntry[] {
  return applyCatalogImport([], buildCatalogImportPreview([], document(items)), { allowUpdates: false })
}

function referencesWithSource(prices: CatalogReferencePrice[], source: CatalogSource | undefined): CatalogReferencePrice[] {
  return prices.map((price) => ({ ...price, ...(source && !price.source ? { source } : {}) }))
}

function normalizedDocument(input: CatalogImportDocument): CatalogImportDocument {
  return { ...input, items: input.items.map((item) => ({
    ...item, referencePrices: referencesWithSource(item.referencePrices, item.source),
  })) }
}

test('private imports retain provenance and exact historical references without setting a sale price', () => {
  const parsed = parse(document())
  assert.deepEqual(parsed, normalizedDocument(document()))
  assert.deepEqual(parseCatalogImport(`\ufeff${JSON.stringify(document())}`), parsed)
  const [entry] = entries()
  assert.equal(entry.unitPrice, '')
  assert.equal(entry.currency, 'ARS')
  assert.equal(entry.concept, 'Example speaker')
  assert.deepEqual(entry.referencePrices, referencesWithSource(item().referencePrices, item().source))
  assert.deepEqual(entry.source, item().source)
  assert.match(entry.id, /^[a-zA-Z0-9_-]+$/)
})

test('spreadsheet provenance and factual units remain separate from customer-visible descriptions', () => {
  const input = item({
    source: { document: 'synthetic-source.xlsx', sheet: 'Example sheet', row: 12, date: null },
    unit: 'pair', presentation: 'Two units',
  })
  const [entry] = entries([input])
  assert.deepEqual(entry.source, input.source)
  assert.equal(entry.unit, 'pair')
  assert.equal(entry.presentation, 'Two units')
  assert.equal(entry.detail, 'Synthetic data only')
  assert.doesNotMatch(entry.detail, /source.xlsx|Example sheet/)
})

test('source and reference dates retain month-only precision without inventing a day', () => {
  const incoming = item({
    source: { document: 'synthetic.pdf', date: '2026-03' },
    referencePrices: [{ ...item().referencePrices[0], date: '2026-02' }],
  })
  const parsed = parse(document([incoming]))
  assert.equal(parsed.items[0].source?.date, '2026-03')
  assert.equal(parsed.items[0].referencePrices[0].date, '2026-02')
})

test('names-only catalogues default optional text and references without inventing provenance', () => {
  const parsed = parse({
    format: 'luquisound.catalog', version: 1,
    items: [{ name: '  Example service  ', section: 'extras' }],
  })
  assert.deepEqual(parsed.items, [{
    supplier: '', sku: '', brand: '', name: 'Example service', description: '', category: '',
    section: 'extras', referencePrices: [],
  }])
  const preview = buildCatalogImportPreview([], parsed)
  assert.equal(preview.summary.withoutKey, 1)
  assert.equal(preview.additions[0].source, undefined)
  assert.equal(preview.additions[0].unitPrice, '')
})

test('unknown fields including imported IDs and current prices are discarded at every boundary', () => {
  const input = {
    ...document(), privateUnknown: 'discard', items: [{
      ...item(), id: 'external-id', unitPrice: '9999', currency: 'USD', extra: 'discard',
      source: { ...item().source, extra: 'discard' },
      referencePrices: item().referencePrices.map((price) => ({ ...price, extra: 'discard' })),
    }],
  }
  const parsed = parse(input)
  assert.deepEqual(parsed, normalizedDocument(document()))
  const preview = buildCatalogImportPreview([], parsed)
  assert.notEqual(preview.additions[0].id, 'external-id')
  assert.equal(preview.additions[0].unitPrice, '')
  assert.equal(preview.additions[0].currency, 'ARS')
  const prototypeText = JSON.stringify(input).replace('"version":1,', '"version":1,"__proto__":{"polluted":true},')
  assert.equal(Object.hasOwn(parseCatalogImport(prototypeText), '__proto__'), false)
})

test('missing references, explicit zero and unknown currency remain distinct', () => {
  const references: CatalogReferencePrice[] = [
    { amount: null, currency: 'USD', role: 'unknown', date: null, historical: true },
    { amount: '0', currency: 'ARS', role: 'sale', date: '2024-01-01', historical: true },
    { amount: '0.000000', currency: null, role: 'cost', date: null, historical: true },
  ]
  const [entry] = entries([item({ referencePrices: references })])
  assert.deepEqual(entry.referencePrices, referencesWithSource(references, item().source))
  assert.equal(entry.unitPrice, '')
})

test('malformed JSON errors never reproduce private content', () => {
  assert.throws(() => parseCatalogImport('{"private":"do-not-echo"'), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /formato válido de Luquisound/)
    assert.doesNotMatch(error.message, /do-not-echo/)
    return true
  })
})

test('unsupported shapes, versions, sections and blank names are rejected', () => {
  const invalids: unknown[] = [null, [], {}, { ...document(), format: 'other' },
    { ...document(), version: 2 }, { ...document(), items: null },
    { ...document(), items: [null] }, { ...document(), items: [{ name: '   ', section: 'equipment' }] },
    { ...document(), items: [{ name: 'Example', section: 'other' }] },
    { ...document(), items: [{ name: 'Example' }] },
  ]
  for (const invalid of invalids) assert.throws(() => parse(invalid), /formato válido/)
})

test('reference amounts use nonnegative exact decimal strings with six decimal places at most', () => {
  const badAmounts: unknown[] = ['', 0, -1, '1,25', '1.000,00', '-1', '+1', '01', '.5', '1.',
    'NaN', 'Infinity', '1e2', '1.1234567', '1000000000000000000']
  for (const amount of badAmounts) {
    assert.throws(() => parse(document([{
      ...item(), referencePrices: [{ ...item().referencePrices[0], amount }],
    } as CatalogImportItem])), /formato válido/)
  }
  for (const amount of ['0', '0.000001', '999999999999999999.999999']) {
    assert.equal(parse(document([item({
      referencePrices: [{ amount, currency: null, role: 'unknown', historical: true, date: null }],
    })])).items[0].referencePrices[0].amount, amount)
  }
})

test('invalid reference currencies, roles and nonhistorical prices are rejected', () => {
  for (const change of [
    { currency: 'EUR' }, { currency: '' }, { currency: 0 }, { role: 'retail' },
    { role: null }, { historical: false }, { historical: 'true' }, { amount: undefined },
  ]) {
    assert.throws(() => parse(document([{ ...item(), referencePrices: [{
      ...item().referencePrices[0], ...change,
    }] } as CatalogImportItem])), /formato válido/)
  }
})

test('calendar dates and source page boundaries are validated without accepting timestamps', () => {
  for (const invalid of ['2023-02-29', '2024-02-30', '2024-13-01', '2024-01-00',
    '2024-1-01', '2024-00', '2024-13', '2024-1', '2024-01-01T00:00:00Z', '', 20240101]) {
    assert.throws(() => parse({ ...document(), items: [{ ...item(), source: {
      document: 'synthetic.pdf', date: invalid,
    } }] }), /formato válido/)
    assert.throws(() => parse({ ...document(), items: [{ ...item(), referencePrices: [{
      ...item().referencePrices[0], date: invalid,
    }] }] }), /formato válido/)
  }
  for (const page of [0, -1, 1.5, '1', null, 1000001]) {
    assert.throws(() => parse({ ...document(), items: [{ ...item(), source: {
      document: 'synthetic.pdf', page, date: null,
    } }] }), /formato válido/)
    assert.throws(() => parse({ ...document(), items: [{ ...item(), source: {
      document: 'synthetic.xlsx', row: page, date: null,
    } }] }), /formato válido/)
  }
  assert.throws(() => parse({ ...document(), items: [{ ...item(), source: null }] }), /formato válido/)
  assert.throws(() => parse({ ...document(), items: [{ ...item(), source: { document: '', date: null } }] }), /formato válido/)
  assert.throws(() => parse({ ...document(), items: [{ ...item(), source: { document: 'synthetic.pdf' } }] }), /formato válido/)
})

test('field, reference count, item count and UTF-8 byte limits are enforced', () => {
  for (const [field, limit] of [
    ['name', 500], ['description', 2000], ['supplier', 200], ['sku', 128], ['brand', 200], ['category', 200],
    ['unit', 200], ['presentation', 200],
  ] as const) {
    assert.throws(() => parse(document([item({ [field]: 'X'.repeat(limit + 1) })])), /formato válido/)
  }
  assert.throws(() => parse(document([item({ source: { document: 'X'.repeat(501), date: null } })])), /formato válido/)
  assert.throws(() => parse(document([item({ source: { document: 'synthetic.xlsx', sheet: 'X'.repeat(129), date: null } })])), /formato válido/)
  assert.throws(() => parse(document([item({ referencePrices: Array.from({ length: 51 }, () => item().referencePrices[0]) })])), /formato válido/)
  assert.throws(() => parse(document(Array.from({ length: 2001 }, () => item()))), /formato válido/)
  const oversized = JSON.stringify({ ...document([]), padding: 'é'.repeat(CATALOG_IMPORT_MAX_BYTES / 2) })
  assert.ok(oversized.length < CATALOG_IMPORT_MAX_BYTES)
  assert.throws(() => parseCatalogImport(oversized), /límite de 5 MB/)
})

test('identical keyed rows are deduplicated and repeated keyed imports are idempotent', () => {
  const incoming = document([item(), item({ supplier: '  SYNTHETIC   SUPPLIER ', sku: ' test-001 ' })])
  const first = buildCatalogImportPreview([], incoming)
  assert.equal(first.summary.additions, 1)
  assert.equal(first.summary.duplicateRows, 1)
  assert.equal(first.summary.conflicts, 0)
  const existing = applyCatalogImport([], first, { allowUpdates: false })
  const second = buildCatalogImportPreview(existing, incoming)
  assert.equal(second.summary.additions, 0)
  assert.equal(second.summary.updates, 0)
  assert.equal(second.summary.unchanged, 1)
  assert.deepEqual(applyCatalogImport(existing, second, { allowUpdates: true }), existing)
})

test('identical repeated references are deduplicated on first import and remain idempotent', () => {
  const reference = item().referencePrices[0]
  const incoming = document([item({ referencePrices: [reference, { ...reference }] })])
  const existing = applyCatalogImport([], buildCatalogImportPreview([], incoming), { allowUpdates: false })
  assert.equal(existing[0].referencePrices?.length, 1)
  const repeated = buildCatalogImportPreview(existing, incoming)
  assert.equal(repeated.summary.unchanged, 1)
  assert.equal(repeated.summary.updates, 0)
})

test('matching retains leading zeroes and punctuation and never deduplicates by product name', () => {
  const preview = buildCatalogImportPreview([], document([
    item({ sku: '001' }), item({ sku: '1' }), item({ sku: '00-1' }), item({ supplier: 'Another synthetic supplier' }),
  ]))
  assert.equal(preview.summary.additions, 4)
  assert.equal(preview.summary.conflicts, 0)
})

test('conflicting incoming keys are visible and skipped rather than choosing the last price or name', () => {
  const existing = entries()
  const original = structuredClone(existing)
  const preview = buildCatalogImportPreview(existing, document([
    item({ name: 'Changed A' }), item({ name: 'Changed B' }), item({ sku: 'TEST-002' }),
  ]))
  assert.equal(preview.summary.conflicts, 1)
  assert.equal(preview.summary.updates, 0)
  assert.deepEqual(preview.conflicts[0].itemIndexes, [0, 1])
  assert.equal(preview.conflicts[0].reason, 'duplicate-import-key')
  const applied = applyCatalogImport(existing, preview, { allowUpdates: true })
  assert.equal(applied.length, 2)
  assert.deepEqual(applied[0], original[0])
  assert.deepEqual(existing, original)
})

test('ambiguous duplicate keys already in the catalogue are not overwritten', () => {
  const existing = entries()
  existing.push({ ...existing[0], id: 'second-identity' })
  const preview = buildCatalogImportPreview(existing, document([item({ name: 'Changed' })]))
  assert.equal(preview.conflicts[0].reason, 'duplicate-existing-key')
  assert.equal(preview.updates.length, 0)
  assert.deepEqual(applyCatalogImport(existing, preview, { allowUpdates: true }), existing)
})

test('updates require explicit approval and preserve approved price, currency and identity', () => {
  const existing = entries()
  existing[0].unitPrice = '125,50'
  existing[0].currency = 'USD'
  const original = structuredClone(existing)
  const preview = buildCatalogImportPreview(existing, document([
    item({ name: 'Updated synthetic speaker', description: 'New detail' }), item({ sku: 'TEST-002' }),
  ]))
  assert.equal(preview.summary.updates, 1)
  const denied = applyCatalogImport(existing, preview, { allowUpdates: false })
  assert.deepEqual(denied[0], original[0])
  assert.equal(denied.length, 2)
  const allowed = applyCatalogImport(existing, preview, { allowUpdates: true })
  assert.equal(allowed[0].id, original[0].id)
  assert.equal(allowed[0].unitPrice, '125,50')
  assert.equal(allowed[0].currency, 'USD')
  assert.equal(allowed[0].concept, 'Updated synthetic speaker')
  assert.equal(allowed[0].detail, 'New detail')
  assert.deepEqual(existing, original)
  assert.notEqual(allowed[0], existing[0])
  assert.notEqual(allowed[0].referencePrices, existing[0].referencePrices)
})

test('updates preserve explicit approved zero and accumulate distinct historical references', () => {
  const existing = entries()
  existing[0].unitPrice = '0'
  const zero: CatalogReferencePrice = { amount: '0', currency: 'ARS', role: 'cost', date: null, historical: true }
  const missing: CatalogReferencePrice = { amount: null, currency: null, role: 'unknown', date: null, historical: true }
  const incoming = document([item({ source: undefined, referencePrices: [zero, missing] })])
  const result = applyCatalogImport(existing, buildCatalogImportPreview(existing, incoming), { allowUpdates: true })
  assert.equal(result[0].unitPrice, '0')
  assert.deepEqual(result[0].source, existing[0].source)
  assert.deepEqual(result[0].referencePrices, [...existing[0].referencePrices!, zero, missing])
  assert.equal(buildCatalogImportPreview(result, incoming).summary.unchanged, 1)
})

test('equal historical prices from separate documents keep both sources and reimport idempotently', () => {
  const first = item({ source: { document: 'synthetic-first.pdf', page: 2, date: '2024-01' } })
  const existing = entries([first])
  const second = item({ source: { document: 'synthetic-second.xlsx', sheet: 'Example', row: 3, date: null } })
  const incoming = document([second])
  const preview = buildCatalogImportPreview(existing, incoming)
  assert.equal(preview.updates.length, 1)
  const result = applyCatalogImport(existing, preview, { allowUpdates: true })
  assert.equal(result[0].referencePrices?.length, 2)
  assert.deepEqual(result[0].referencePrices?.map((price) => price.source), [first.source, second.source])
  assert.equal(result[0].referencePrices?.[0].amount, result[0].referencePrices?.[1].amount)
  assert.deepEqual(result[0].source, second.source)
  assert.deepEqual(existing[0].source, first.source)
  const repeated = buildCatalogImportPreview(result, incoming)
  assert.equal(repeated.summary.unchanged, 1)
  assert.equal(repeated.summary.updates, 0)
})

test('an explicit reference source takes precedence and absent provenance stays absent', () => {
  const explicitSource: CatalogSource = { document: 'synthetic-reference.pdf', page: 5, date: null }
  const parsed = parse(document([item({ referencePrices: [{
    ...item().referencePrices[0], source: explicitSource,
  }] })]))
  assert.deepEqual(parsed.items[0].referencePrices[0].source, explicitSource)
  assert.deepEqual(parsed.items[0].source, item().source)
  const missing = parse(document([item({ source: undefined })]))
  assert.equal(missing.items[0].source, undefined)
  assert.equal(missing.items[0].referencePrices[0].source, undefined)
})

test('updating old references never assigns an unknown historical source from the current item', () => {
  const existing = entries()
  delete existing[0].referencePrices![0].source
  const incoming = document([item({ source: { document: 'synthetic-new.pdf', date: '2026-03' } })])
  const result = applyCatalogImport(existing, buildCatalogImportPreview(existing, incoming), { allowUpdates: true })
  assert.equal(result[0].referencePrices?.length, 2)
  assert.equal(result[0].referencePrices?.[0].source, undefined)
  assert.equal(result[0].referencePrices?.[1].source?.document, 'synthetic-new.pdf')
})

test('reference provenance is deeply copied rather than shared by document, preview and catalogue', () => {
  const incoming = document()
  const existing = entries()
  const original = structuredClone(existing)
  const preview = buildCatalogImportPreview(existing, document([item({ name: 'Updated example' })]))
  const result = applyCatalogImport(existing, preview, { allowUpdates: true })
  result[0].referencePrices![0].source!.document = 'synthetic-edited.pdf'
  assert.deepEqual(existing, original)
  assert.equal(preview.updates[0].after.referencePrices?.[0].source?.document, 'synthetic-source.pdf')
  const parsed = parse(incoming)
  parsed.items[0].source!.document = 'synthetic-other.pdf'
  assert.equal(parsed.items[0].referencePrices[0].source?.document, 'synthetic-source.pdf')
  assert.equal(incoming.items[0].source?.document, 'synthetic-source.pdf')
})

test('reference provenance uses the same strict source validator and field whitelist', () => {
  for (const invalidSource of [null, {}, { document: 'synthetic.pdf', date: '2024-13' },
    { document: 'synthetic.pdf', page: 0, date: null }, { document: 'X'.repeat(501), date: null }]) {
    assert.throws(() => parse({ ...document(), items: [{ ...item(), referencePrices: [{
      ...item().referencePrices[0], source: invalidSource,
    }] }] }), /formato válido/)
  }
  const parsed = parse({ ...document(), items: [{ ...item(), referencePrices: [{
    ...item().referencePrices[0], source: { document: 'synthetic.pdf', date: null, unknown: 'discard' },
  }] }] })
  assert.deepEqual(parsed.items[0].referencePrices[0].source, { document: 'synthetic.pdf', date: null })
})

test('incomplete extracted descriptions never erase known optional metadata during updates', () => {
  const existing = entries([item({ unit: 'pair', presentation: 'Two units' })])
  const incoming = document([item({
    description: '', brand: '', category: '', unit: '', presentation: undefined,
    source: undefined, referencePrices: [{
      amount: '20', currency: 'ARS', role: 'list', date: '2026-03', historical: true,
    }],
  })])
  const preview = buildCatalogImportPreview(existing, incoming)
  assert.equal(preview.updates.length, 1)
  const result = applyCatalogImport(existing, preview, { allowUpdates: true })
  assert.equal(result[0].detail, existing[0].detail)
  assert.equal(result[0].brand, existing[0].brand)
  assert.equal(result[0].category, existing[0].category)
  assert.equal(result[0].unit, 'pair')
  assert.equal(result[0].presentation, 'Two units')
  assert.deepEqual(result[0].source, existing[0].source)
  assert.equal(buildCatalogImportPreview(result, incoming).summary.unchanged, 1)
})

test('excess accumulated references are a conflict and do not truncate price history', () => {
  const existing = entries([item({ referencePrices: Array.from({ length: 50 }, (_, index) => ({
    amount: String(index), currency: 'ARS', role: 'list', date: null, historical: true,
  })) })])
  const preview = buildCatalogImportPreview(existing, document())
  assert.equal(preview.conflicts[0].reason, 'reference-limit')
  assert.equal(preview.updates.length, 0)
  assert.deepEqual(applyCatalogImport(existing, preview, { allowUpdates: true }), existing)
})

test('incomplete supplier/SKU keys never overwrite a name match and are reported', () => {
  const noKey = item({ supplier: '', sku: '' })
  const existing = entries([noKey])
  const preview = buildCatalogImportPreview(existing, document([noKey, noKey]))
  assert.equal(preview.summary.withoutKey, 2)
  assert.equal(preview.summary.duplicateRows, 1)
  assert.equal(preview.summary.additions, 1)
  assert.equal(preview.summary.updates, 0)
  assert.equal(applyCatalogImport(existing, preview, { allowUpdates: false }).length, 2)
})

test('an import preview cannot silently overwrite catalogue edits made after it opened', () => {
  const existing = entries()
  const preview = buildCatalogImportPreview(existing, document([item({ name: 'Changed' })]))
  existing[0].unitPrice = '101'
  assert.throws(() => applyCatalogImport(existing, preview, { allowUpdates: true }), /cambió desde la vista previa/)
  assert.equal(existing[0].unitPrice, '101')
})

test('combined catalogue count and byte limits reject atomically without modifying current entries', () => {
  const existing = entries(Array.from({ length: 2000 }, (_, index) => item({ sku: `TEST-${index}` })))
  const preview = buildCatalogImportPreview(existing, document([item({ sku: 'NEW' })]))
  assert.throws(() => applyCatalogImport(existing, preview, { allowUpdates: false }), /2000 productos/)
  assert.equal(existing.length, 2000)
  const large = Array.from({ length: 1900 }, (_, index): CatalogEntry => ({
    id: `entry-${index}`, concept: 'X'.repeat(500), detail: 'X'.repeat(2000), section: 'equipment',
    currency: 'ARS', unitPrice: '', supplier: 'X'.repeat(200), sku: `SKU-${index}`,
  }))
  const largePreview = buildCatalogImportPreview(large, document([item()]))
  assert.throws(() => applyCatalogImport(large, largePreview, { allowUpdates: false }), /límite de 5 MB/)
  assert.equal(large.length, 1900)
})

test('replacement manifests are optional, bounded, trimmed and unique without normalizing document identities', () => {
  assert.equal(parse(document()).replaceSourceDocuments, undefined)
  assert.deepEqual(parse(replacement([], [' synthetic-first.xlsx ', 'Synthetic-first.xlsx'])).replaceSourceDocuments,
    ['synthetic-first.xlsx', 'Synthetic-first.xlsx'])
  assert.equal(parse(replacement([], Array.from({ length: CATALOG_REPLACEMENT_MAX_DOCUMENTS }, (_, index) =>
    `synthetic-${index}.xlsx`))).replaceSourceDocuments?.length, CATALOG_REPLACEMENT_MAX_DOCUMENTS)
  for (const invalid of [null, 'synthetic.xlsx', [], [''], ['   '], [12], ['X'.repeat(501)],
    ['synthetic.xlsx', ' synthetic.xlsx '],
    Array.from({ length: CATALOG_REPLACEMENT_MAX_DOCUMENTS + 1 }, (_, index) => `synthetic-${index}.xlsx`)]) {
    assert.throws(() => parse({ ...document(), replaceSourceDocuments: invalid }), /formato válido/)
  }
})

test('replacement records require primary provenance and complete product keys before a preview can remove anything', () => {
  for (const changes of [{ source: undefined }, { supplier: '' }, { sku: '' }]) {
    assert.doesNotThrow(() => parse(document([item(changes)])))
    assert.throws(() => parse(replacement([item(changes)])), /formato válido/)
  }
  const existing = entries()
  const snapshot = structuredClone(existing)
  assert.throws(() => buildCatalogImportPreview(existing, replacement([item({ sku: '' })])), /formato válido/)
  assert.deepEqual(existing, snapshot)
})

test('replacement removes only absent keyed entries whose primary document exactly matches its explicit scope', () => {
  const existing = entries([
    item({ sku: 'RETIRED' }), item({ sku: 'RETAINED' }),
    item({ sku: 'UNRELATED', source: { document: 'Synthetic-source.pdf', date: null } }),
    item({ sku: 'REFERENCE-ONLY', source: undefined, referencePrices: [{
      ...item().referencePrices[0], source: item().source,
    }] }),
  ])
  const manual: CatalogEntry = {
    id: 'manual-labor', concept: 'Synthetic labor', detail: '', section: 'extras', currency: 'ARS', unitPrice: '0',
  }
  existing.push(manual)
  const snapshot = structuredClone(existing)
  const incoming = replacement([item({ supplier: ' SYNTHETIC   SUPPLIER ', sku: ' retained ', name: 'Retained product' })])
  const preview = buildCatalogImportPreview(existing, incoming)
  assert.equal(preview.replacesSources, true)
  assert.equal(preview.summary.removals, 1)
  assert.deepEqual(preview.removals, [snapshot[0]])
  assert.notEqual(preview.removals[0], existing[0])
  assert.notEqual(preview.removals[0].source, existing[0].source)
  assert.notEqual(preview.removals[0].referencePrices?.[0].source, existing[0].referencePrices?.[0].source)
  const applied = applyCatalogImport(existing, preview, { allowUpdates: true })
  assert.deepEqual(applied.map((entry) => entry.id), snapshot.slice(1).map((entry) => entry.id))
  assert.deepEqual(applied.slice(1), snapshot.slice(2))
  assert.deepEqual(existing, snapshot)
  assert.equal(buildCatalogImportPreview(applied, incoming).summary.removals, 0)
  const plain = buildCatalogImportPreview(existing, document([]))
  assert.equal(plain.replacesSources, false)
  assert.deepEqual(plain.removals, [])
  assert.deepEqual(applyCatalogImport(existing, plain, { allowUpdates: false }), snapshot)
})

test('retained scoped products replace source metadata and references while preserving all approved-price states', () => {
  const existing = entries(['A', 'B', 'C'].map((sku) => item({ sku, unit: 'pair', presentation: 'Old packaging' })))
  for (const [index, price] of ['123,45', '0', ''].entries()) {
    existing[index].unitPrice = price
    existing[index].currency = 'USD'
  }
  const snapshot = structuredClone(existing)
  const incoming = replacement(existing.map((entry) => item({
    sku: entry.sku, name: `Canonical ${entry.sku}`, description: '', brand: '', category: '',
    source: { document: 'synthetic-canonical.xlsx', sheet: 'Example', row: 7, date: null },
    referencePrices: [{ amount: '7.123456', currency: 'USD', role: 'cost', date: null, historical: true }],
  })), ['synthetic-source.pdf', 'synthetic-canonical.xlsx'])
  const preview = buildCatalogImportPreview(existing, incoming)
  const result = applyCatalogImport(existing, preview, { allowUpdates: true })
  for (const [index, entry] of result.entries()) {
    assert.equal(entry.id, snapshot[index].id)
    assert.equal(entry.unitPrice, snapshot[index].unitPrice)
    assert.equal(entry.currency, 'USD')
    assert.equal(entry.detail, '')
    assert.equal(entry.brand, '')
    assert.equal(entry.category, '')
    assert.equal(entry.unit, undefined)
    assert.equal(entry.presentation, undefined)
    assert.deepEqual(entry.source, incoming.items[index].source)
    assert.deepEqual(entry.referencePrices, referencesWithSource(incoming.items[index].referencePrices, entry.source))
    assert.notEqual(entry.source, incoming.items[index].source)
    assert.notEqual(entry.referencePrices, preview.updates[index].after.referencePrices)
  }
  assert.deepEqual(existing, snapshot)
  assert.equal(buildCatalogImportPreview(result, incoming).summary.updates, 0)
  result[0].referencePrices![0].source!.document = 'synthetic-mutated.xlsx'
  assert.equal(preview.updates[0].after.referencePrices?.[0].source?.document, 'synthetic-canonical.xlsx')
  assert.equal(incoming.items[0].source?.document, 'synthetic-canonical.xlsx')
})

test('a replacement leaves metadata outside its source scope on the existing additive update path', () => {
  const existing = entries([item({ source: { document: 'synthetic-unrelated.pdf', date: null }, unit: 'pair' })])
  const incoming = replacement([item({ description: '', referencePrices: [] })])
  const result = applyCatalogImport(existing, buildCatalogImportPreview(existing, incoming), { allowUpdates: true })
  assert.equal(result[0].detail, existing[0].detail)
  assert.equal(result[0].unit, 'pair')
  assert.deepEqual(result[0].referencePrices, existing[0].referencePrices)
})

test('source replacement cannot partially apply around conflicts, withheld approval or stale previews', () => {
  const existing = entries([item({ sku: 'RETIRED' }), item({ sku: 'RETAINED' })])
  const snapshot = structuredClone(existing)
  const conflicting = buildCatalogImportPreview(existing, replacement([
    item({ sku: 'RETAINED', name: 'First version' }), item({ sku: 'RETAINED', name: 'Conflicting version' }),
    item({ sku: 'NEW' }),
  ]))
  assert.equal(conflicting.removals.length, 1)
  assert.equal(conflicting.conflicts[0].reason, 'duplicate-import-key')
  assert.throws(() => applyCatalogImport(existing, conflicting, { allowUpdates: true }), /resolver los conflictos/)
  const approved = buildCatalogImportPreview(existing, replacement([item({ sku: 'RETAINED' })]))
  assert.throws(() => applyCatalogImport(existing, approved, { allowUpdates: false }), /aprobar todos los cambios/)
  assert.deepEqual(existing, snapshot)
  existing[1].unitPrice = '321'
  assert.throws(() => applyCatalogImport(existing, approved, { allowUpdates: true }), /cambió desde la vista previa/)
  assert.equal(existing[1].unitPrice, '321')
})

test('ambiguous scoped local keys block even an explicitly empty source replacement', () => {
  const keyed = entries()
  for (const existing of [entries([item({ supplier: '', sku: '' })]),
    [...keyed, { ...keyed[0], id: 'duplicate-local', unitPrice: '9' }]]) {
    const snapshot = structuredClone(existing)
    const preview = buildCatalogImportPreview(existing, replacement([]))
    assert.equal(preview.conflicts.length, 1)
    assert.deepEqual(preview.conflicts[0].itemIndexes, [])
    assert.equal(preview.removals.length, 0)
    assert.throws(() => applyCatalogImport(existing, preview, { allowUpdates: true }), /resolver los conflictos/)
    assert.deepEqual(existing, snapshot)
  }
})

test('replacement capacity counts 451 scoped removals before additions and validates only the resulting byte size', () => {
  const retired = entries(Array.from({ length: 451 }, (_, index) => item({ sku: `OLD-${index}` })))
  const manual = Array.from({ length: 1549 }, (_, index): CatalogEntry => ({
    id: `manual-${index}`, concept: `Synthetic manual product ${index}`, detail: '', section: 'extras',
    currency: 'ARS', unitPrice: '',
  }))
  const existing = [...retired, ...manual]
  const snapshot = structuredClone(existing)
  const incoming = replacement(Array.from({ length: 451 }, (_, index) => item({ sku: `NEW-${index}` })))
  const preview = buildCatalogImportPreview(existing, incoming)
  assert.equal(preview.summary.removals, 451)
  assert.equal(preview.summary.additions, 451)
  const result = applyCatalogImport(existing, preview, { allowUpdates: true })
  assert.equal(result.length, 2000)
  assert.deepEqual(result.slice(0, manual.length), manual)
  assert.equal(result.some((entry) => entry.sku?.startsWith('OLD-')), false)
  assert.deepEqual(existing, snapshot)
  const tooMany = buildCatalogImportPreview(existing, replacement([...incoming.items, item({ sku: 'ONE-TOO-MANY' })]))
  assert.throws(() => applyCatalogImport(existing, tooMany, { allowUpdates: true }), /2000 productos/)
  const largeExisting = [...retired, ...manual.map((entry) => ({
    ...entry, concept: 'X'.repeat(500), detail: 'X'.repeat(2000), supplier: 'X'.repeat(200),
  }))]
  const largeIncoming = replacement(incoming.items.map((entry) => ({
    ...entry, name: 'Y'.repeat(500), description: 'Y'.repeat(2000), brand: 'Y'.repeat(200), category: 'Y'.repeat(200),
  })))
  assert.ok(new TextEncoder().encode(JSON.stringify(largeExisting)).byteLength < CATALOG_IMPORT_MAX_BYTES)
  const largePreview = buildCatalogImportPreview(largeExisting, largeIncoming)
  assert.equal(largePreview.removals.length, 451)
  assert.throws(() => applyCatalogImport(largeExisting, largePreview, { allowUpdates: true }), /límite de 5 MB/)
})

test('optional stock preserves unknown and explicit zero with independent provenance and no legacy defaults', () => {
  const legacy = parse(document())
  assert.equal(Object.hasOwn(legacy.items[0], 'stock'), false)
  assert.equal(Object.hasOwn(entries()[0], 'stock'), false)
  assert.equal(Object.hasOwn(parse({ ...document(), items: [{ ...item(), stockQuantity: 0 }] }).items[0], 'stock'), false)
  for (const quantity of [null, 0, 3, Number.MAX_SAFE_INTEGER]) {
    const snapshot = stock(quantity)
    const parsed = parse(document([item({ stock: snapshot })]))
    assert.deepEqual(parsed.items[0].stock, snapshot)
    assert.notDeepEqual(parsed.items[0].stock?.source, parsed.items[0].source)
    const imported = entries([item({ stock: snapshot })])[0]
    assert.deepEqual(imported.stock, snapshot)
    assert.equal(imported.unitPrice, '')
    assert.equal(imported.stock?.source.date, null)
  }
})

test('stock import rejects invalid quantities, validity intervals and missing independent source provenance', () => {
  const valid = stock(0)
  const invalidSnapshots: unknown[] = [null, [], {},
    ...[undefined, '0', true, -1, 0.5, Number.MAX_SAFE_INTEGER + 1].map((quantity) => ({ ...valid, quantity })),
    { ...valid, checkedAt: undefined }, { ...valid, checkedAt: '2026-10-17' },
    { ...valid, checkedAt: '2026-10-17T15:00:00+00:00' },
    { ...valid, checkedAt: '2026-02-30T15:00:00.000Z' },
    { ...valid, validUntil: undefined }, { ...valid, validUntil: valid.checkedAt },
    { ...valid, validUntil: '2026-10-17T14:00:00.000Z' },
    ...[undefined, null, {}, { document: ' ', date: null },
      { document: 'synthetic-stock-source', row: 0, date: null },
      { document: 'synthetic-stock-source', date: '2026-13' }].map((source) => ({ ...valid, source })),
  ]
  for (const snapshot of invalidSnapshots) {
    assert.throws(() => parse({ ...document(), items: [{ ...item(), stock: snapshot }] }), /formato válido/)
  }
  const overflow = JSON.stringify(document([item({ stock: valid })])).replace('"quantity":0', '"quantity":1e309')
  assert.throws(() => parseCatalogImport(overflow), /formato válido/)
  const parsed = parse({ ...document(), items: [{ ...item(), stock: {
    ...valid, unknown: 'discard', source: { ...valid.source, unknown: 'discard' },
  } }] })
  assert.deepEqual(parsed.items[0].stock, valid)
})

test('stock-only changes participate in previews, matching conflicts and idempotent approved updates', () => {
  const existing = entries([item({ stock: stock(3) })])
  existing[0].unitPrice = '0'
  existing[0].currency = 'USD'
  const snapshot = structuredClone(existing)
  const changes: Partial<CatalogStockSnapshot>[] = [
    { quantity: 0 }, { quantity: null }, { checkedAt: '2026-10-17T15:01:00.000Z' },
    { validUntil: '2026-10-17T17:00:00.000Z' },
    { source: { ...stock().source, row: 13 } },
    { source: { ...stock().source, document: 'synthetic-other-stock-source' } },
  ]
  for (const change of changes) {
    const incoming = document([item({ stock: { ...stock(), ...change } })])
    const preview = buildCatalogImportPreview(existing, incoming)
    assert.equal(preview.summary.updates, 1)
    assert.deepEqual(applyCatalogImport(existing, preview, { allowUpdates: false }), snapshot)
    const result = applyCatalogImport(existing, preview, { allowUpdates: true })
    assert.equal(result[0].id, existing[0].id)
    assert.equal(result[0].unitPrice, '0')
    assert.equal(result[0].currency, 'USD')
    assert.deepEqual(result[0].stock, incoming.items[0].stock)
    assert.equal(buildCatalogImportPreview(result, incoming).summary.unchanged, 1)
    assert.deepEqual(existing, snapshot)
  }
  const conflicting = buildCatalogImportPreview(existing, replacement([
    item({ stock: stock(0) }), item({ stock: stock(3) }),
  ]))
  assert.equal(conflicting.conflicts[0].reason, 'duplicate-import-key')
  assert.throws(() => applyCatalogImport(existing, conflicting, { allowUpdates: true }), /resolver los conflictos/)
  assert.deepEqual(existing, snapshot)
})

test('ordinary stock omission preserves its exact validity while authoritative source replacement clears omission', () => {
  const existing = entries([item({ stock: stock(0) })])
  const incoming = document([item({ name: 'Updated synthetic product' })])
  const additive = applyCatalogImport(existing, buildCatalogImportPreview(existing, incoming), { allowUpdates: true })
  assert.deepEqual(additive[0].stock, stock(0))
  assert.notEqual(additive[0].stock, existing[0].stock)
  const authoritative = applyCatalogImport(existing,
    buildCatalogImportPreview(existing, replacement(incoming.items)), { allowUpdates: true })
  assert.equal(Object.hasOwn(authoritative[0], 'stock'), false)
  assert.equal(existing[0].stock?.quantity, 0)
  assert.equal(buildCatalogImportPreview(authoritative, replacement(incoming.items)).summary.unchanged, 1)
})

test('stock snapshots and source provenance are deeply isolated across input, parse, previews and applied entries', () => {
  const incoming = document([item({ stock: stock(0) })])
  const parsed = parse(incoming)
  const first = buildCatalogImportPreview([], parsed)
  const existing = applyCatalogImport([], first, { allowUpdates: false })
  existing[0].stock!.source.row = 19
  assert.equal(first.additions[0].stock?.source.row, 12)
  assert.equal(parsed.items[0].stock?.source.row, 12)
  assert.equal(incoming.items[0].stock?.source.row, 12)
  const preview = buildCatalogImportPreview(existing, document([item({ stock: stock(3) })]))
  const result = applyCatalogImport(existing, preview, { allowUpdates: true })
  result[0].stock!.source.document = 'synthetic-mutated-stock-source'
  assert.equal(existing[0].stock?.source.document, 'synthetic-stock-source')
  assert.equal(preview.updates[0].after.stock?.source.document, 'synthetic-stock-source')
  assert.equal(preview.updates[0].before.stock?.source.row, 19)
  const removal = buildCatalogImportPreview(existing, replacement([])).removals[0]
  removal.stock!.source.row = 20
  assert.equal(existing[0].stock?.source.row, 19)
})

test('search matches accents, case, code, supplier, brand and combined terms in original order', () => {
  const existing = entries([
    item({ sku: 'SYN-002', brand: 'Marca Sintética', name: 'Parlante sintético' }),
    item({ sku: 'SYN-001', name: 'Amplificador', description: 'Cuatro canales' }),
  ])
  const snapshot = structuredClone(existing)
  assert.deepEqual(queryCatalog(existing, 'SINTETICA syn-002'), [existing[0]])
  assert.deepEqual(queryCatalog(existing, 'synthetic supplier amplificador canales'), [existing[1]])
  assert.deepEqual(queryCatalog(existing, 'audio'), existing)
  assert.deepEqual(queryCatalog(existing, 'missing'), [])
  assert.deepEqual(queryCatalog(existing, '   '), existing)
  assert.notEqual(queryCatalog(existing, ''), existing)
  assert.deepEqual(existing, snapshot)
})

test('catalogues of 500 and 1600 synthetic products remain searchable without changing order', () => {
  for (const count of [500, 1600]) {
    const existing = entries(Array.from({ length: count }, (_, index) => item({
      sku: `SYN-${String(index).padStart(4, '0')}`, name: `Example product ${index}`,
    })))
    const last = existing[count - 1]
    assert.deepEqual(queryCatalog(existing, last.sku!), [last])
    assert.equal(queryCatalog(existing, 'example brand').length, count)
    assert.equal(existing[count - 1], last)
    assert.equal(new Set(existing.map((entry) => entry.id)).size, count)
  }
})

test('category options normalize whitespace and case without changing stored catalogue metadata', () => {
  const existing = entries([
    item({ sku: 'A', category: '  Example   speakers ' }),
    item({ sku: 'B', category: 'EXAMPLE SPEAKERS' }),
    item({ sku: 'C', category: 'Example amplifiers' }),
    item({ sku: 'D', category: 'Example Áudio' }),
    item({ sku: 'E', category: 'Example Audio' }),
  ])
  const original = structuredClone(existing)
  const options = getCatalogCategories(existing)
  assert.equal(options.length, 4)
  assert.deepEqual(options.find((option) => option.key === 'category:example speakers'), {
    key: 'category:example speakers', label: 'Example speakers',
  })
  assert.deepEqual(queryCatalog(existing, '', 'category:example speakers'), [existing[0], existing[1]])
  assert.deepEqual(existing, original)
})

test('uncategorized entries have a distinct key from a real category named Sin clasificar', () => {
  const existing = entries([
    item({ sku: 'A', category: '' }), item({ sku: 'B', category: '   ' }),
    item({ sku: 'C', category: 'Sin clasificar' }),
    item({ sku: 'D', category: 'Todas' }),
  ])
  delete existing[1].category
  assert.deepEqual(getCatalogCategories(existing), [
    { key: 'category:sin clasificar', label: 'Sin clasificar' },
    { key: 'category:todas', label: 'Todas' },
    { key: 'uncategorized', label: '' },
  ])
  assert.deepEqual(queryCatalog(existing, '', 'uncategorized'), [existing[0], existing[1]])
  assert.deepEqual(queryCatalog(existing, '', 'category:sin clasificar'), [existing[2]])
  assert.deepEqual(queryCatalog(existing, '', 'category:todas'), [existing[3]])
  assert.deepEqual(queryCatalog(existing, '', ''), existing)
})

test('category filters combine with SKU, brand and product search while options remain complete', () => {
  const existing = entries([
    item({ sku: 'SYN-001', brand: 'Example Brand', category: 'Example speakers' }),
    item({ sku: 'SYN-002', brand: 'Other Brand', category: 'Example speakers' }),
    item({ sku: 'SYN-003', name: 'Example amplifier', brand: 'Example Brand', category: 'Example amplifiers' }),
  ])
  const options = getCatalogCategories(existing)
  assert.deepEqual(queryCatalog(existing, 'example brand syn-001', 'category:example speakers'), [existing[0]])
  assert.deepEqual(queryCatalog(existing, 'syn-003', 'category:example speakers'), [])
  assert.deepEqual(queryCatalog(existing, 'example amplifier', 'category:example amplifiers'), [existing[2]])
  assert.equal(queryCatalog(existing, '', 'category:example speakers').length, 2)
  assert.equal(queryCatalog(existing, '', 'category:example amplifiers').length, 1)
  assert.deepEqual(getCatalogCategories(existing), options)
  assert.equal(queryCatalog(existing, '').length, 3)
  assert.deepEqual(queryCatalog(existing, '', 'category:removed'), [])
})

test('category options support empty catalogues and category removal without mutating previous results', () => {
  assert.deepEqual(getCatalogCategories([]), [])
  const existing = entries([
    item({ sku: 'A', category: 'Example speakers' }), item({ sku: 'B', category: 'Example amplifiers' }),
  ])
  const options = getCatalogCategories(existing)
  const remaining = existing.filter((entry) => entry.id !== existing[0].id)
  assert.equal(getCatalogCategories(remaining).some((option) => option.key === 'category:example speakers'), false)
  assert.equal(options.length, 2)
  assert.equal(queryCatalog(remaining, '').length, 1)
  assert.equal(existing.length, 2)
})

test('catalogue choices allow cables in extras and prefer the suggested section without changing source records', () => {
  const existing = entries([
    item({ sku: 'A', category: 'Synthetic cables', section: 'equipment' }),
    item({ sku: 'B', section: 'extras' }),
    item({ sku: 'C', section: 'equipment' }),
    item({ sku: 'D', section: 'extras' }),
  ])
  const snapshot = structuredClone(existing)
  assert.deepEqual(getCatalogChoices(existing, 'extras'), [existing[1], existing[3], existing[0], existing[2]])
  assert.deepEqual(queryCatalog(getCatalogChoices(existing, 'extras'), 'A', 'category:synthetic cables'), [existing[0]])
  assert.deepEqual(getCatalogChoices(existing, 'equipment'), [existing[0], existing[2], existing[1], existing[3]])
  assert.deepEqual(existing, snapshot)
})

test('catalogue choices include ARS and USD prices together without modifying approved values', () => {
  const existing = entries(['A', 'B', 'C', 'D'].map((sku) => item({ sku })))
  existing[1].currency = 'USD'
  existing[1].unitPrice = '   '
  existing[2].currency = 'USD'
  existing[2].unitPrice = '0'
  existing[3].unitPrice = '0'
  const snapshot = structuredClone(existing)
  assert.deepEqual(getCatalogChoices(existing, 'equipment'), existing)
  assert.deepEqual(getCatalogChoices(existing, 'extras'), existing)
  assert.deepEqual(existing, snapshot)
})

test('catalogue currency defaults use one source currency without approving its historical amount', () => {
  const [entry] = entries([item({ referencePrices: [
    { amount: '15', currency: 'USD', role: 'cost', date: null, historical: true },
    { amount: null, currency: null, role: 'unknown', date: null, historical: true },
    { amount: '20', currency: 'USD', role: 'list', date: null, historical: true },
  ] })])
  const snapshot = structuredClone(entry)
  assert.equal(getCatalogDefaultCurrency(entry), 'USD')
  assert.deepEqual(entry, snapshot)
  assert.equal(entry.unitPrice, '')
  assert.equal(entry.currency, 'ARS')
})

test('approved catalogue currency takes precedence for positive and explicit zero prices', () => {
  const [entry] = entries()
  for (const unitPrice of ['25,50', '0', ' 0 ']) {
    assert.equal(getCatalogDefaultCurrency({ ...entry, currency: 'ARS', unitPrice }), 'ARS')
  }
  assert.equal(getCatalogDefaultCurrency({ ...entry, unitPrice: '   ' }), 'USD')
})

test('ambiguous or unidentified source currencies preserve the catalogue fallback', () => {
  const [entry] = entries()
  const reference = item().referencePrices[0]
  for (const referencePrices of [
    [],
    [{ ...reference, currency: null }],
    [{ ...reference, currency: 'ARS' as const }, { ...reference, currency: 'USD' as const }],
  ]) {
    assert.equal(getCatalogDefaultCurrency({ ...entry, currency: 'ARS', referencePrices }), 'ARS')
    assert.equal(getCatalogDefaultCurrency({ ...entry, currency: 'USD', referencePrices }), 'USD')
  }
})
