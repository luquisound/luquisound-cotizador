import assert from 'node:assert/strict'
import test from 'node:test'
import { createQuotation, createRow } from '../src/features/quotation/model.ts'
import { BOARD_MAX_BYTES, BOARD_REQUEST_MAX_BYTES } from '../src/features/quotation-board/board-contract.ts'
import { BoardClientError, createBoardClient } from '../src/features/quotation-board/board-client.ts'
import type { BoardSaveCommand, BoardSaveResponse } from '../src/features/quotation-board/shared-board-types.ts'

function command(): BoardSaveCommand {
  return {
    type: 'save', operationId: crypto.randomUUID(), epoch: 'initial', mode: 'new',
    entryId: crypto.randomUUID(), expectedRevision: null, name: 'Synthetic example', categoryId: null,
    quotation: {
      ...createQuotation(), title: 'Synthetic title', exchangeRate: '1000', exchangeRateMode: 'frozen',
      rows: [{ ...createRow(), concept: 'Synthetic row', unitPrice: '100', priceState: 'priced' }],
    },
  }
}

function saved(input: BoardSaveCommand): BoardSaveResponse {
  return {
    operationId: input.operationId, epoch: input.epoch,
    entry: {
      id: input.entryId, name: input.name, categoryId: input.categoryId,
      revision: input.expectedRevision === null ? 1 : input.expectedRevision + 1,
      updatedAt: '2026-11-04T15:00:00.000Z', quotation: structuredClone(input.quotation),
    },
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}

function assertCode(code: BoardClientError['code']): (error: unknown) => boolean {
  return (error) => error instanceof BoardClientError && error.code === code
}

function assertCommitState(code: BoardClientError['code'], mayHaveCommitted: boolean): (error: unknown) => boolean {
  return (error) => error instanceof BoardClientError && error.code === code && error.mayHaveCommitted === mayHaveCommitted
}

test('board reads use relative same-origin uncached JSON requests and validated summaries', async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const list = { epoch: 'initial', revision: 0, categories: [], entries: [] }
  const client = createBoardClient(async (input, init) => {
    calls.push({ url: String(input), init })
    return json(list)
  })
  assert.deepEqual(await client.listBoard(), list)
  assert.equal(calls[0]!.url, '/api/quotation-board')
  assert.equal(calls[0]!.init?.method, 'GET')
  assert.equal(calls[0]!.init?.credentials, 'same-origin')
  assert.equal(calls[0]!.init?.cache, 'no-store')
  assert.equal(calls[0]!.init?.redirect, 'manual')
  assert.equal(new Headers(calls[0]!.init?.headers).get('accept'), 'application/json')
})

test('entry reads reject mismatched identities and unsafe IDs before trusting a detail', async () => {
  const request = command()
  let calls = 0
  const client = createBoardClient(async (input) => {
    calls += 1
    assert.equal(String(input), `/api/quotation-board?entryId=${request.entryId}`)
    return json({ epoch: 'initial', entry: saved(request).entry })
  })
  assert.equal((await client.getBoardEntry(request.entryId)).entry.id, request.entryId)
  await assert.rejects(client.getBoardEntry('../other-path'), assertCode('invalid'))
  assert.equal(calls, 1)
  const mismatched = createBoardClient(async () => json({ epoch: 'initial', entry: saved(request).entry }))
  await assert.rejects(mismatched.getBoardEntry('another-entry'), assertCode('invalid'))
})

test('save freezes the submitted request before caller edits and confirms the exact saved content', async () => {
  const request = command()
  let body = ''
  let resolve: (response: Response) => void = () => undefined
  const client = createBoardClient(async (_input, init) => {
    body = String(init?.body)
    assert.equal(init?.method, 'POST')
    assert.equal(new Headers(init?.headers).get('content-type'), 'application/json')
    return new Promise<Response>((complete) => { resolve = complete })
  })
  const pending = client.saveBoardEntry(request)
  request.name = 'Changed after submission'
  request.quotation.rows[0]!.unitPrice = '999'
  const sent = JSON.parse(body) as BoardSaveCommand
  resolve(json(saved(sent)))
  const result = await pending
  assert.equal(result.entry.name, 'Synthetic example')
  assert.equal(result.entry.quotation.rows[0]!.unitPrice, '100')
})

