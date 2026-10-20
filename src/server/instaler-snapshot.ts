import {
  CATALOG_IMPORT_MAX_ITEMS,
  parseCatalogImport,
  parseCatalogListPrice,
  parseCatalogSource,
  type CatalogImportItem,
  type CatalogSource,
} from '../features/quotation/catalog.ts'

export type InstalerSnapshotIssueCode = 'missing-sku' | 'missing-name'
  | 'invalid-sku' | 'invalid-name' | 'invalid-category' | 'invalid-unit' | 'name-review'
  | 'missing-price' | 'invalid-price' | 'missing-stock' | 'invalid-stock'
  | 'discontinued' | 'duplicate-sku' | 'incomplete-kit' | 'unclassified-row'

export interface InstalerSnapshotIssue {
  row: number
  code: InstalerSnapshotIssueCode
  relatedRows?: number[]
}

export interface InstalerSnapshotReview {
  mode: 'snapshot-review'
  scope: 'precios-only'
  reviewRequired: true
  source: CatalogSource
  items: CatalogImportItem[]
  issues: InstalerSnapshotIssue[]
  sections: { row: number; label: string; discontinued: boolean }[]
  nameReviews: { row: number; sku: string; sourceText: string; reason: 'combined-source-text' | 'over-name-limit' }[]
}

const MAX_TABLE_ROWS = 10000
const REVIEW_BLOCK = 'Revisar los datos del proveedor antes de seleccionar.'
const HEADERS = ['sku', 'descripcion', 'precio', 'stock', 'categoria']

function invalidTable(): never {
  throw new Error('Invalid supplier snapshot table; retain the previous snapshot.')
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidTable()
  return value as Record<string, unknown>
}

function text(value: unknown, limit: number): string {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string' || value.length > limit) invalidTable()
  return value.trim()
}

function normalized(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLowerCase()
}

function missing(value: unknown): boolean {
  return value === null || value === undefined || value === ''
    || (typeof value === 'string' && value.trim() === '')
}

function unresolved(value: string): boolean {
  return value.startsWith('#') || value.startsWith('=')
}

function decimalText(value: string): string | null {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return null
  const negative = value.startsWith('-')
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.')
  const integer = whole.replace(/^0+(?=\d)/, '')
  const tail = fraction.replace(/0+$/, '')
  return `${negative && (integer !== '0' || tail) ? '-' : ''}${integer}${tail ? `.${tail}` : ''}`
}

function expandedNumber(value: number): string {
  const raw = String(value)
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/.exec(raw)
  if (!match) return raw
  const [, sign, whole, tail = '', exponent] = match
  const digits = whole + tail
  const point = whole.length + Number(exponent)
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return sign + digits + '0'.repeat(point - digits.length)
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}

function sourceDecimal(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && value.length > 500) return null
  return decimalText(typeof value === 'number' ? expandedNumber(value) : value.trim())
}

function decimal(value: unknown): number | null {
  const amount = sourceDecimal(value)
  if (amount === null) return null
  const number = Number(amount)
  if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER
    || decimalText(expandedNumber(number)) !== amount) return null
  return number
}

