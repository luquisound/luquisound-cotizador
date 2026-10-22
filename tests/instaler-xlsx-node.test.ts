import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { readInstalerXlsx } from '../src/server/instaler-xlsx.ts'
import { prepareInstalerSnapshot } from '../src/server/instaler-snapshot.ts'

const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
const script = fileURLToPath(new URL('../scripts/read-instaler-xlsx.py', import.meta.url))
const temporaryRoot = resolve(tmpdir())
const directory = mkdtempSync(join(temporaryRoot, 'luquisound-xlsx-node-'))
let fixtureNumber = 0
after(() => {
  assert.equal(dirname(directory), temporaryRoot)
  assert.ok(basename(directory).startsWith('luquisound-xlsx-node-'))
  rmSync(directory, { recursive: true, force: true })
})

const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relation = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRelation = 'http://schemas.openxmlformats.org/package/2006/relationships'
type Part = [string, string | { base64: string }]

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
function parts(sheet = worksheet(header() + `<row r="2">${inline('A2', 'SYN-A')}${inline('B2', 'Synthetic product')}
  <c r="C2"><v>123.45</v></c><c r="D2"><v>12.75</v></c>${inline('E2', 'Synthetic category')}</row>`)): Part[] {
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
    ['xl/worksheets/sheet1.xml', sheet], ['xl/worksheets/sheet2.xml', worksheet('')],
  ]
}
function fixture(entries: Part[]): { bytes: Buffer; path: string } {
  const builder = `import base64,io,json,sys,zipfile
data=io.BytesIO()
with zipfile.ZipFile(data,'w',compression=zipfile.ZIP_DEFLATED) as archive:
    for name,value in json.load(sys.stdin): archive.writestr(name,base64.b64decode(value['base64']) if isinstance(value,dict) else value)
sys.stdout.write(base64.b64encode(data.getvalue()).decode('ascii'))`
  const built = spawnSync(python, ['-X', 'utf8', '-c', builder], {
    input: JSON.stringify(entries), encoding: 'utf8', maxBuffer: 24 * 1024 * 1024, windowsHide: true, timeout: 15000,
  })
  assert.equal(built.error, undefined)
  assert.equal(built.status, 0, built.stderr)
  const path = join(directory, `synthetic-${++fixtureNumber}.xlsx`)
  const bytes = Buffer.from(built.stdout, 'base64')
  writeFileSync(path, bytes)
  return { bytes, path }
}
async function parity(entries: Part[]) {
  const input = fixture(entries)
  const original = Buffer.from(input.bytes)
  const result = await readInstalerXlsx(input.bytes, basename(input.path))
  const reference = spawnSync(python, ['-X', 'utf8', script, input.path], {
    encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsHide: true, timeout: 15000,
  })
  assert.equal(reference.error, undefined)
  assert.equal(reference.status, 0, reference.stderr)
  assert.deepEqual(result, JSON.parse(reference.stdout))
  assert.deepEqual(input.bytes, original)
  assert.deepEqual(readFileSync(input.path), original)
  return result
}

test('Node cached XLSX extraction equals the offline reader for exact numbers, formulas, zero, missing and errors', async () => {
  const formula = 'IFERROR(__xludf.DUMMYFUNCTION("IMPORTRANGE(""synthetic-only"",""Precios!A:L"")"),0)'
  const result = await parity(parts(worksheet(header() + `<row r="2">${inline('A2', 'SYN-A')}${inline('B2', 'Synthetic product')}
    <c r="C2"><f>${xml(formula)}</f><v>90071992547409.91</v></c>
    <c r="D2"><f>VLOOKUP(A2,synthetic,4,0)</f><v>1.25E-2</v></c>${inline('E2', 'Synthetic category')}</row>
    <row r="3">${inline('A3', 'SYN-B')}${inline('B3', 'Synthetic unknown')}
    <c r="C3"><f>SUM(A1)</f><v/></c><c r="D3"><f t="shared" si="0"/></c></row>
    <row r="4">${inline('A4', 'SYN-C')}${inline('B4', 'Synthetic errors')}
    <c r="C4" t="e"><v>#N/A</v></c><c r="D4" t="b"><v>0</v></c></row>
    <row r="5">${inline('A5', 'SYN-D')}${inline('B5', 'Synthetic zero')}
    <c r="C5"><v>0</v></c><c r="D5"><v>0</v></c></row>`)))
  assert.deepEqual(result.rows[0].values.slice(2, 4), ['90071992547409.91', '0.0125'])
  assert.deepEqual(result.rows[1].values.slice(2, 4), [null, null])
  assert.deepEqual(result.rows[2].values.slice(2, 4), ['#N/A', false])
  const review = prepareInstalerSnapshot(result)
  assert.equal(review.items[0].stock?.quantity, 0.0125)
  assert.equal(review.items[1].stock?.quantity, null)
  assert.equal(review.items[3].stock?.quantity, 0)
  assert.equal(review.items[0].source?.checksum, result.source.checksum)
})

