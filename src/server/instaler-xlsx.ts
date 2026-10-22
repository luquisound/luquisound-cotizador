import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import { fromBuffer, type Entry, type ZipFile } from 'yauzl'
import sax, { type QualifiedTag } from 'sax'

const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_PART_BYTES = 16 * 1024 * 1024
const MAX_TOTAL_BYTES = 64 * 1024 * 1024
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const MAX_TEXT = 32767
const MAIN_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  'http://purl.oclc.org/ooxml/spreadsheetml/main',
])
const PACKAGE_RELATION = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE_RELATIONS = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
]

export interface InstalerCellEvidence {
  column: string
  reference: string
  type: string
  value: string | boolean | null
  rawValue: string | null
  hasCachedValue: boolean
  formula?: string
  formulaAttributes?: Record<string, string>
  numberFormatId?: number
  numberFormat?: string
}

export interface InstalerExtractedRow {
  row: number
  values: (string | boolean | null)[]
  cells: InstalerCellEvidence[]
  unit?: string
  presentation?: string
}

export interface InstalerXlsxExtraction {
  format: 'luquisound.instaler-xlsx-extraction'
  version: 1
  source: { document: string; checksum: string; byteLength: number }
  sheet: 'Precios'
  headerRow: number
  headerLayout: 'canonical-a-e' | 'supplier-precios-a-e'
  headers: (string | boolean | null)[]
  headerCells: InstalerCellEvidence[]
  rows: InstalerExtractedRow[]
  sheets: { name: string; state: string }[]
  coverage: {
    complete: false
    kits: 'pending'
    units: 'explicit-columns' | 'pending'
    unitColumns: Partial<Record<'unit' | 'presentation', string>>
    otherSheets: string[]
    externalLinksPresent: boolean
    connectionsPresent: boolean
  }
}

interface XmlNode {
  local: string
  uri: string
  attributes: Record<string, string>
  children: XmlNode[]
  text: string
}

function invalid(): never {
  // Parser and ZIP errors can contain formulas or private file names.
  throw new Error('Malformed or unsupported supplier XLSX; retain the previous observation.')
}

function bounded(value: string): string {
  if (value.length > MAX_TEXT) invalid()
  return value
}

function normalized(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase() : ''
}

function children(node: XmlNode, local: string, uri = node.uri): XmlNode[] {
  return node.children.filter((child) => child.local === local && child.uri === uri)
}

function rootNamespace(node: XmlNode, expected: string): string {
  if (node.local !== expected || !MAIN_NAMESPACES.has(node.uri)) invalid()
  return node.uri
}

function decodeXml(bytes: Uint8Array): string {
  const utf16le = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0)
  const utf16be = (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c)
  return new TextDecoder(utf16le ? 'utf-16le' : utf16be ? 'utf-16be' : 'utf-8', { fatal: true })
    .decode(bytes).replace(/\r\n?/g, '\n')
}

function validateXmlCharacters(value: string): void {
  for (const character of value) {
    const code = character.codePointAt(0)!
    if ((code < 0x20 && code !== 9 && code !== 10 && code !== 13) || code === 0xfffe || code === 0xffff) invalid()
  }
}

