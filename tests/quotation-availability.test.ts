import assert from 'node:assert/strict'
import test from 'node:test'
import { createQuotation, createRow, type CatalogItem, type Quotation } from '../src/features/quotation/model.ts'
import {
  describeCatalogAvailability, getAvailabilityRefreshDelay, getNextAvailabilityBoundary,
  getRowAvailabilityItem, inspectQuotationAvailability,
} from '../src/features/quotation/quotation-availability.ts'
import { rowFromCatalog } from '../src/features/quotation/row-provenance.ts'

const checkedAt = '2026-10-17T10:00:00.000Z'
const validUntil = '2026-10-17T10:15:00.000Z'
const now = Date.parse('2026-10-17T10:05:00.000Z')
const source = { document: 'Synthetic private snapshot', date: null, version: 'synthetic-1', checksum: 'a'.repeat(64) }

function item(quantity: number | null = 3, historical = false): CatalogItem {
  return {
    id: 'catalog-1', concept: 'Synthetic speaker', detail: '', section: 'equipment', currency: 'ARS', unitPrice: '',
    supplier: 'Synthetic Supplier', sku: 'TEST-1', source,
    availabilityPolicy: historical ? 'historical-positive' : 'fresh-positive',
    listPrice: { amount: '100', currency: 'ARS', basis: 'retail-list-before-discount', provisional: historical, source },
    stock: historical ? { quantity, checkedAt: null, validUntil: null, observation: 'historical', source }
      : { quantity, checkedAt, validUntil, source },
  }
}

function quotation(selected: CatalogItem = item()): Quotation {
  const quotation = createQuotation()
  quotation.rows = [rowFromCatalog(selected, 'equipment', 'ARS', undefined, now)]
  quotation.exchangeRate = '1500'
  quotation.exchangeRateMode = 'frozen'
  return quotation
}

test('quotation availability uses the stored observation without pretending a missing catalogue is live', () => {
  const historical = quotation(item(3, true))
  assert.deepEqual(inspectQuotationAvailability(historical, [], now), { issues: [], hasProvisional: true })
  const current = quotation()
  assert.deepEqual(inspectQuotationAvailability(current, [], now), { issues: [], hasProvisional: false })
  assert.match(inspectQuotationAvailability(current, [], Date.parse(validUntil)).issues[0], /Fila 1.*venció/)
  const before = structuredClone(current)
  inspectQuotationAvailability(current, [item(0)], now)
  assert.deepEqual(current, before)
})

test('latest matching catalogue availability blocks zero, negative, unknown and explicitly quarantined products', () => {
  const quote = quotation(item(3, true))
  for (const [quantity, expected] of [[0, /cero/], [-2, /negativo/], [null, /verificable/]] as const) {
    const result = inspectQuotationAvailability(quote, [item(quantity, true)], now)
    assert.equal(result.issues.length, 1)
    assert.match(result.issues[0], expected)
  }
  assert.match(inspectQuotationAvailability(quote, [{ ...item(3, true), selectionBlock: 'Conflicting source rows' }], now).issues[0], /Conflicting source rows/)
  assert.match(inspectQuotationAvailability(quote, [{ ...item(3, true), stock: undefined }], now).issues[0], /verificable/)
  assert.match(inspectQuotationAvailability(quote, [{ ...item(3, true), availabilityPolicy: undefined, stock: undefined }], now).issues[0], /verificable/)
  assert.equal(quote.rows[0].unitPrice, '100')
  assert.equal(quote.exchangeRate, '1500')
})

test('matching prioritizes stable identity and falls back to an unambiguous normalized supplier and SKU', () => {
  const quote = quotation()
  const otherIdentity = { ...item(0), id: 'new-catalog-id', supplier: ' synthetic   SUPPLIER ', sku: ' test-1 ' }
  assert.equal(inspectQuotationAvailability(quote, [otherIdentity], now).issues.length, 1)
  assert.equal(inspectQuotationAvailability(quote, [{ ...otherIdentity, supplier: 'Other Supplier' }], now).issues.length, 0)
  assert.equal(inspectQuotationAvailability(quote, [otherIdentity, item(3)], now).issues.length, 0)
  const ambiguous = inspectQuotationAvailability(quote, [otherIdentity, { ...otherIdentity, id: 'third-id' }], now)
  assert.match(ambiguous.issues[0], /ambiguas/)
})

test('independent manual rows ignore stock policies but explicit source blocks remain effective', () => {
  const selected = { ...item(0), availabilityPolicy: undefined }
  const quote = quotation(selected)
  assert.deepEqual(inspectQuotationAvailability(quote, [item(0)], now), { issues: [], hasProvisional: false })
  quote.rows.push({ ...createRow('extras'), concept: 'Synthetic labour', unitPrice: '50', priceState: 'priced' })
  assert.equal(inspectQuotationAvailability(quote, [item(0)], now).issues.length, 0)
  assert.equal(getRowAvailabilityItem(quote.rows[1]), undefined)
  assert.match(inspectQuotationAvailability(quote, [{ ...item(0), selectionBlock: 'Manual selection source conflict' }], now).issues[0], /source conflict/)
  quote.rows[0].provenance!.selectionBlock = 'Stored quarantine'
  assert.match(inspectQuotationAvailability(quote, [item(3)], now).issues[0], /Stored quarantine/)
})