test('save refuses unrelated or partially applied confirmations', async () => {
  const variations: ((result: BoardSaveResponse) => void)[] = [
    (result) => { result.operationId = 'other-operation' },
    (result) => { result.epoch = 'other-epoch' },
    (result) => { result.entry.id = 'other-entry' },
    (result) => { result.entry.revision = 2 },
    (result) => { result.entry.name = 'Other name' },
    (result) => { result.entry.categoryId = 'other-category' },
    (result) => { result.entry.quotation.rows[0]!.unitPrice = '999' },
  ]
  for (const change of variations) {
    const request = command()
    const result = saved(request)
    change(result)
    const client = createBoardClient(async () => json(result))
    await assert.rejects(client.saveBoardEntry(request), assertCode('invalid'))
  }
})

test('replacement confirmation requires the next expected source revision', async () => {
  const request: BoardSaveCommand = { ...command(), mode: 'replace', expectedRevision: 7 }
  const client = createBoardClient(async () => json(saved(request)))
  assert.equal((await client.saveBoardEntry(request)).entry.revision, 8)
  const older = saved(request)
  older.entry.revision = 7
  await assert.rejects(createBoardClient(async () => json(older)).saveBoardEntry(request), assertCode('invalid'))
})

test('protected login pages, redirects and denied access never become an empty board', async () => {
  const responses = [
    new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } }),
    Response.redirect('https://example.invalid/login', 302), json({}, 401), json({}, 403),
  ]
  for (const response of responses) {
    await assert.rejects(createBoardClient(async () => response).listBoard(), assertCode('access'))
  }
})

test('disabled endpoint, missing entry, conflict, capacity and unavailable storage stay distinct', async () => {
  await assert.rejects(createBoardClient(async () => json({}, 404)).listBoard(), assertCode('unavailable'))
  await assert.rejects(createBoardClient(async () => json({}, 404)).getBoardEntry('entry'), assertCode('not-found'))
  await assert.rejects(createBoardClient(async () => json({}, 409)).saveBoardEntry(command()), assertCode('conflict'))
  await assert.rejects(createBoardClient(async () => json({}, 413)).saveBoardEntry(command()), assertCode('capacity'))
  await assert.rejects(createBoardClient(async () => json({}, 503)).listBoard(), assertCode('unavailable'))
})

test('malformed JSON, unsupported content, structural errors and bad UTF-8 are rejected', async () => {
  const responses = [
    new Response('{', { headers: { 'content-type': 'application/json' } }),
    new Response('{}', { headers: { 'content-type': 'text/plain' } }),
    json({ epoch: 'initial', revision: 0, categories: [], entries: [{ name: 'Incomplete' }] }),
    new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
  ]
  for (const response of responses) {
    await assert.rejects(createBoardClient(async () => response).listBoard(), assertCode('invalid'))
  }
})

test('declared and streamed response bounds prevent accepting oversized data', async () => {
  const declared = new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(BOARD_MAX_BYTES + 1) } })
  await assert.rejects(createBoardClient(async () => declared).listBoard(), assertCode('invalid'))
  const streamed = new Response(new Uint8Array(BOARD_MAX_BYTES + 1), { headers: { 'content-type': 'application/json' } })
  await assert.rejects(createBoardClient(async () => streamed).listBoard(), assertCode('invalid'))
})