test('Node matches rich strings, formats, explicit units, UTF-16, Strict namespaces and link evidence', async () => {
  const shared = `<sst xmlns="${main}"><si><r><t>Syn</t></r><r><t>thétique &amp; 😀</t></r><rPh><t>ignored</t></rPh></si></sst>`
  const styles = `<styleSheet xmlns="${main}"><numFmts><numFmt numFmtId="164" formatCode="0.00 &quot;m&quot;"/></numFmts>
    <cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`
  const sheet = worksheet(header(inline('F1', 'Unidad') + inline('G1', 'Presentación')) + `<row r="2">
    ${inline('A2', 'SYN-A')}<c r="B2" t="s"><v>0</v></c><c r="C2"><v>12.30</v></c><c r="D2" s="1"><v>2.5</v></c>
    ${inline('E2', 'Synthetic category')}${inline('F2', 'm')}${inline('G2', 'roll')}</row>`)
  const source = [...parts(sheet), ['xl/sharedStrings.xml', shared] as Part, ['xl/styles.xml', styles] as Part,
    ['xl/connections.xml', '<connection url="https://synthetic.invalid/never-read"/>'] as Part,
    ['xl/externalLinks/externalLink1.xml', '<externalLink/>'] as Part]
  const result = await parity(source)
  assert.equal(result.rows[0].unit, 'm')
  assert.equal(result.rows[0].presentation, 'roll')
  assert.equal(result.coverage.externalLinksPresent, true)
  assert.equal(result.coverage.connectionsPresent, true)
  const strict = source.map(([name, content]): Part => [name, typeof content === 'string'
    ? content.replaceAll(main, 'http://purl.oclc.org/ooxml/spreadsheetml/main')
      .replaceAll(relation, 'http://purl.oclc.org/ooxml/officeDocument/relationships') : content])
  await parity(strict)
  const utf16 = parts()
  utf16[3] = ['xl/worksheets/sheet1.xml', { base64: Buffer.concat([
    Buffer.from([0xff, 0xfe]), Buffer.from(sheet, 'utf16le'),
  ]).toString('base64') }]
  await parity([...utf16, ['xl/sharedStrings.xml', shared], ['xl/styles.xml', styles]])
})

test('decimal scientific notation expands textually with the offline Decimal behavior', async () => {
  const values = ['1E2', '1.00E2', '.125e+2', '-.0e-2', '+0001.20', '000.123e-1', '0E-3', '-0E+3', '1e501', '1E-500', '9'.repeat(501)]
  const rows = values.map((value, index) => `<row r="${index + 2}"><c r="A${index + 2}"><v>${value}</v></c></row>`).join('')
  await parity(parts(worksheet(header() + rows)))
})

test('supplier header keeps exchange-rate evidence without converting it into a product', async () => {
  const supplier = `<row r="1"><c r="A1"><v>999.5</v></c>${inline('B1', 'Instaler')}${inline('C1', 'PRECIO')}
    ${inline('D1', 'STOCK')}${inline('E1', 'PRODUCTO')}</row>`
  const result = await parity(parts(worksheet(supplier + `<row r="2">${inline('B2', 'Synthetic heading')}</row>
    <row r="3">${inline('A3', 'SYN-A')}${inline('B3', 'Synthetic product')}<c r="C3"><v>1</v></c><c r="D3"><v>2</v></c></row>`)))
  assert.equal(result.headerLayout, 'supplier-precios-a-e')
  assert.equal(result.rows[0].row, 2)
})

