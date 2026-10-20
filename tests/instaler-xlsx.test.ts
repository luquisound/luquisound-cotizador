import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
const script = fileURLToPath(new URL('../scripts/read-instaler-xlsx.py', import.meta.url))
const temporaryRoot = resolve(tmpdir())
const directory = mkdtempSync(join(temporaryRoot, 'luquisound-xlsx-'))
let fixtureNumber = 0

after(() => {
  assert.equal(dirname(directory), temporaryRoot)
  assert.ok(basename(directory).startsWith('luquisound-xlsx-'))
  rmSync(directory, { recursive: true, force: true })
})

const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relation = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRelation = 'http://schemas.openxmlformats.org/package/2006/relationships'
type Entry = [string, string | { base64: string }]

interface CellEvidence {
  column: string
  reference: string
  type: string
  value: unknown
  rawValue: string | null
  hasCachedValue: boolean
  formula?: string
  formulaAttributes?: Record<string, string>
  numberFormatId?: number
  numberFormat?: string
}

interface Extraction {
  format: string
  version: number
  source: { document: string; checksum: string; byteLength: number }
  sheet: string
  headerRow: number
  headerLayout: string
  headers: unknown[]
  headerCells: CellEvidence[]
  rows: Array<{ row: number; values: unknown[]; cells: CellEvidence[]; unit?: string; presentation?: string }>
  sheets: Array<{ name: string; state: string }>
  coverage: { complete: boolean; kits: string; units: string; unitColumns: Record<string, string>;
    otherSheets: string[]; externalLinksPresent: boolean; connectionsPresent: boolean }
}

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function inline(reference: string, value: string): string {
  return `<c r="${reference}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`
}

function header(extra = ''): string {
  return `<row r="1">${['SKU', 'DESCRIPCION', 'PRECIO', 'STOCK', 'CATEGORIA']
    .map((value, index) => inline(`${String.fromCharCode(65 + index)}1`, value)).join('')}${extra}</row>`
}

function worksheet(rows: string): string {
  return `<worksheet xmlns="${main}"><sheetData>${rows}</sheetData></worksheet>`
}

