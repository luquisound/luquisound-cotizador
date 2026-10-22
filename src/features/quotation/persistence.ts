import { createWorkspace } from './model.ts'
import {
  CATALOG_REFERENCE_MAX_PRICES, parseCatalogAvailabilityPolicy, parseCatalogListPrice,
  parseCatalogSelectionBlock,
} from './catalog.ts'
import { isCatalogTimestamp, parseCatalogStockFields } from './catalog-stock.ts'
import { parseRowProvenance } from './row-provenance.ts'
import { parseExchangeRate } from './exchange.ts'
import { readStoredBlueDollarQuote } from './exchange-quote.ts'
import { readAudioCategory } from './audio-categories.ts'
import { readAdapterVariant } from './adapters.ts'
import { parseFixedServiceOrigin } from './fixed-services.ts'
import { isFactoryRow, parseFactoryEquipment } from './factory-mode.ts'
import { isHarnessPresetRow, parseHarnessSelection } from './harness-preset.ts'
import { parseRowCurrencyConversionOrigin } from './row-currency.ts'
import type { CatalogItem, CatalogReferencePrice, CatalogSource, Currency, PriceState, Quotation, QuotationRow, RowSection, Workspace } from './model.ts'

export interface StorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface WorkspaceLoadResult {
  workspace: Workspace
  error: string | null
  stored: boolean
}

export interface WorkspaceSaveResult {
  ok: boolean
  error: string | null
}

export const STORAGE_KEY = 'luquisound.workspace.v1'

const MAX_BACKUP_BYTES = 5 * 1024 * 1024
const INVALID_BACKUP_MESSAGE = 'El respaldo no tiene un formato válido de Luquisound.'
const OVERSIZED_BACKUP_MESSAGE = 'El respaldo supera el límite de 5 MB.'

function invalidBackup(): never {
  throw new Error(INVALID_BACKUP_MESSAGE)
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidBackup()
  return value as Record<string, unknown>
}

function readArray(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) invalidBackup()
  return value
}

function readString(value: unknown, limit: number): string {
  if (typeof value !== 'string' || value.length > limit) invalidBackup()
  return value
}

function readIdentifier(value: unknown, identifiers?: Set<string>): string {
  const identifier = readString(value, 128)
  if (!/^[a-zA-Z0-9_-]+$/.test(identifier) || identifiers?.has(identifier)) invalidBackup()
  identifiers?.add(identifier)
  return identifier
}

function readTimestamp(value: unknown): string {
  const timestamp = readString(value, 24)
  if (!isCatalogTimestamp(timestamp)) invalidBackup()
  return timestamp
}

function readCurrency(value: unknown): Currency {
  if (value !== 'ARS' && value !== 'USD') invalidBackup()
  return value
}

function readSection(value: unknown): RowSection {
  if (value !== 'equipment' && value !== 'extras') invalidBackup()
  return value
}

function readPriceState(value: unknown): PriceState {
  if (value !== 'pending' && value !== 'priced' && value !== 'included') invalidBackup()
  return value
}

function readRow(value: unknown, identifiers: Set<string>, legacyCurrency: Currency): QuotationRow {
  const row = readRecord(value)
  const section = readSection(row.section)
  const audioCategory = readAudioCategory(row.audioCategory, section)
  let provenance: QuotationRow['provenance']
  if (row.provenance !== undefined) {
    try { provenance = parseRowProvenance(row.provenance) } catch { invalidBackup() }
  }
  let fixedServiceOrigin: QuotationRow['fixedServiceOrigin']
  if (row.fixedServiceOrigin !== undefined) {
    try { fixedServiceOrigin = parseFixedServiceOrigin(row.fixedServiceOrigin) } catch { invalidBackup() }
  }
  let factoryEquipment: QuotationRow['factoryEquipment']
  if (row.factoryEquipment !== undefined) {
    try { factoryEquipment = parseFactoryEquipment(row.factoryEquipment) } catch { invalidBackup() }
  }
  let harnessSelection: QuotationRow['harnessSelection']
  if (row.harnessSelection !== undefined) {
    try { harnessSelection = parseHarnessSelection(row.harnessSelection) } catch { invalidBackup() }
  }
  let currencyConversionOrigin: QuotationRow['currencyConversionOrigin']
  if (row.currencyConversionOrigin !== undefined) {
    try { currencyConversionOrigin = parseRowCurrencyConversionOrigin(row.currencyConversionOrigin) } catch { invalidBackup() }
  }
  const adapterVariant = readAdapterVariant(row.adapterVariant, section, audioCategory)
  const restored: QuotationRow = {
    id: readIdentifier(row.id, identifiers),
    section,
    ...(audioCategory === undefined ? {} : { audioCategory }),
    ...(adapterVariant === undefined ? {} : { adapterVariant }),
    currency: row.currency === undefined ? legacyCurrency : readCurrency(row.currency),
    concept: readString(row.concept, 500),
    detail: readString(row.detail, 2000),
    quantity: readString(row.quantity, 64),
    unitPrice: readString(row.unitPrice, 64),
    priceState: readPriceState(row.priceState),
    ...(provenance === undefined ? {} : { provenance }),
    ...(fixedServiceOrigin === undefined ? {} : { fixedServiceOrigin }),
    ...(factoryEquipment === undefined ? {} : { factoryEquipment }),
    ...(harnessSelection === undefined ? {} : { harnessSelection }),
    ...(currencyConversionOrigin === undefined ? {} : { currencyConversionOrigin }),
  }
  if (factoryEquipment !== undefined && !isFactoryRow(restored)) invalidBackup()
  if (harnessSelection !== undefined && !isHarnessPresetRow(restored)) invalidBackup()
  return restored
}