/** Prepare already extracted, unformatted A:E values. This does not read XLSX bytes or Google. */
export function prepareInstalerSnapshot(value: unknown): InstalerSnapshotReview {
  const input = record(value)
  const sourceInput = record(input.source)
  const source = parseCatalogSource({
    document: sourceInput.document, sheet: 'Precios', date: null, kind: 'snapshot',
    ...(sourceInput.version === undefined ? {} : { version: sourceInput.version }),
    ...(sourceInput.checksum === undefined ? {} : { checksum: sourceInput.checksum }),
  })
  if (!Array.isArray(input.headers) || input.headers.length < HEADERS.length) invalidTable()
  const headers: unknown[] = input.headers
  const headerMatches = (expected: string, index: number) => typeof headers[index] === 'string'
    && normalized(headers[index] as string) === expected
  const canonicalHeaders = HEADERS.every(headerMatches)
  // The provider layout uses A1 for its exchange rate, never for a product or quotation rate.
  const providerHeaders = headerMatches('instaler', 1) && headerMatches('precio', 2)
    && headerMatches('stock', 3) && headerMatches('producto', 4)
  if ((!canonicalHeaders && !providerHeaders)
    || !Number.isSafeInteger(input.headerRow) || (input.headerRow as number) < 1
    || !Array.isArray(input.rows) || input.rows.length === 0 || input.rows.length > MAX_TABLE_ROWS) invalidTable()

  const items: CatalogImportItem[] = []
  const issues: InstalerSnapshotIssue[] = []
  const sections: InstalerSnapshotReview['sections'] = []
  const nameReviews: InstalerSnapshotReview['nameReviews'] = []
  const keys = new Map<string, { item: CatalogImportItem; rows: number[] }>()
  let previousRow = input.headerRow as number
  let discontinuedSection = false

  for (const raw of input.rows as unknown[]) {
    const rowInput = record(raw)
    const row = rowInput.row
    if (typeof row !== 'number' || !Number.isSafeInteger(row) || row <= previousRow || row > 1000000
      || !Array.isArray(rowInput.values)
      || (rowInput.incompleteKit !== undefined && typeof rowInput.incompleteKit !== 'boolean')) invalidTable()
    previousRow = row
    const values: unknown[] = rowInput.values
    if (values.slice(0, 5).every(missing)) continue
    const sku = text(values[0], 128)
    const name = text(values[1], 32767)
    const category = text(values[4], 200)
    const issue = (code: InstalerSnapshotIssueCode) => { issues.push({ row, code }) }

    if (!sku) {
      if (normalized(name) === 'discontinuados') {
        discontinuedSection = true
        sections.push({ row, label: name, discontinued: true })
        if (!values.slice(2, 5).every(missing)) issue('unclassified-row')
      } else if (name && values.slice(2, 5).every(missing)) {
        sections.push({ row, label: name, discontinued: discontinuedSection })
      } else {
        issue(name ? 'missing-sku' : 'unclassified-row')
      }
      continue
    }
    if (unresolved(sku)) {
      issue('invalid-sku')
      continue
    }

    const rowSource = { ...source, row }
    const nameReview = name.length > 500 ? 'over-name-limit'
      : name.includes('|') || /\binputs?\b[\s\S]*\boutputs?\b/i.test(name) ? 'combined-source-text' : null
    const item: CatalogImportItem = {
      supplier: 'Instaler', sku, brand: '', name: name && !unresolved(name) && nameReview === null ? name : sku,
      description: '', category: unresolved(category) ? '' : category,
      section: 'equipment', source: rowSource, referencePrices: [],
      availabilityPolicy: 'historical-positive',
    }
    const issueStart = issues.length
    for (const field of ['unit', 'presentation'] as const) {
      if (rowInput[field] !== undefined) {
        const supplied = text(rowInput[field], 200)
        if (unresolved(supplied)) issue('invalid-unit')
        else if (supplied) item[field] = supplied
      }
    }
    if (!name) issue('missing-name')
    else if (unresolved(name)) issue('invalid-name')
    if (nameReview !== null) {
      issue('name-review')
      nameReviews.push({ row, sku, sourceText: name, reason: nameReview })
    }
    if (unresolved(category)) issue('invalid-category')
    if (discontinuedSection || normalized(category) === 'discontinuados') issue('discontinued')
    if (rowInput.incompleteKit === true) issue('incomplete-kit')

    const price = sourceDecimal(values[2])
    if (missing(values[2])) issue('missing-price')
    else if (price === null || price.startsWith('-')) issue('invalid-price')
    else {
      try {
        item.listPrice = parseCatalogListPrice({
          amount: price, currency: 'ARS', basis: 'retail-list-before-discount',
          provisional: true, source: rowSource,
        })
      } catch { issue('invalid-price') }
    }
    const stock = decimal(values[3])
    if (missing(values[3])) issue('missing-stock')
    else if (stock === null) issue('invalid-stock')
    item.stock = {
      quantity: stock, checkedAt: null, validUntil: null,
      observation: 'historical', source: rowSource,
    }
    if (issues.length > issueStart) item.selectionBlock = REVIEW_BLOCK

    const key = sku.replace(/\s+/g, ' ').toLowerCase()
    const previous = keys.get(key)
    if (previous) {
      previous.rows.push(row)
      previous.item.selectionBlock = REVIEW_BLOCK
    } else {
      keys.set(key, { item, rows: [row] })
      items.push(item)
    }
    if (items.length > CATALOG_IMPORT_MAX_ITEMS) invalidTable()
  }

  if (items.length === 0) invalidTable()
  for (const { rows } of keys.values()) {
    if (rows.length > 1) issues.push({ row: rows[0], code: 'duplicate-sku', relatedRows: [...rows] })
  }
  // Validate numeric observations before JSON serialization can turn NaN/Infinity into null.
  for (const item of items) {
    const quantity = item.stock!.quantity
    if (quantity !== null && (!Number.isFinite(quantity) || Math.abs(quantity) > Number.MAX_SAFE_INTEGER)) invalidTable()
  }
  const checked = parseCatalogImport(JSON.stringify({ format: 'luquisound.catalog', version: 1, items }))
  return {
    mode: 'snapshot-review', scope: 'precios-only', reviewRequired: true, source,
    items: checked.items, issues, sections, nameReviews,
  }
}