function entries(sheet = worksheet(header() + `<row r="2">${inline('A2', 'SYN-A')}${inline('B2', 'Synthetic product')}
  <c r="C2"><v>123.45</v></c><c r="D2"><v>12.75</v></c>${inline('E2', 'Synthetic category')}</row>`)): Entry[] {
  return [
    ['[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    ['xl/workbook.xml', `<workbook xmlns="${main}" xmlns:r="${relation}"><sheets>
      <sheet name="Precios" sheetId="1" r:id="rId1"/>
      <sheet name="Synthetic kits" sheetId="2" state="hidden" r:id="rId2"/>
      </sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="${packageRelation}">
      <Relationship Id="rId1" Type="${relation}/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="${relation}/worksheet" Target="/xl/worksheets/sheet2.xml"/>
      </Relationships>`],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/worksheets/sheet2.xml', worksheet('')],
  ]
}

function fixture(parts: Entry[]): string {
  const builder = `import base64,io,json,sys,zipfile
data=io.BytesIO()
with zipfile.ZipFile(data,'w',compression=zipfile.ZIP_DEFLATED) as archive:
    for name,value in json.load(sys.stdin): archive.writestr(name,base64.b64decode(value['base64']) if isinstance(value,dict) else value)
sys.stdout.write(base64.b64encode(data.getvalue()).decode('ascii'))`
  const built = spawnSync(python, ['-X', 'utf8', '-c', builder], {
    input: JSON.stringify(parts), encoding: 'utf8', maxBuffer: 24 * 1024 * 1024,
    windowsHide: true, timeout: 15000,
  })
  assert.equal(built.error, undefined)
  assert.equal(built.status, 0, built.stderr)
  const path = join(directory, `synthetic-${++fixtureNumber}.xlsx`)
  writeFileSync(path, Buffer.from(built.stdout, 'base64'))
  return path
}

function invoke(path: string) {
  return spawnSync(python, ['-X', 'utf8', script, path], {
    encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 15000, windowsHide: true,
  })
}

function read(path: string): Extraction {
  const result = invoke(path)
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout) as Extraction
}

test('XLSX extraction preserves source identity, raw decimals, formulas and missing caches without changing the source', () => {
  const formula = 'IFERROR(__xludf.DUMMYFUNCTION("IMPORTRANGE(""synthetic-only"",""Precios!A:L"")"),0)'
  const path = fixture(entries(worksheet(header() + `<row r="2">${inline('A2', 'SYN-A')}${inline('B2', 'Synthetic product')}
    <c r="C2"><f>${xml(formula)}</f><v>90071992547409.91</v></c>
    <c r="D2"><f>VLOOKUP(A2,synthetic,4,0)</f><v>1.25E-2</v></c>${inline('E2', 'Synthetic category')}</row>
    <row r="3">${inline('A3', 'SYN-B')}${inline('B3', 'Synthetic unknown')}
    <c r="C3"><f>SUM(A1)</f><v/></c><c r="D3"><f t="shared" si="0"/></c></row>
    <row r="4">${inline('A4', 'SYN-C')}${inline('B4', 'Synthetic errors')}
    <c r="C4" t="e"><v>#N/A</v></c><c r="D4" t="b"><v>0</v></c></row>
    <row r="5">${inline('A5', 'SYN-D')}${inline('B5', 'Synthetic zero')}<c r="C5"><v>0</v></c><c r="D5"><v>0</v></c></row>`)))
  const before = readFileSync(path)
  const result = read(path)
  assert.equal(result.format, 'luquisound.instaler-xlsx-extraction')
  assert.equal(result.version, 1)
  assert.deepEqual(result.source, { document: basename(path), checksum: createHash('sha256').update(before).digest('hex'), byteLength: before.length })
  assert.equal(result.sheet, 'Precios')
  assert.equal(result.headerLayout, 'canonical-a-e')
  assert.deepEqual(result.rows[0].values, ['SYN-A', 'Synthetic product', '90071992547409.91', '0.0125', 'Synthetic category'])
  assert.equal(result.rows[0].cells[2].formula, formula)
  assert.equal(result.rows[0].cells[2].hasCachedValue, true)
  assert.equal(result.rows[0].cells[3].rawValue, '1.25E-2')
  assert.deepEqual(result.rows[1].values.slice(2, 4), [null, null])
  assert.equal(result.rows[1].cells[2].hasCachedValue, false)
  assert.equal(result.rows[1].cells[3].formula, '')
  assert.deepEqual(result.rows[1].cells[3].formulaAttributes, { t: 'shared', si: '0' })
  assert.deepEqual(result.rows[2].values.slice(2, 4), ['#N/A', false])
  assert.deepEqual(result.rows[3].values.slice(2, 4), ['0', '0'])
  assert.equal(result.coverage.complete, false)
  assert.equal(result.coverage.kits, 'pending')
  assert.equal(result.coverage.units, 'pending')
  assert.deepEqual(result.coverage.otherSheets, ['Synthetic kits'])
  assert.equal(result.sheets[1].state, 'hidden')
  assert.deepEqual(readFileSync(path), before)
})

test('shared and inline rich strings preserve text while custom number formats and explicit unit columns remain evidence', () => {
  const shared = `<sst xmlns="${main}"><si><r><t>Syn</t></r><r><t>thetic</t></r><rPh><t>phonetic-only</t></rPh></si></sst>`
  const styles = `<styleSheet xmlns="${main}"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.00 &quot;m&quot;"/></numFmts>
    <cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`
  const sheet = worksheet(header(inline('F1', 'Unidad') + inline('G1', 'Presentación')) + `<row r="2">
    ${inline('A2', 'SYN-A')}<c r="B2" t="s"><v>0</v></c><c r="C2"><v>12.30</v></c><c r="D2" s="1"><v>2.5</v></c>
    ${inline('E2', 'Synthetic category')}${inline('F2', 'm')}${inline('G2', 'roll')}</row>`)
  const result = read(fixture([...entries(sheet), ['xl/sharedStrings.xml', shared], ['xl/styles.xml', styles]]))
  assert.equal(result.rows[0].values[1], 'Synthetic')
  assert.equal(result.rows[0].values[2], '12.30')
  assert.equal(result.rows[0].values[3], '2.5')
  assert.equal(result.rows[0].cells[3].numberFormatId, 164)
  assert.equal(result.rows[0].cells[3].numberFormat, '0.00 "m"')
  assert.equal(result.rows[0].unit, 'm')
  assert.equal(result.rows[0].presentation, 'roll')
  assert.equal(result.coverage.units, 'explicit-columns')
  assert.deepEqual(result.coverage.unitColumns, { unit: 'F', presentation: 'G' })
})

test('supplier header retains the supplier exchange-rate cell without importing it as a product', () => {
  const supplierHeader = `<row r="1"><c r="A1"><v>999.5</v></c>${inline('B1', 'Instaler')}${inline('C1', 'PRECIO')}
    ${inline('D1', 'STOCK')}${inline('E1', 'PRODUCTO')}</row>`
  const result = read(fixture(entries(worksheet(supplierHeader + `<row r="2">${inline('B2', 'Synthetic heading')}</row>
    <row r="3">${inline('A3', 'SYN-A')}${inline('B3', 'Synthetic product')}<c r="C3"><v>1</v></c><c r="D3"><v>2</v></c></row>`))))
  assert.equal(result.headerLayout, 'supplier-precios-a-e')
  assert.deepEqual(result.headers, ['999.5', 'Instaler', 'PRECIO', 'STOCK', 'PRODUCTO'])
  assert.equal(result.rows[0].row, 2)
  assert.equal(result.rows[1].values[0], 'SYN-A')
})

test('embedded external links and connections are reported without evaluating or resolving them', () => {
  const result = read(fixture([...entries(),
    ['xl/connections.xml', '<connections refreshOnLoad="1"><connection sourceFile="https://synthetic.invalid/never-read"/></connections>'],
    ['xl/externalLinks/externalLink1.xml', '<externalLink href="https://synthetic.invalid/never-read"/>'],
  ]))
  assert.equal(result.coverage.externalLinksPresent, true)
  assert.equal(result.coverage.connectionsPresent, true)
})

test('unsafe ZIP paths, duplicate parts, DTD/entity XML and external worksheet targets fail without output', () => {
  const dtd = `<?xml version="1.0"?><!DOCTYPE worksheet [<!ENTITY secret SYSTEM "file:///synthetic-never-read">]>
    <worksheet xmlns="${main}"><sheetData>&secret;</sheetData></worksheet>`
  const external = entries()
  external[2] = ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="${packageRelation}">
    <Relationship Id="rId1" Type="${relation}/worksheet" TargetMode="External" Target="https://synthetic.invalid/never-read"/>
    <Relationship Id="rId2" Type="${relation}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`]
  for (const parts of [[...entries(), ['../outside.xml', 'synthetic'] as Entry],
    [...entries(), ['xl/workbook.xml', '<duplicate/>'] as Entry], entries(dtd), external]) {
    const result = invoke(fixture(parts))
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /Cannot read supplier snapshot:/)
    assert.equal(result.stderr.includes('file:///synthetic'), false)
  }
  const utf16 = entries()
  utf16[3] = ['xl/worksheets/sheet1.xml', { base64: Buffer.concat([
    Buffer.from([0xff, 0xfe]), Buffer.from(dtd.replace('version="1.0"', 'version="1.0" encoding="UTF-16"'), 'utf16le'),
  ]).toString('base64') }]
  const rejected = invoke(fixture(utf16))
  assert.equal(rejected.status, 2)
  assert.equal(rejected.stdout, '')
  assert.match(rejected.stderr, /DTD and entity declarations/)
})