function readQuotation(value: unknown, identifiers: Set<string>): Quotation {
  const quotation = readRecord(value)
  const currency = readCurrency(quotation.currency)
  if (quotation.exchangeRateMode !== undefined && quotation.exchangeRateMode !== 'automatic'
    && quotation.exchangeRateMode !== 'frozen') invalidBackup()
  let exchangeRateQuote: Quotation['exchangeRateQuote']
  if (quotation.exchangeRateQuote !== undefined) {
    try {
      exchangeRateQuote = readStoredBlueDollarQuote(quotation.exchangeRateQuote)
    } catch {
      invalidBackup()
    }
    if (typeof quotation.exchangeRate !== 'string') invalidBackup()
    const rate = parseExchangeRate(quotation.exchangeRate)
    const sourceRate = parseExchangeRate(exchangeRateQuote.rate)
    if (!rate.ok || !sourceRate.ok
      || rate.numerator * sourceRate.denominator !== sourceRate.numerator * rate.denominator) invalidBackup()
  }
  return {
    id: readIdentifier(quotation.id, identifiers),
    title: readString(quotation.title, 500),
    subtitle: readString(quotation.subtitle, 1000),
    currency,
    ...(quotation.exchangeRate === undefined ? {} : { exchangeRate: readString(quotation.exchangeRate, 64) }),
    ...(exchangeRateQuote === undefined ? {} : { exchangeRateQuote }),
    ...(quotation.exchangeRateMode === undefined ? {} : { exchangeRateMode: quotation.exchangeRateMode }),
    rows: readArray(quotation.rows, 1000).map((row) => readRow(row, identifiers, currency)),
    notes: readString(quotation.notes, 10000),
    createdAt: readTimestamp(quotation.createdAt),
    updatedAt: readTimestamp(quotation.updatedAt),
  }
}