test('unsafe paths, duplicate parts, DTD/entities, corrupt values and external worksheets reject generically', async () => {
  const dtd = `<!DOCTYPE worksheet [<!ENTITY secret SYSTEM "file:///synthetic-private">]>
    <worksheet xmlns="${main}"><sheetData>&secret;</sheetData></worksheet>`
  const external = parts()
  external[2] = ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="${packageRelation}">
    <Relationship Id="rId1" Type="${relation}/worksheet" TargetMode="External" Target="https://synthetic.invalid/never-read"/>
    <Relationship Id="rId2" Type="${relation}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`]
  const cases: Part[][] = [
    [...parts(), ['../outside.xml', 'synthetic']], [...parts(), ['xl/workbook.xml', '<duplicate/>']],
    parts(dtd), external, parts(worksheet('<row r="1"/>')),
    parts(worksheet(header() + '<row r="2"><c r="A2"><v>1</v></c><c r="A2"><v>2</v></c></row>')),
    parts(worksheet(header() + '<row r="2"><c r="A3"><v>1</v></c></row>')),
    parts(worksheet(header() + '<row r="2"><c r="A2" t="s"><v>999</v></c></row>')),
    parts(worksheet(header() + '<row r="2"><c r="A2"><v>1</v><is><t>contradictory</t></is></c></row>')),
    parts(worksheet(header() + '<row r="2"><c r="A2"><v>1</v><v>2</v></c></row>')),
    parts(worksheet(header() + '<row r="2"><c r="A2" s="1"><v>1</v></c></row>')),
    parts(worksheet(header() + '<row r="2"><c r="A2" t="b"><v>2</v></c></row>')),
    parts(worksheet(header() + '<row r="2"><c r="A2" r="B2"><v>1</v></c></row>')),
    parts(worksheet(header() + '<row r="2"><c r="A2" t="str"><v>&#0;</v></c></row>')),
  ]
  for (const entries of cases) await assert.rejects(readInstalerXlsx(fixture(entries).bytes, 'synthetic.xlsx'),
    { message: 'Malformed or unsupported supplier XLSX; retain the previous observation.' })
})

test('bounds cover input, expansion, XML depth, text and shared-string output amplification', async () => {
  await assert.rejects(readInstalerXlsx(Buffer.alloc(8 * 1024 * 1024 + 1), 'synthetic.xlsx'))
  const bomb = fixture([...parts(), ['xl/bomb.xml', 'x'.repeat(17 * 1024 * 1024)]])
  await assert.rejects(readInstalerXlsx(bomb.bytes, 'synthetic.xlsx'))
  const deep = `<worksheet xmlns="${main}">${'<a>'.repeat(65)}${'</a>'.repeat(65)}</worksheet>`
  await assert.rejects(readInstalerXlsx(fixture(parts(deep)).bytes, 'synthetic.xlsx'))
  const long = worksheet(header() + `<row r="2">${inline('A2', 'x'.repeat(32768))}</row>`)
  await assert.rejects(readInstalerXlsx(fixture(parts(long)).bytes, 'synthetic.xlsx'))
  const repeated = Array.from({ length: 600 }, (_, index) => `<row r="${index + 2}"><c r="A${index + 2}" t="s"><v>0</v></c></row>`).join('')
  const shared = `<sst xmlns="${main}"><si><t>${'x'.repeat(32767)}</t></si></sst>`
  await assert.rejects(readInstalerXlsx(fixture([...parts(worksheet(header() + repeated)), ['xl/sharedStrings.xml', shared]]).bytes, 'synthetic.xlsx'))
  const unicodeShared = `<sst xmlns="${main}"><si><t>${'é'.repeat(14000)}</t></si></sst>`
  const unicodeRows = Array.from({ length: 110 }, (_, index) => `<row r="${index + 2}"><c r="A${index + 2}" t="s"><v>0</v></c></row>`).join('')
  await assert.rejects(readInstalerXlsx(fixture([...parts(worksheet(header() + unicodeRows)), ['xl/sharedStrings.xml', unicodeShared]]).bytes, 'synthetic.xlsx'))
})

test('corrupt compression and checksum fail instead of returning partial evidence', async () => {
  const entries = parts()
  const bytes = fixture([entries[1], ...entries.filter((_, index) => index !== 1)]).bytes
  const offset = 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28)
  bytes[offset] = (bytes[offset] & 0xf8) | 7
  await assert.rejects(readInstalerXlsx(bytes, 'synthetic.xlsx'))
  const corruptCrc = fixture(parts()).bytes
  const central = corruptCrc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  corruptCrc.writeUInt32LE(0, central + 16)
  // The first part is unused; corrupt the workbook part, which must be read.
  const nextCentral = corruptCrc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), central + 4)
  corruptCrc.writeUInt32LE(0, nextCentral + 16)
  await assert.rejects(readInstalerXlsx(corruptCrc, 'synthetic.xlsx'))
})
