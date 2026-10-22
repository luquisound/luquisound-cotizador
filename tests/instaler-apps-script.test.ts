import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  APPS_SCRIPT_BYPASS, APPS_SCRIPT_EMAIL, APPS_SCRIPT_FILE_ID, APPS_SCRIPT_SECRET, APPS_SCRIPT_URL,
  appsScriptResponse, createAppsScriptHarness,
} from './helpers/instaler-apps-script.ts'

test('Apps Script is standalone, uses only read-only Drive plus outbound HTTPS, and installs no trigger', () => {
  const manifest = JSON.parse(readFileSync(new URL('../apps-script/instaler-observation/appsscript.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.oauthScopes, [
    'https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/script.external_request',
  ])
  assert.equal(manifest.timeZone, 'America/Argentina/Buenos_Aires')
  assert.equal(manifest.runtimeVersion, 'V8')
  assert.deepEqual(manifest.dependencies.enabledAdvancedServices, [
    { userSymbol: 'Drive', version: 'v3', serviceId: 'drive' },
  ])
  assert.equal(manifest.webapp, undefined)
})

test('disabled defaults and invalid configuration have no Drive calls or persistent side effects', () => {
  for (const mode of ['', 'disabled']) {
    const script = createAppsScriptHarness({ properties: { INSTALER_OBSERVATION_MODE: mode } })
    assert.equal(script.run().status, 'disabled')
    assert.deepEqual(script.calls, [])
    assert.deepEqual(script.writes, [])
    assert.equal(script.counters().lockAcquisitions, 0)
  }
  const invalidConfigurations: Record<string, string>[] = [
    { INSTALER_OBSERVATION_MODE: 'publish' },
    { INSTALER_OBSERVATION_URL: 'https://attacker.example.invalid/api/instaler-observation' },
    { INSTALER_OBSERVATION_URL: APPS_SCRIPT_URL + '?bypass=secret' },
    { INSTALER_OBSERVATION_URL: APPS_SCRIPT_URL.replace('https:', 'http:') },
    { INSTALER_DRIVE_FILE_ID: '../unsafe-id' },
    { INSTALER_GOOGLE_EXPECTED_EMAIL: '' },
    { INSTALER_OBSERVATION_INGEST_SECRET: 'too-short' },
    { VERCEL_AUTOMATION_BYPASS_SECRET: 'invalid\r\nheader' },
  ]
  for (const properties of invalidConfigurations) {
    const script = createAppsScriptHarness({ properties })
    assert.throws(script.run, /failed \(configuration\)/)
    assert.deepEqual(script.calls, [])
    assert.deepEqual(script.writes, [])
  }
})

test('a closed XLSX is downloaded through GET-only Drive calls and uploaded without Google credentials', () => {
  const script = createAppsScriptHarness()
  assert.equal(script.run().status, 'baseline')
  assert.equal(script.calls.length, 5)
  assert.deepEqual(script.calls.slice(0, 4).map((call) => call.options.method), ['get', 'get', 'get', 'get'])
  const sent = script.calls[4]!
  assert.equal(sent.url, APPS_SCRIPT_URL)
  assert.equal(sent.options.method, 'post')
  assert.equal(sent.options.headers.Authorization, `Bearer ${APPS_SCRIPT_SECRET}`)
  assert.equal(sent.options.headers['x-vercel-protection-bypass'], APPS_SCRIPT_BYPASS)
  const payload = JSON.parse(sent.options.payload!)
  assert.equal(payload.format, 'luquisound.instaler-observation-upload')
  assert.equal(payload.mode, 'observe')
  assert.equal(payload.version, 1)
  assert.equal(payload.account, APPS_SCRIPT_EMAIL)
  assert.equal(payload.fileId, APPS_SCRIPT_FILE_ID)
  assert.equal(payload.readAt, '2026-10-21T10:00:00.000Z')
  assert.deepEqual(Buffer.from(payload.result.bytesBase64, 'base64'), Buffer.from(script.bytes))
  assert.deepEqual(payload.result.metadata, script.metadata)
  assert.ok(!sent.options.payload!.includes('synthetic-google-oauth-token'))
  for (const call of script.calls) {
    assert.equal(call.options.followRedirects, false)
    assert.equal(call.options.muteHttpExceptions, true)
    assert.equal(call.options.validateHttpsCertificates, true)
  }
  const logs = script.logs.join('\n')
  for (const privateValue of [APPS_SCRIPT_SECRET, APPS_SCRIPT_BYPASS, APPS_SCRIPT_EMAIL, APPS_SCRIPT_FILE_ID, 'Synthetic private', 'synthetic-google-oauth-token']) {
    assert.ok(!logs.includes(privateValue))
  }
})

test('claiming the UTC day precedes Drive and prevents rereads after success or failure', () => {
  const script = createAppsScriptHarness()
  assert.equal(script.run().status, 'baseline')
  assert.deepEqual(script.writes, [{ key: 'INSTALER_LAST_ATTEMPT_UTC', value: '2026-10-21' }])
  assert.equal(script.run().status, 'already-attempted')
  assert.equal(script.calls.length, 5)
  script.setNow('2026-10-22T10:00:00.000Z')
  assert.equal(script.run().status, 'baseline')
  assert.equal(script.calls.length, 10)
  assert.deepEqual(script.counters(), { tokenCalls: 2, lockAcquisitions: 3, lockReleases: 3 })
  const failing = createAppsScriptHarness({ tokenError: new Error('private upstream error') })
  assert.throws(failing.run, /failed \(oauth\)/)
  assert.equal(failing.run().status, 'already-attempted')
  assert.equal(failing.calls.length, 1)
  assert.equal(failing.counters().tokenCalls, 1)
})

test('a busy sender does not read or mark an attempt', () => {
  const script = createAppsScriptHarness({ lockAvailable: false })
  assert.equal(script.run().status, 'busy')
  assert.deepEqual(script.calls, [])
  assert.deepEqual(script.writes, [])
  assert.equal(script.counters().lockReleases, 0)
})

test('a daily-guard write failure aborts before requesting an OAuth token or contacting Drive', () => {
  const script = createAppsScriptHarness({ propertyWriteError: new Error('PRIVATE-PROPERTY-FAILURE') })
  assert.throws(script.run, /failed \(configuration\)/)
  assert.deepEqual(script.calls, [])
  assert.deepEqual(script.writes, [])
  assert.equal(script.properties.has('INSTALER_LAST_ATTEMPT_UTC'), false)
  assert.deepEqual(script.counters(), { tokenCalls: 0, lockAcquisitions: 1, lockReleases: 1 })
  assert.ok(!script.logs.join('\n').includes('PRIVATE-PROPERTY-FAILURE'))
  assert.equal(JSON.parse(script.logs[0]!).supplierFreshnessEstablished, false)
})

test('malformed OAuth tokens are reported without sending them to any Google endpoint', () => {
  for (const token of ['', null, 7, 'PRIVATE-TOKEN\r\ninjected-header']) {
    const script = createAppsScriptHarness({ token })
    assert.throws(script.run, /failed \(oauth\)/)
    assert.equal(script.calls.length, 1)
    assert.equal(script.calls[0]!.url, APPS_SCRIPT_URL)
    assert.deepEqual(JSON.parse(script.calls[0]!.options.payload!).result, { status: 'failed', error: 'oauth' })
    assert.ok(!script.logs.join('\n').includes('PRIVATE-TOKEN'))
  }
})

test('an account mismatch sends only a classified failure report and never downloads a file', () => {
  let script: ReturnType<typeof createAppsScriptHarness>
  script = createAppsScriptHarness({ fetch: (url) => {
    assert.equal(script.properties.get('INSTALER_LAST_ATTEMPT_UTC'), '2026-10-21')
    if (url.includes('/about?')) return appsScriptResponse({ user: { emailAddress: 'wrong@example.invalid' } })
    return script.defaultFetch(url)
  } })
  assert.throws(script.run, /failed \(account-mismatch\)/)
  assert.equal(script.calls.length, 2)
  const payload = JSON.parse(script.calls[1]!.options.payload!)
  assert.deepEqual(payload.result, { status: 'failed', error: 'account-mismatch' })
  assert.equal(payload.readAt, '2026-10-21T10:00:00.000Z')
  assert.equal(script.counters().lockReleases, 1)
})

test('source changes and checksum mismatches are reported without uploading workbook bytes', () => {
  for (const issue of ['changed', 'checksum', 'size', 'mime', 'download-disabled']) {
    let script: ReturnType<typeof createAppsScriptHarness>
    let reads = 0
    script = createAppsScriptHarness({ fetch: (url) => {
      if (url.includes('/files/') && url.includes('?fields=')) {
        reads++
        const metadata = { ...script.metadata }
        if (issue === 'changed' && reads === 2) metadata.version = '8'
        if (issue === 'checksum') metadata.md5Checksum = '0'.repeat(32)
        if (issue === 'size') metadata.size = String(script.bytes.byteLength + 1)
        if (issue === 'mime') metadata.mimeType = 'application/vnd.google-apps.spreadsheet'
        if (issue === 'download-disabled') metadata.capabilities = { canDownload: false }
        return appsScriptResponse(metadata)
      }
      return script.defaultFetch(url)
    } })
    const expected = issue === 'changed' ? 'source-changed' : issue === 'download-disabled' ? 'access' : 'source-invalid'
    assert.throws(script.run, new RegExp(`failed \\(${expected}\\)`))
    const payload = JSON.parse(script.calls.at(-1)!.options.payload!)
    assert.deepEqual(payload.result, { status: 'failed', error: expected })
  }
})

test('oversized metadata is rejected before downloading; actual oversized bytes are rejected too', () => {
  for (const declaredTooLarge of [true, false]) {
    let script: ReturnType<typeof createAppsScriptHarness>
    script = createAppsScriptHarness({ fetch: (url) => {
      if (declaredTooLarge && url.includes('/files/') && url.includes('?fields=')) return appsScriptResponse({ ...script.metadata, size: String(3 * 1024 * 1024 + 1) })
      if (!declaredTooLarge && url.includes('?alt=media')) {
        return appsScriptResponse(new Uint8Array(3 * 1024 * 1024 + 1), 200, script.metadata.mimeType)
      }
      return script.defaultFetch(url)
    } })
    assert.throws(script.run, /failed \(source-invalid\)/)
    if (declaredTooLarge) assert.ok(!script.calls.some((call) => call.url.includes('?alt=media')))
    assert.equal(JSON.parse(script.calls.at(-1)!.options.payload!).result.error, 'source-invalid')
  }
})

test('Google failures are sanitized and reported once, including redirects and rate limits', () => {
  for (const [status, code] of [[401, 'oauth'], [403, 'access'], [404, 'access'], [302, 'access'], [429, 'rate-limited'], [500, 'network']] as const) {
    let script: ReturnType<typeof createAppsScriptHarness>
    script = createAppsScriptHarness({ fetch: (url) => url.includes('googleapis.com')
      ? appsScriptResponse('PRIVATE-UPSTREAM-TOKEN-AND-CONTENT', status, 'text/html') : script.defaultFetch(url) })
    assert.throws(script.run, new RegExp(`failed \\(${code}\\)`))
    assert.equal(script.calls.length, 2)
    const report = JSON.parse(script.calls[1]!.options.payload!)
    assert.deepEqual(report.result, { status: 'failed', error: code })
    assert.ok(!script.logs.join('\n').includes('PRIVATE-UPSTREAM'))
  }
})

test('malformed Google JSON and content types fail closed before reading source data', () => {
  for (const response of [
    appsScriptResponse('{PRIVATE-MALFORMED-JSON'),
    appsScriptResponse('null'),
    appsScriptResponse('[]'),
    appsScriptResponse('7'),
    appsScriptResponse('x'.repeat(64 * 1024 + 1)),
    appsScriptResponse({ user: { emailAddress: APPS_SCRIPT_EMAIL } }, 200, 'text/html'),
    appsScriptResponse({ user: { emailAddress: APPS_SCRIPT_EMAIL } }, 200, ''),
  ]) {
    let script: ReturnType<typeof createAppsScriptHarness>
    script = createAppsScriptHarness({ fetch: (url) => url.includes('/about?') ? response : script.defaultFetch(url) })
    assert.throws(script.run, /failed \(source-invalid\)/)
    assert.equal(script.calls.length, 2)
    assert.ok(!script.calls.some((call) => call.url.includes('/files/')))
    assert.deepEqual(JSON.parse(script.calls[1]!.options.payload!).result, { status: 'failed', error: 'source-invalid' })
    assert.ok(!script.logs.join('\n').includes('PRIVATE-MALFORMED'))
  }
})

test('a receiver rejection never retries, follows redirects, or recursively submits an error report', () => {
  for (const response of [
    appsScriptResponse('<html>private login page</html>', 302, 'text/html'),
    appsScriptResponse('<html>private login page</html>', 200, 'text/html'),
    appsScriptResponse({ mode: 'publish', publicationAllowed: true, status: 'baseline' }),
    appsScriptResponse({ error: 'disabled' }, 404),
    appsScriptResponse({ mode: 'observe', publicationAllowed: false, supplierFreshnessEstablished: false, status: 'unknown' }),
    appsScriptResponse({ mode: 'observe', publicationAllowed: false, supplierFreshnessEstablished: false, status: 'failed', error: 'source-invalid' }),
  ]) {
    let script: ReturnType<typeof createAppsScriptHarness>
    script = createAppsScriptHarness({ fetch: (url) => url === APPS_SCRIPT_URL ? response : script.defaultFetch(url) })
    assert.throws(script.run, /failed \(receiver\)/)
    assert.equal(script.calls.filter((call) => call.url === APPS_SCRIPT_URL).length, 1)
    assert.equal(script.run().status, 'already-attempted')
    assert.equal(script.counters().lockReleases, 2)
    assert.ok(!script.logs.join('\n').includes('private login'))
  }
})

test('a network exception is reported without exposing the upstream exception text', () => {
  let script: ReturnType<typeof createAppsScriptHarness>
  script = createAppsScriptHarness({ fetch: (url) => {
    if (url.includes('googleapis.com')) throw new Error('SECRET-TOKEN in request')
    return script.defaultFetch(url)
  } })
  assert.throws(script.run, /failed \(network\)/)
  assert.equal(script.calls.length, 2)
  assert.ok(!script.logs.join('\n').includes('SECRET-TOKEN'))
})