function parseXml(bytes: Uint8Array): XmlNode {
  const options = { xmlns: true, strictEntities: true, trim: false, normalize: false }
  const xml = sax.parser(true, options)
  const stack: XmlNode[] = []
  let root: XmlNode | undefined
  let count = 0
  let seenAttributes = new Set<string>()
  xml.ondoctype = invalid
  xml.onerror = invalid
  xml.onopentagstart = () => { seenAttributes = new Set<string>() }
  xml.onattribute = (raw) => {
    const attribute = raw as QualifiedTag['attributes'][string]
    const identity = attribute.uri ? `{${attribute.uri}}${attribute.local}` : attribute.local
    if (seenAttributes.has(identity)) invalid()
    seenAttributes.add(identity)
    validateXmlCharacters(attribute.value)
  }
  xml.onopentag = (raw) => {
    const tag = raw as QualifiedTag
    if (++count > 1000000 || stack.length >= 64) invalid()
    const attributes: Record<string, string> = Object.create(null)
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.name === 'xmlns' || attribute.prefix === 'xmlns') continue
      const key = attribute.uri ? `{${attribute.uri}}${attribute.local}` : attribute.local
      attributes[key] = attribute.value
    }
    const node: XmlNode = { local: tag.local, uri: tag.uri, attributes, children: [], text: '' }
    if (stack.length > 0) stack[stack.length - 1].children.push(node)
    else if (root) invalid()
    else root = node
    stack.push(node)
  }
  const text = (value: string) => {
    validateXmlCharacters(value)
    const node = stack[stack.length - 1]
    // Match ElementTree's .text: child tails are not cell values.
    if (node && node.children.length === 0) node.text += value
  }
  xml.ontext = text
  xml.oncdata = text
  xml.onclosetag = () => { stack.pop() }
  const source = decodeXml(bytes)
  validateXmlCharacters(source)
  xml.write(source).close()
  if (!root || stack.length > 0) invalid()
  return root
}

const CRC_TABLE = Array.from({ length: 256 }, (_, initial) => {
  let value = initial
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

async function openPackage(bytes: Uint8Array): Promise<{ zip: ZipFile; parts: Map<string, Entry> }> {
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    fromBuffer(Buffer.from(bytes), { lazyEntries: true, validateEntrySizes: true, strictFileNames: true, autoClose: false },
      (error, archive) => { if (error || !archive) reject(error); else resolve(archive) })
  })
  try {
    const parts = await new Promise<Map<string, Entry>>((resolve, reject) => {
      const entries = new Map<string, Entry>()
      let total = 0
      zip.on('error', reject)
      zip.on('end', () => { resolve(entries) })
      zip.on('entry', (entry: Entry) => {
        try {
          const name = entry.fileName
          const mode = entry.externalFileAttributes >>> 16
          if (!name || /[\\:]/.test(name) || name.includes('\0') || name.startsWith('/') || entries.has(name)
            || name.replace(/\/$/, '').split('/').some((part) => !part || part === '.' || part === '..')
            || (mode & 0xf000) === 0xa000 || (entry.generalPurposeBitFlag & 1) !== 0
            || ![0, 8].includes(entry.compressionMethod) || entries.size >= 4096
            || !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0
            || entry.uncompressedSize > MAX_PART_BYTES) invalid()
          total += entry.uncompressedSize
          if (total > MAX_TOTAL_BYTES || (entry.uncompressedSize > 1024 * 1024
            && entry.uncompressedSize > Math.max(1, entry.compressedSize) * 1000)) invalid()
          entries.set(name, entry)
          zip.readEntry()
        } catch (error) { reject(error) }
      })
      zip.readEntry()
    })
    return { zip, parts }
  } catch (error) {
    zip.close()
    throw error
  }
}

async function partXml(zip: ZipFile, parts: Map<string, Entry>, name: string, optional = false): Promise<XmlNode | null> {
  const entry = parts.get(name)
  if (!entry) {
    if (optional) return null
    invalid()
  }
  const stream = await new Promise<Readable>((resolve, reject) => {
    zip.openReadStream(entry, (error, body) => { if (error || !body) reject(error); else resolve(body) })
  })
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of stream) {
      if (!Buffer.isBuffer(chunk)) invalid()
      size += chunk.length
      if (size > MAX_PART_BYTES || size > entry.uncompressedSize) invalid()
      chunks.push(chunk)
    }
  } catch (error) {
    stream.destroy()
    throw error
  }
  if (size !== entry.uncompressedSize) invalid()
  const bytes = Buffer.concat(chunks, size)
  if (crc32(bytes) !== entry.crc32) invalid()
  return parseXml(bytes)
}

