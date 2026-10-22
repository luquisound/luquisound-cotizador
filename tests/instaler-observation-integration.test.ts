import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { serveInstalerObservation } from '../api/instaler-observation.ts'
import { parseObservationState } from '../src/server/instaler-observation.ts'
import type { InstalerObservationStore } from '../src/server/instaler-observation-store.ts'
import {
  APPS_SCRIPT_EMAIL, APPS_SCRIPT_FILE_ID, APPS_SCRIPT_SECRET, APPS_SCRIPT_URL,
  appsScriptResponse, createAppsScriptHarness,
} from './helpers/instaler-apps-script.ts'

function buildFixtures(): Buffer[] {
  const builder = `import base64,io,json,zipfile
main='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
def cell(ref,value): return '<c r="'+ref+'" t="inlineStr"><is><t>'+value+'</t></is></c>'
def build(price,stock,duplicate):
 header='<row r="1">'+''.join(cell(chr(65+i)+'1',v) for i,v in enumerate(['SKU','DESCRIPCION','PRECIO','STOCK','CATEGORIA']))+'</row>'
 row='<row r="2">'+cell('A2','SYN-A')+cell('B2','Synthetic product')+'<c r="C2"><f>999+999</f><v>'+price+'</v></c><c r="D2"><v>'+stock+'</v></c>'+cell('E2','Synthetic')+'</row>'
 for n in [3,4]:
  row+='<row r="'+str(n)+'">'+cell('A'+str(n),'SYN-DUP')+cell('B'+str(n),'Synthetic duplicate')+'<c r="C'+str(n)+'"><v>'+duplicate+'</v></c><c r="D'+str(n)+'"><v>'+str(n)+'</v></c>'+cell('E'+str(n),'Synthetic')+'</row>'
 data=io.BytesIO()
 with zipfile.ZipFile(data,'w',compression=zipfile.ZIP_DEFLATED) as archive:
  archive.writestr('xl/workbook.xml','<workbook xmlns="'+main+'" xmlns:r="'+rel+'"><sheets><sheet name="Precios" sheetId="1" r:id="rId1"/></sheets></workbook>')
  archive.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="'+rel+'/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
  archive.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="'+main+'"><sheetData>'+header+row+'</sheetData></worksheet>')
 return base64.b64encode(data.getvalue()).decode('ascii')
print(json.dumps([build('100','0','10'),build('200','0.25','999')]))`
  const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
  const generated = spawnSync(python, ['-B', '-X', 'utf8', '-c', builder], {
    encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024,
  })
  assert.equal(generated.status, 0, generated.stderr)
  return (JSON.parse(generated.stdout) as string[]).map((value) => Buffer.from(value, 'base64'))
}

test('real Apps Script output flows through authenticated upload, cached XLSX, comparison and private CAS state', async (context) => {
  const [firstBytes, changedBytes] = buildFixtures()
  const binding = { fileId: APPS_SCRIPT_FILE_ID, expectedEmail: APPS_SCRIPT_EMAIL }
  const config = { ...binding, environment: 'production', mode: 'observe', ingestSecret: APPS_SCRIPT_SECRET, blobToken: 'synthetic-private-blob' }
  let stored: string | null = null
  let etag = 0
  const store: InstalerObservationStore = {
    async read() { return stored === null ? null : { text: stored, etag: String(etag) } },
    async write(text, expected) {
      assert.equal(expected, stored === null ? null : String(etag))
      stored = text
      return String(++etag)
    },
  }
  // No receiver request may fetch Google, the active catalogue or another service.
  context.mock.method(globalThis, 'fetch', () => { assert.fail('Receiver must only consume the uploaded source') })
  const logs: unknown[] = []
  async function receive(script: ReturnType<typeof createAppsScriptHarness>, receivedAt: string) {
    const sent = script.calls.find((call) => call.url === APPS_SCRIPT_URL)!
    assert.ok(sent)
    assert.ok(!sent.options.payload!.includes('synthetic-google-oauth-token'))
    const request = new Request(sent.url, {
      method: 'POST', headers: { ...sent.options.headers, 'Content-Type': sent.options.contentType! }, body: sent.options.payload,
    })
    const result = await serveInstalerObservation(request, config, {
      store, now: () => new Date(receivedAt), log: (event) => logs.push(event),
    })
    return { response: result, body: await result.json() }
  }
  const baselineSender = createAppsScriptHarness({ bytes: firstBytes, now: '2026-10-21T10:00:00.000Z' })
  baselineSender.run()
  const initial = await receive(baselineSender, '2026-10-21T10:00:30.000Z')
  assert.equal(initial.response.status, 200)
  assert.equal(initial.body.status, 'baseline')
  const baseline = parseObservationState(stored!, binding)
  assert.equal(baseline.current!.readAt, '2026-10-21T10:00:00.000Z')
  const changedSender = createAppsScriptHarness({ bytes: changedBytes, now: '2026-10-22T10:00:00.000Z' })
  changedSender.metadata.version = '8'
  changedSender.run()
  const changed = await receive(changedSender, '2026-10-22T10:00:30.000Z')
  assert.equal(changed.response.status, 200)
  assert.equal(changed.body.status, 'changed')
  assert.equal(changed.body.publicationAllowed, false)
  assert.equal(changed.body.supplierFreshnessEstablished, false)
  const state = parseObservationState(stored!, binding)
  assert.deepEqual(state.lastDifference?.prices, [{ sku: 'SYN-A', before: '100', after: '200' }])
  assert.deepEqual(state.lastDifference?.stock, [{ sku: 'SYN-A', before: 0, after: 0.25 }])
  assert.deepEqual(state.lastDifference?.excludedDuplicateSkus, ['SYN-DUP'])
  assert.deepEqual(state.previous, baseline.current)
  assert.equal(state.current!.table.rows[0]!.values[2], '200')
  assert.equal(state.current!.table.rows[0]!.values[3], '0.25')
  assert.equal(etag, 4)
  const repeat = await receive(changedSender, '2026-10-22T10:01:00.000Z')
  assert.equal(repeat.body.status, 'already-attempted')
  assert.equal(etag, 4)

  const failedSender = createAppsScriptHarness({
    now: '2026-10-23T10:00:00.000Z',
    fetch: (url) => {
      assert.ok(url.startsWith('https://www.googleapis.com/drive/v3/about?') || url === APPS_SCRIPT_URL)
      return url === APPS_SCRIPT_URL
        ? appsScriptResponse({ mode: 'observe', publicationAllowed: false, supplierFreshnessEstablished: false, status: 'failed', error: 'access' }, 502)
        : appsScriptResponse({ privateError: 'must never escape' }, 403)
    },
  })
  assert.throws(failedSender.run)
  const failure = await receive(failedSender, '2026-10-23T10:00:30.000Z')
  assert.equal(failure.response.status, 502)
  assert.equal(failure.body.error, 'access')
  const after = parseObservationState(stored!, binding)
  assert.deepEqual(after.current, state.current)
  assert.deepEqual(after.previous, state.previous)
  assert.deepEqual(after.lastDifference, state.lastDifference)
  assert.equal(after.history.at(-1)?.status, 'failed')
  assert.ok(!JSON.stringify(logs).includes('Synthetic product'))
  assert.ok(!JSON.stringify(logs).includes('SYN-A'))
  assert.ok(!JSON.stringify(logs).includes('must never escape'))
})