test('missing or ambiguous headers, invalid references and shared-string failures cannot produce a partial successful extraction', () => {
  const cases = [worksheet('<row r="1"><c r="A1"><v>1</v></c></row>'),
    worksheet(header() + header().replaceAll('r="1"', 'r="2"').replaceAll('1" t=', '2" t=')),
    worksheet(header() + '<row r="2"><c r="A2"><v>1</v></c><c r="A2"><v>2</v></c></row>'),
    worksheet(header() + '<row r="2"><c r="A3"><v>1</v></c></row>'),
    worksheet(header() + '<row r="2"><c r="A2" t="s"><v>999</v></c></row>'),
    worksheet(header() + '<row r="2"><c r="A2"><v>1</v><is><t>contradictory</t></is></c></row>')]
  for (const sheet of cases) {
    const result = invoke(fixture(entries(sheet)))
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
  }
})

test('file and ZIP expansion limits reject oversized input before returning commercial evidence', () => {
  const oversized = join(directory, `synthetic-${++fixtureNumber}.xlsx`)
  writeFileSync(oversized, Buffer.alloc(8 * 1024 * 1024 + 1))
  assert.equal(invoke(oversized).status, 2)
  const expanded = invoke(fixture([...entries(), ['xl/synthetic-bomb.xml', 'x'.repeat(17 * 1024 * 1024)]]))
  assert.equal(expanded.status, 2)
  assert.equal(expanded.stdout, '')
})

test('repeated shared strings cannot amplify a small workbook into an unbounded JSON report', () => {
  const repeated = Array.from({ length: 600 }, (_, index) =>
    `<row r="${index + 2}"><c r="A${index + 2}" t="s"><v>0</v></c></row>`).join('')
  const shared = `<sst xmlns="${main}"><si><t>${'x'.repeat(32767)}</t></si></sst>`
  const result = invoke(fixture([...entries(worksheet(header() + repeated)), ['xl/sharedStrings.xml', shared]]))
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /output size/)
})

test('corrupt deflate data fails with a bounded generic error and no traceback or partial evidence', () => {
  const parts = entries()
  const path = fixture([parts[1], ...parts.filter((_, index) => index !== 1)])
  const broken = readFileSync(path)
  assert.equal(broken.readUInt32LE(0), 0x04034b50)
  assert.equal(broken.readUInt16LE(8), 8)
  const dataOffset = 30 + broken.readUInt16LE(26) + broken.readUInt16LE(28)
  broken[dataOffset] = (broken[dataOffset] & 0xf8) | 7
  writeFileSync(path, broken)
  const result = invoke(path)
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /Malformed or unreadable XLSX package/)
  assert.equal(result.stderr.includes('Traceback'), false)
  assert.equal(result.stderr.includes(directory), false)
})