test('oversized writes fail before a request and never truncate the submitted quotation', async () => {
  const request = command()
  request.quotation.notes = 'x'.repeat(BOARD_REQUEST_MAX_BYTES + 1)
  let called = false
  const client = createBoardClient(async () => { called = true; return json({}) })
  await assert.rejects(client.saveBoardEntry(request), assertCode('capacity'))
  assert.equal(called, false)
  assert.equal(request.quotation.notes.length, BOARD_REQUEST_MAX_BYTES + 1)
})

test('network details are not exposed and writes are retried only by an explicit caller action', async () => {
  const request = command()
  const bodies: string[] = []
  const client = createBoardClient(async (_input, init) => {
    bodies.push(String(init?.body))
    if (bodies.length === 1) throw new TypeError('private upstream detail')
    return json(saved(request))
  })
  await assert.rejects(client.saveBoardEntry(request), (error: unknown) => {
    assert.equal(error instanceof BoardClientError && error.code, 'network')
    assert.equal(error instanceof Error && error.message.includes('private upstream detail'), false)
    return true
  })
  assert.equal(bodies.length, 1)
  await client.saveBoardEntry(request)
  assert.equal(bodies.length, 2)
  assert.equal(bodies[0], bodies[1])
})

test('caller cancellation aborts active requests and can prevent a request entirely', async () => {
  const cancelled = new AbortController()
  cancelled.abort()
  let calls = 0
  let receivedSignal: AbortSignal | null = null
  const client = createBoardClient(async (_input, init) => {
    calls += 1
    receivedSignal = init?.signal as AbortSignal
    return new Promise<Response>(() => undefined)
  })
  await assert.rejects(client.listBoard(cancelled.signal), { name: 'AbortError' })
  assert.equal(calls, 0)
  const active = new AbortController()
  const pending = client.listBoard(active.signal)
  active.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(calls, 1)
  assert.equal((receivedSignal as AbortSignal | null)?.aborted, true)
})

test('timeouts also terminate a stalled body read and cancel its stream', async () => {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
  const client = createBoardClient(async () => new Response(body, { headers: { 'content-type': 'application/json' } }), { timeoutMs: 10 })
  await assert.rejects(client.listBoard(), assertCode('network'))
  assert.equal(cancelled, true)
})

test('a late response from an ignored abort signal is cancelled instead of remaining readable', async () => {
  let complete: (response: Response) => void = () => undefined
  let cancelled = false
  const client = createBoardClient(async () => new Promise<Response>((resolve) => { complete = resolve }), { timeoutMs: 10 })
  const pending = client.listBoard()
  await assert.rejects(pending, assertCode('network'))
  complete(new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true } }), { headers: { 'content-type': 'application/json' } }))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(cancelled, true)
})

test('inline category creation still requires a category in the confirmation', async () => {
  const request: BoardSaveCommand = { ...command(), newCategoryName: 'New category' }
  const missing = createBoardClient(async () => json(saved(request)))
  await assert.rejects(missing.saveBoardEntry(request), assertCode('invalid'))
  const result = saved(request)
  result.entry.categoryId = 'new-category'
  assert.equal((await createBoardClient(async () => json(result)).saveBoardEntry(request)).entry.categoryId, 'new-category')
})

test('write transport failures, server failures and unreadable successful confirmations remain uncertain', async () => {
  const cases: { response: () => Promise<Response>; code: BoardClientError['code'] }[] = [
    { response: async () => { throw new TypeError('Lost response') }, code: 'network' },
    { response: async () => json({}, 500), code: 'unavailable' },
    { response: async () => json({}, 503), code: 'unavailable' },
    { response: async () => new Response('{', { headers: { 'content-type': 'application/json' } }), code: 'invalid' },
    { response: async () => json({ invalid: true }), code: 'invalid' },
    { response: async () => new Response('{}', { headers: { 'content-type': 'text/plain' } }), code: 'invalid' },
  ]
  for (const item of cases) {
    await assert.rejects(createBoardClient(item.response).saveBoardEntry(command()), assertCommitState(item.code, true))
  }
  const timedOut = createBoardClient(async () => new Promise<Response>(() => undefined), { timeoutMs: 10 })
  await assert.rejects(timedOut.saveBoardEntry(command()), assertCommitState('network', true))
})