function relationshipTarget(value: string): string {
  if (!value || value.startsWith('//') || /[\\:?#]/.test(value)
    || value.split('/').some((part) => part === '.' || part === '..')) invalid()
  const name = value.startsWith('/') ? value.slice(1) : `xl/${value}`
  if (!name.startsWith('xl/') || name.includes('//')) invalid()
  return name
}

function workbookSheets(workbook: XmlNode, relationships: XmlNode): { name: string; state: string; part: string }[] {
  const uri = rootNamespace(workbook, 'workbook')
  if (relationships.uri !== PACKAGE_RELATION || relationships.local !== 'Relationships') invalid()
  const byId = new Map<string, XmlNode>()
  for (const relation of children(relationships, 'Relationship')) {
    const id = relation.attributes.Id
    if (!id || byId.has(id)) invalid()
    byId.set(id, relation)
  }
  const names = new Set<string>()
  const sheets: { name: string; state: string; part: string }[] = []
  for (const group of children(workbook, 'sheets', uri)) {
    for (const sheet of children(group, 'sheet', uri)) {
      const name = bounded(sheet.attributes.name ?? '')
      if (!name || names.has(name)) invalid()
      names.add(name)
      const id = OFFICE_RELATIONS.map((namespace) => sheet.attributes[`{${namespace}}id`]).find((value) => value !== undefined)
      const relation = byId.get(id ?? '')
      if (!relation || !relation.attributes.Type?.endsWith('/worksheet') || relation.attributes.TargetMode === 'External') invalid()
      sheets.push({ name, state: sheet.attributes.state ?? 'visible', part: relationshipTarget(relation.attributes.Target ?? '') })
    }
  }
  if (sheets.length === 0) invalid()
  return sheets
}

function richText(node: XmlNode | undefined, uri: string): string {
  let value = ''
  for (const child of node?.children ?? []) {
    if (child.uri !== uri) continue
    if (child.local === 't') value += child.text
    else if (child.local === 'r') value += children(child, 't', uri)[0]?.text ?? ''
    bounded(value)
  }
  return value
}

function sharedStrings(root: XmlNode | null): string[] {
  if (!root) return []
  const uri = rootNamespace(root, 'sst')
  const entries = children(root, 'si', uri)
  if (entries.length > 200000) invalid()
  return entries.map((entry) => richText(entry, uri))
}

type NumberStyle = { numberFormatId: number; numberFormat?: string }

function cellStyles(root: XmlNode | null): NumberStyle[] {
  if (!root) return []
  const uri = rootNamespace(root, 'styleSheet')
  const formats = new Map<string, string>()
  for (const group of children(root, 'numFmts', uri)) {
    for (const format of children(group, 'numFmt', uri)) {
      const key = format.attributes.numFmtId ?? ''
      if (!/^\d+$/.test(key) || formats.has(key)) invalid()
      formats.set(key, bounded(format.attributes.formatCode ?? ''))
    }
  }
  return children(root, 'cellXfs', uri).flatMap((group) => children(group, 'xf', uri).map((style) => {
    const key = style.attributes.numFmtId ?? '0'
    if (!/^\d+$/.test(key) || !Number.isSafeInteger(Number(key))) invalid()
    return { numberFormatId: Number(key), ...(formats.has(key) ? { numberFormat: formats.get(key)! } : {}) }
  }))
}

function numericValue(raw: string | null): string | null {
  if (raw === null || raw.length > 500) return raw
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(raw)
  if (!match) return raw
  const [, sign, whole = '0', tail = '', leadingTail = '', exponent = '0'] = match
  if (exponent.replace(/^[+-]/, '').length > 3 || Math.abs(Number(exponent)) > 500) return raw
  const fraction = tail || leadingTail
  const digits = whole + fraction
  const point = whole.length + Number(exponent)
  const expanded = point <= 0 ? `0.${'0'.repeat(-point)}${digits}`
    : point >= digits.length ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`
  const [integer, decimal] = expanded.split('.')
  const value = `${sign === '-' ? '-' : ''}${integer.replace(/^0+(?=\d)/, '')}${decimal === undefined ? '' : `.${decimal}`}`
  return value.length <= 500 ? value : raw
}

function evidenceBytes(value: unknown): number {
  const json = JSON.stringify(value)
  let length = json.length
  // Match the offline reader's ASCII-escaped output bound, including surrogate pairs.
  for (let index = 0; index < json.length; index++) if (json.charCodeAt(index) > 0x7f) length += 5
  return length
}

function columnIndex(letters: string): number {
  let value = 0
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64
  if (value > 16384) invalid()
  return value
}

function readCell(node: XmlNode, uri: string, row: number, previous: number, strings: string[], styles: NumberStyle[]) {
  const reference = node.attributes.r ?? ''
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(reference)
  if (!match || Number(match[2]) !== row) invalid()
  const column = columnIndex(match[1])
  if (column <= previous) invalid()
  if (column > 12) return { column, evidence: null }
  const kind = node.attributes.t ?? 'n'
  const values = children(node, 'v', uri)
  const formulas = children(node, 'f', uri)
  const inlines = children(node, 'is', uri)
  if (values.length > 1 || formulas.length > 1 || inlines.length > 1 || (inlines.length > 0 && kind !== 'inlineStr')) invalid()
  let raw = values[0]?.text ? bounded(values[0].text) : null
  let value: string | boolean | null
  if (kind === 's') {
    if (raw === null) value = null
    else if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) >= strings.length) invalid()
    else value = strings[Number(raw)]
  } else if (kind === 'inlineStr') {
    if (formulas.length > 0 || values.length > 0) invalid()
    value = inlines[0] ? richText(inlines[0], uri) : null
    raw = value
  } else if (kind === 'b') {
    if (raw !== null && raw !== '0' && raw !== '1') invalid()
    value = raw === null ? null : raw === '1'
  } else if (['str', 'e', 'd'].includes(kind)) value = raw
  else if (kind === 'n') value = numericValue(raw)
  else invalid()
  const evidence: InstalerCellEvidence = {
    column: match[1], reference, type: kind, value, rawValue: raw, hasCachedValue: Boolean(values[0]?.text),
  }
  if (formulas[0]) {
    evidence.formula = bounded(formulas[0].text)
    if (Object.keys(formulas[0].attributes).length > 0) evidence.formulaAttributes = { ...formulas[0].attributes }
  }
  const style = node.attributes.s
  if (style !== undefined) {
    if (!/^\d+$/.test(style) || !Number.isSafeInteger(Number(style)) || Number(style) >= styles.length) invalid()
    Object.assign(evidence, styles[Number(style)])
  } else if (styles.length > 0) Object.assign(evidence, styles[0])
  return { column, evidence }
}

function worksheetRows(root: XmlNode, strings: string[], styles: NumberStyle[]): InstalerExtractedRow[] {
  const uri = rootNamespace(root, 'worksheet')
  const rows: InstalerExtractedRow[] = []
  let previousRow = 0
  let cells = 0
  let evidenceSize = 0
  for (const group of children(root, 'sheetData', uri)) {
    for (const raw of children(group, 'row', uri)) {
      const position = raw.attributes.r ?? ''
      const row = Number(position)
      if (!/^\d+$/.test(position) || !Number.isSafeInteger(row) || row <= previousRow || row > 1000000 || rows.length >= 10000) invalid()
      previousRow = row
      const result: InstalerExtractedRow = { row, values: [null, null, null, null, null], cells: [] }
      let previousColumn = 0
      for (const cell of children(raw, 'c', uri)) {
        if (++cells > 200000) invalid()
        const { column, evidence } = readCell(cell, uri, row, previousColumn, strings, styles)
        previousColumn = column
        if (evidence) {
          evidenceSize += evidenceBytes(evidence)
          if (evidenceSize > MAX_OUTPUT_BYTES) invalid()
          result.cells.push(evidence)
          if (column <= 5) result.values[column - 1] = evidence.value
        }
      }
      rows.push(result)
    }
  }
  return rows
}

function headerLayout(values: unknown[]): InstalerXlsxExtraction['headerLayout'] | null {
  const headers = values.map(normalized)
  if (JSON.stringify(headers) === JSON.stringify(['sku', 'descripcion', 'precio', 'stock', 'categoria'])) return 'canonical-a-e'
  if (JSON.stringify(headers.slice(1)) === JSON.stringify(['instaler', 'precio', 'stock', 'producto'])) return 'supplier-precios-a-e'
  return null
}

/** Read cached values only; never resolve workbook links, calculate formulas or create a catalogue. */
export async function readInstalerXlsx(bytes: Uint8Array, document: string): Promise<InstalerXlsxExtraction> {
  let zip: ZipFile | undefined
  try {
    if (bytes.byteLength > MAX_FILE_BYTES || typeof document !== 'string' || !document.trim() || document.length > 500) invalid()
    const opened = await openPackage(bytes)
    zip = opened.zip
    const { parts } = opened
    const workbook = await partXml(zip, parts, 'xl/workbook.xml')
    const relations = await partXml(zip, parts, 'xl/_rels/workbook.xml.rels')
    if (!workbook || !relations) invalid()
    const sheets = workbookSheets(workbook, relations)
    const target = sheets.find((sheet) => sheet.name === 'Precios')
    if (!target) invalid()
    const strings = sharedStrings(await partXml(zip, parts, 'xl/sharedStrings.xml', true))
    const styles = cellStyles(await partXml(zip, parts, 'xl/styles.xml', true))
    const worksheet = await partXml(zip, parts, target.part)
    if (!worksheet) invalid()
    const rows = worksheetRows(worksheet, strings, styles)
    const candidates = rows.filter((row) => row.row <= 100).flatMap((row) => {
      const layout = headerLayout(row.values)
      return layout ? [{ row, layout }] : []
    })
    if (candidates.length !== 1) invalid()
    const { row: header, layout } = candidates[0]
    const unitColumns: InstalerXlsxExtraction['coverage']['unitColumns'] = {}
    for (const cell of header.cells.filter((cell) => columnIndex(cell.column) > 5)) {
      const title = normalized(cell.value)
      const key = ['unidad', 'unit'].includes(title) ? 'unit' : ['presentacion', 'presentation'].includes(title) ? 'presentation' : null
      if (key) {
        if (unitColumns[key]) invalid()
        unitColumns[key] = cell.column
      }
    }
    const extracted = rows.filter((row) => row.row > header.row)
    for (const row of extracted) {
      for (const key of ['unit', 'presentation'] as const) {
        const cell = row.cells.find((cell) => cell.column === unitColumns[key])
        if (typeof cell?.value === 'string' && cell.value.trim()) row[key] = cell.value.trim()
      }
    }
    const result: InstalerXlsxExtraction = {
      format: 'luquisound.instaler-xlsx-extraction', version: 1,
      source: { document, checksum: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength },
      sheet: 'Precios', headerRow: header.row, headerLayout: layout, headers: header.values, headerCells: header.cells,
      rows: extracted, sheets: sheets.map(({ name, state }) => ({ name, state })),
      coverage: {
        complete: false, kits: 'pending', units: Object.keys(unitColumns).length > 0 ? 'explicit-columns' : 'pending',
        unitColumns, otherSheets: sheets.filter((sheet) => sheet.name !== 'Precios').map((sheet) => sheet.name),
        externalLinksPresent: [...parts.keys()].some((name) => name.startsWith('xl/externalLinks/')),
        connectionsPresent: parts.has('xl/connections.xml'),
      },
    }
    if (evidenceBytes(result) + 1 > MAX_OUTPUT_BYTES) invalid()
    return result
  } catch { return invalid() } finally { zip?.close() }
}