test('issue numbering follows the visible nonempty category and section order including included rows', () => {
  const quote = quotation()
  const equipment = quote.rows[0]
  const extras = { ...rowFromCatalog(item(), 'extras', 'ARS', undefined, now), id: 'extras-row', priceState: 'included' as const }
  quote.rows = [extras, createRow(), equipment]
  const result = inspectQuotationAvailability(quote, [item(0)], now)
  assert.equal(result.issues.length, 2)
  assert.match(result.issues[0], /^Fila 1:/)
  assert.match(result.issues[1], /^Fila 2:/)
  assert.match(result.issues[0], /cero/)
  assert.match(result.issues[1], /cero/)
})

test('provisional price warnings persist even when a newer stock observation is currently valid', () => {
  const quote = quotation(item(3, true))
  const inspected = inspectQuotationAvailability(quote, [item(4)], now)
  assert.deepEqual(inspected, { issues: [], hasProvisional: true })
  const manualPrice = quotation({ ...item(3, true), unitPrice: '150' })
  assert.equal(inspectQuotationAvailability(manualPrice, [], now).hasProvisional, true)
})

test('stock descriptions distinguish quantity, age, provisional approval and unknown commercial date', () => {
  const historical = describeCatalogAvailability(item(3, true), now)
  assert.equal(historical.quantityLabel, 'Stock registrado: 3')
  assert.equal(historical.ageLabel, 'Histórico')
  assert.equal(historical.selectionLabel, 'Disponibilidad a confirmar')
  assert.match(historical.sourceDateLabel, /no informada/)
  assert.equal(historical.provisional, true)
  assert.equal(historical.blocked, false)
  assert.equal(describeCatalogAvailability(item(null, true), now).quantityLabel, 'Stock no informado')
  assert.match(describeCatalogAvailability(item(-2, true), now).quantityLabel, /-2.*negativo/)
  for (const quantity of [null, 0, -2]) assert.equal(describeCatalogAvailability(item(quantity, true), now).blocked, true)
  assert.equal(describeCatalogAvailability(item(3), Date.parse(validUntil)).ageLabel, 'Observación vencida')
  assert.equal(describeCatalogAvailability({ ...item(), source: { ...source, date: '2026-02' } }, now).sourceDateLabel, 'Fecha comercial de fuente: 2026-02')
})

test('next availability boundaries respect future observations, expiry, historical dates and do not spin on past instants', () => {
  assert.equal(getNextAvailabilityBoundary([item()], [], now), Date.parse(validUntil))
  assert.equal(getNextAvailabilityBoundary([item()], [], Date.parse(checkedAt) - 1), Date.parse(checkedAt))
  assert.equal(getNextAvailabilityBoundary([item()], [], Date.parse(checkedAt)), Date.parse(validUntil))
  assert.equal(getNextAvailabilityBoundary([item()], [], Date.parse(validUntil)), null)
  assert.equal(getNextAvailabilityBoundary([item()], [], Date.parse(validUntil) + 1), null)
  assert.equal(getNextAvailabilityBoundary([item()], [], Number.NaN), null)
  assert.equal(getNextAvailabilityBoundary([item(3, true)], [], now), null)
  assert.equal(getNextAvailabilityBoundary([], quotation().rows, now), Date.parse(validUntil))
  assert.equal(getNextAvailabilityBoundary([item(3, true)], quotation().rows, now), null)
  const futureHistorical = { ...item(3, true), stock: { ...item(3, true).stock!, checkedAt, validUntil } }
  assert.equal(getNextAvailabilityBoundary([futureHistorical], [], Date.parse(checkedAt) - 1), Date.parse(checkedAt))
  assert.equal(getNextAvailabilityBoundary([futureHistorical], [], now), null)
})

test('refresh scheduling is capped at one minute and wakes exactly at the next future validity boundary', () => {
  assert.equal(getAvailabilityRefreshDelay([], [], now), 60_000)
  assert.equal(getAvailabilityRefreshDelay([item()], [], now), 60_000)
  assert.equal(getAvailabilityRefreshDelay([item()], [], Date.parse(validUntil) - 25), 25)
  assert.equal(getAvailabilityRefreshDelay([item()], [], Date.parse(validUntil)), 60_000)
  assert.equal(getAvailabilityRefreshDelay([item()], [], Date.parse(checkedAt) - 1), 1)
})

test('legacy supplier provenance remains controlled and can use an explicitly approved replacement observation', () => {
  const quote = quotation()
  const provenance = quote.rows[0].provenance!
  provenance.supplier = 'Instaler'
  delete provenance.availabilityPolicy
  delete provenance.stock
  const legacy = { ...item(), supplier: 'Instaler', availabilityPolicy: undefined, stock: undefined }
  assert.match(inspectQuotationAvailability(quote, [legacy], now).issues[0], /verificable/)
  assert.match(inspectQuotationAvailability(quote, [], now).issues[0], /verificable/)
  const approved = { ...item(3, true), supplier: 'Instaler' }
  assert.deepEqual(inspectQuotationAvailability(quote, [approved], now), { issues: [], hasProvisional: true })
  assert.equal(getRowAvailabilityItem(quote.rows[0], [])?.availabilityPolicy, 'fresh-positive')
})

test('an explicitly included source product keeps valid zero pricing after clearing the manual row amount', () => {
  const selected = { ...item(3, true), listPrice: undefined, unitPrice: '100' }
  const quote = quotation(selected)
  quote.rows[0].priceState = 'included'
  quote.rows[0].unitPrice = ''
  assert.deepEqual(inspectQuotationAvailability(quote, [selected], now), { issues: [], hasProvisional: true })
  assert.equal(quote.rows[0].unitPrice, '')
  assert.equal(quote.rows[0].provenance!.originalUnitPrice, '100')
  const pending = describeCatalogAvailability({ ...selected, unitPrice: '' }, now)
  assert.equal(pending.blocked, true)
  assert.match(pending.selectionLabel, /Precio de venta pendiente/)
})