function readCatalogDate(value: unknown): string | null {
  if (value === null) return null
  const date = readString(value, 10)
  if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(date)) invalidBackup()
  const fullDate = date.length === 7 ? `${date}-01` : date
  const parsed = new Date(`${fullDate}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== fullDate) invalidBackup()
  return date
}

function readSourcePosition(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 1000000) invalidBackup()
  return value
}

function readCatalogSource(value: unknown): CatalogSource {
  const source = readRecord(value)
  const document = readString(source.document, 500)
  if (!document.trim()) invalidBackup()
  if (source.kind !== undefined && source.kind !== 'snapshot' && source.kind !== 'sheets') invalidBackup()
  const version = source.version === undefined ? undefined : readString(source.version, 200)
  if (version !== undefined && !version.trim()) invalidBackup()
  if (source.checksum !== undefined && (typeof source.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(source.checksum))) invalidBackup()
  return {
    document,
    ...(source.page === undefined ? {} : { page: readSourcePosition(source.page) }),
    ...(source.sheet === undefined ? {} : { sheet: readString(source.sheet, 128) }),
    ...(source.row === undefined ? {} : { row: readSourcePosition(source.row) }),
    date: readCatalogDate(source.date),
    ...(source.kind === undefined ? {} : { kind: source.kind }),
    ...(version === undefined ? {} : { version }),
    ...(source.checksum === undefined ? {} : { checksum: source.checksum as string }),
    ...(source.readAt === undefined ? {} : { readAt: readTimestamp(source.readAt) }),
  }
}

function readReferencePrice(value: unknown): CatalogReferencePrice {
  const reference = readRecord(value)
  if (reference.amount !== null && (
    typeof reference.amount !== 'string' || !/^(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/.test(reference.amount)
  )) invalidBackup()
  if (reference.role !== 'cost' && reference.role !== 'list' && reference.role !== 'sale' && reference.role !== 'unknown') invalidBackup()
  if (reference.historical !== true) invalidBackup()
  return {
    amount: reference.amount,
    currency: reference.currency === null ? null : readCurrency(reference.currency),
    role: reference.role,
    date: readCatalogDate(reference.date),
    historical: true,
    ...(reference.source === undefined ? {} : { source: readCatalogSource(reference.source) }),
  }
}

function readCatalogStock(value: unknown): NonNullable<CatalogItem['stock']> {
  const stock = readRecord(value)
  const fields = parseCatalogStockFields(stock.quantity, stock.checkedAt, stock.validUntil, stock.observation)
  if (fields === null) invalidBackup()
  return { ...fields, source: readCatalogSource(stock.source) }
}

function readCatalogItem(value: unknown, identifiers: Set<string>): CatalogItem {
  const item = readRecord(value)
  let metadata: Pick<CatalogItem, 'listPrice' | 'availabilityPolicy' | 'selectionBlock'>
  try {
    metadata = {
      ...(item.listPrice === undefined ? {} : { listPrice: parseCatalogListPrice(item.listPrice) }),
      ...(item.availabilityPolicy === undefined ? {} : { availabilityPolicy: parseCatalogAvailabilityPolicy(item.availabilityPolicy) }),
      ...(item.selectionBlock === undefined ? {} : { selectionBlock: parseCatalogSelectionBlock(item.selectionBlock) }),
    }
  } catch { invalidBackup() }
  return {
    ...metadata,
    id: readIdentifier(item.id, identifiers),
    concept: readString(item.concept, 500),
    detail: readString(item.detail, 2000),
    section: readSection(item.section),
    currency: readCurrency(item.currency),
    unitPrice: readString(item.unitPrice, 64),
    ...(item.supplier === undefined ? {} : { supplier: readString(item.supplier, 200) }),
    ...(item.sku === undefined ? {} : { sku: readString(item.sku, 128) }),
    ...(item.brand === undefined ? {} : { brand: readString(item.brand, 200) }),
    ...(item.category === undefined ? {} : { category: readString(item.category, 200) }),
    ...(item.unit === undefined ? {} : { unit: readString(item.unit, 200) }),
    ...(item.presentation === undefined ? {} : { presentation: readString(item.presentation, 200) }),
    ...(item.source === undefined ? {} : { source: readCatalogSource(item.source) }),
    ...(item.stock === undefined ? {} : { stock: readCatalogStock(item.stock) }),
    ...(item.referencePrices === undefined ? {} : {
      referencePrices: readArray(item.referencePrices, CATALOG_REFERENCE_MAX_PRICES).map(readReferencePrice),
    }),
  }
}

function readWorkspace(value: unknown): Workspace {
  const workspace = readRecord(value)
  if (workspace.version !== 1) invalidBackup()
  const identifiers = new Set<string>()
  const quotations = readArray(workspace.quotations, 500).map((quotation) => readQuotation(quotation, identifiers))
  const activeQuotationId = workspace.activeQuotationId === null ? null : readIdentifier(workspace.activeQuotationId)
  if (quotations.length === 0 && activeQuotationId !== null) invalidBackup()
  if (quotations.length > 0 && !quotations.some((quotation) => quotation.id === activeQuotationId)) invalidBackup()
  return {
    version: 1,
    activeQuotationId,
    quotations,
    catalog: readArray(workspace.catalog, 2000).map((item) => readCatalogItem(item, identifiers)),
  }
}

function checkBackupSize(text: string): void {
  if (text.length > MAX_BACKUP_BYTES || new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) {
    throw new Error(OVERSIZED_BACKUP_MESSAGE)
  }
}

export function parseWorkspace(text: string): Workspace {
  checkBackupSize(text)
  let value: unknown
  try {
    value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    invalidBackup()
  }
  return readWorkspace(value)
}

export function serializeWorkspace(workspace: Workspace): string {
  const text = JSON.stringify(readWorkspace(workspace), null, 2)
  checkBackupSize(text)
  return text
}

export function loadWorkspace(storage: StorageAdapter): WorkspaceLoadResult {
  let text: string | null
  try {
    text = storage.getItem(STORAGE_KEY)
  } catch {
    return {
      workspace: createWorkspace(),
      stored: false,
      error: 'No se pudo acceder al guardado de este navegador. Conservá un respaldo de tus cambios.',
    }
  }
  if (text === null) return { workspace: createWorkspace(), error: null, stored: false }
  try {
    return { workspace: parseWorkspace(text), error: null, stored: true }
  } catch {
    return {
      workspace: createWorkspace(),
      stored: false,
      error: 'No se pudieron leer los datos guardados. No se modificaron. Podés recuperar un respaldo o iniciar un espacio nuevo.',
    }
  }
}

export function saveWorkspace(storage: StorageAdapter, workspace: Workspace): WorkspaceSaveResult {
  let text: string
  try {
    text = serializeWorkspace(workspace)
  } catch {
    return { ok: false, error: 'Los datos exceden el tamaño o el formato permitido para el guardado.' }
  }
  try {
    storage.setItem(STORAGE_KEY, text)
    return { ok: true, error: null }
  } catch {
    return {
      ok: false,
      error: 'No se pudo guardar en este navegador. Revisá el espacio disponible y descargá un respaldo de tus cambios.',
    }
  }
}