test('post-success correlation mismatches require resolving the submitted operation', async () => {
  const request = command()
  const result = saved(request)
  result.entry.name = 'Unrelated result'
  await assert.rejects(createBoardClient(async () => json(result)).saveBoardEntry(request), assertCommitState('invalid', true))
})

test('reads, local validation, rejected writes and access responses never imply a commit', async () => {
  assert.equal(new BoardClientError('network').mayHaveCommitted, false)
  await assert.rejects(createBoardClient(async () => json({}, 503)).listBoard(), assertCommitState('unavailable', false))
  await assert.rejects(createBoardClient(async () => json({ invalid: true })).listBoard(), assertCommitState('invalid', false))
  await assert.rejects(createBoardClient(async () => { throw new TypeError('Offline') }).listBoard(), assertCommitState('network', false))
  let called = false
  const invalid = { ...command(), name: '' }
  await assert.rejects(createBoardClient(async () => { called = true; return json({}) }).saveBoardEntry(invalid), assertCommitState('invalid', false))
  assert.equal(called, false)
  for (const status of [400, 404, 408, 409, 413, 415, 422, 429]) {
    await assert.rejects(createBoardClient(async () => json({}, status)).saveBoardEntry(command()), (error: unknown) => (
      error instanceof BoardClientError && error.mayHaveCommitted === false
    ))
  }
  for (const response of [
    json({}, 401), json({}, 403), Response.redirect('https://example.invalid/login', 302),
    new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } }),
  ]) {
    await assert.rejects(createBoardClient(async () => response).saveBoardEntry(command()), assertCommitState('access', false))
  }
})

test('known category and limit codes use safe actionable messages instead of server text', async () => {
  const cases = [
    { serverCode: 'limit', clientCode: 'capacity', message: 'tamaño permitido' },
    { serverCode: 'too-large', clientCode: 'capacity', message: 'tamaño permitido' },
    { serverCode: 'category-exists', clientCode: 'category-exists', message: 'Seleccionala en la lista' },
    { serverCode: 'category-missing', clientCode: 'category-missing', message: 'Elegí otra categoría' },
  ] as const
  for (const status of [400, 409]) {
    for (const item of cases) {
      await assert.rejects(createBoardClient(async () => json({ error: item.serverCode, message: 'private upstream detail' }, status)).saveBoardEntry(command()), (error: unknown) => {
        assert.ok(error instanceof BoardClientError)
        assert.equal(error.code, item.clientCode)
        assert.equal(error.mayHaveCommitted, false)
        assert.equal(error.message.includes(item.message), true)
        assert.equal(error.message.includes('private upstream detail'), false)
        return true
      })
    }
  }
  for (const status of [400, 409]) {
    await assert.rejects(createBoardClient(async () => json({ error: 'unknown-code', message: 'private upstream detail' }, status)).saveBoardEntry(command()), (error: unknown) => {
      assert.ok(error instanceof BoardClientError)
      assert.equal(error.code, status === 400 ? 'invalid' : 'conflict')
      assert.equal(error.mayHaveCommitted, false)
      assert.equal(error.message.includes('private upstream detail'), false)
      return true
    })
  }
})

test('malformed or stalled error details preserve the definite HTTP rejection', async () => {
  for (const status of [400, 409]) {
    const expected = status === 400 ? 'invalid' : 'conflict'
    await assert.rejects(createBoardClient(async () => new Response('{', {
      status, headers: { 'content-type': 'application/json' },
    })).saveBoardEntry(command()), assertCommitState(expected, false))
    const client = createBoardClient(async () => new Response(new ReadableStream<Uint8Array>(), {
      status, headers: { 'content-type': 'application/json' },
    }), { timeoutMs: 10 })
    await assert.rejects(client.saveBoardEntry(command()), assertCommitState(expected, false))
  }
})
