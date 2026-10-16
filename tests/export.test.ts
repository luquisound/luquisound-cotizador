import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createQuotationFile, quotationFileName, shareQuotationFile, wrapText,
} from '../src/features/quotation/export.ts'
import type { Quotation } from '../src/features/quotation/model.ts'

const measure = (text: string): number => Array.from(text).length
const file = new File(['synthetic image data'], 'luquisound-test.png', { type: 'image/png' })

test('wraps complete words and preserves paragraph breaks', () => {
  assert.deepEqual(wrapText(measure, 'Audio para auto\n\nInstalación incluida', 12), [
    'Audio para', 'auto', '', 'Instalación', 'incluida',
  ])
})

test('wraps a long unbroken concept without losing characters', () => {
  const text = 'UnConceptoMuyExtensoSinEspacios'
  const lines = wrapText(measure, text, 8)
  assert.equal(lines.join(''), text)
  assert.ok(lines.every((line) => measure(line) <= 8))
})

test('keeps exact-width text on one line and preserves empty paragraphs', () => {
  assert.deepEqual(wrapText(measure, '12345', 5), ['12345'])
  assert.deepEqual(wrapText(measure, '  \n\n', 5), ['', '', ''])
  assert.deepEqual(wrapText(measure, '', 5), [''])
})

test('wraps extensive notes without clipping their final content', () => {
  const words = Array.from({ length: 1000 }, (_, index) => `Nota${index}`)
  const lines = wrapText(measure, words.join(' '), 40)
  assert.equal(lines.join(' '), words.join(' '))
  assert.ok(lines.every((line) => measure(line) <= 40))
  assert.ok(lines.at(-1)?.endsWith('Nota999'))
})

test('does not split a Unicode surrogate pair and normalizes line endings', () => {
  assert.deepEqual(wrapText(measure, 'ab🎵cd\r\nef', 3), ['ab🎵', 'cd', 'ef'])
})

test('rejects unusable wrapping widths', () => {
  for (const width of [0, -1, NaN, Infinity]) {
    assert.throws(() => wrapText(measure, 'Audio', width), RangeError)
  }
  assert.throws(() => wrapText(() => 10, 'A', 5), RangeError)
})

test('creates a safe PNG filename from arbitrary titles', () => {
  assert.equal(quotationFileName({ title: '  Instalación + Audio / opción 2 ' }), 'luquisound-instalacion-audio-opcion-2.png')
  assert.equal(quotationFileName({ title: '../\\\u0000:' }), 'luquisound-presupuesto.png')
  assert.equal(quotationFileName({ title: 'A'.repeat(200) }).length, 'luquisound-'.length + 80 + '.png'.length)
})

test('rejects incomplete quotations before accessing browser APIs', async () => {
  const quotation: Quotation = {
    id: 'synthetic', title: '', subtitle: '', currency: 'ARS', rows: [], notes: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
  await assert.rejects(createQuotationFile(quotation), /campos pendientes/)
})

test('blocks an unresolved amount even when a zero was previously typed', async () => {
  const quotation: Quotation = {
    id: 'synthetic', title: 'PRESUPUESTO', subtitle: '', currency: 'ARS', notes: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    rows: [{
      id: 'synthetic-row', section: 'extras', concept: 'Trabajo de ejemplo', detail: '',
      quantity: '1', unitPrice: '0', priceState: 'pending',
    }],
  }
  await assert.rejects(createQuotationFile(quotation), /campos pendientes/)
  quotation.rows[0].priceState = 'priced'
  quotation.rows[0].unitPrice = ''
  await assert.rejects(createQuotationFile(quotation), /campos pendientes/)
})

test('invokes file sharing immediately before returning control to the click handler', async () => {
  let calls = 0
  const result = shareQuotationFile(file, {
    canShare: (data) => data.files[0] === file,
    share: (data) => {
      calls += 1
      assert.deepEqual(data.files, [file])
      return Promise.resolve()
    },
  })
  assert.equal(calls, 1)
  assert.equal(await result, 'shared')
})

test('returns unsupported without attempting a share if files cannot be shared', async () => {
  let calls = 0
  assert.equal(await shareQuotationFile(file, {}), 'unsupported')
  assert.equal(await shareQuotationFile(file, {
    canShare: () => false,
    share: () => { calls += 1; return Promise.resolve() },
  }), 'unsupported')
  assert.equal(await shareQuotationFile(file, {
    share: () => { calls += 1; return Promise.resolve() },
  }), 'unsupported')
  assert.equal(calls, 0)
})

test('treats closing the share sheet as cancellation without a fallback effect', async () => {
  const error = new DOMException('Cancelled by user', 'AbortError')
  assert.equal(await shareQuotationFile(file, {
    canShare: () => true,
    share: () => Promise.reject(error),
  }), 'cancelled')
})

test('allows sharing again after cancellation and after success', async () => {
  let attempts = 0
  const adapter = {
    canShare: () => true,
    share: (): Promise<void> => {
      attempts += 1
      return attempts === 1 ? Promise.reject({ name: 'AbortError' }) : Promise.resolve()
    },
  }
  assert.equal(await shareQuotationFile(file, adapter), 'cancelled')
  assert.equal(await shareQuotationFile(file, adapter), 'shared')
  assert.equal(await shareQuotationFile(file, adapter), 'shared')
  assert.equal(attempts, 3)
})

test('propagates sharing errors so the interface can explain them', async () => {
  const error = new DOMException('Activation expired', 'NotAllowedError')
  await assert.rejects(shareQuotationFile(file, {
    canShare: () => true, share: () => Promise.reject(error),
  }), (received: unknown) => received === error)
})

test('preserves synchronous sharing and capability errors', async () => {
  const error = new Error('Capability unavailable')
  await assert.rejects(shareQuotationFile(file, {
    canShare: () => { throw error }, share: () => Promise.resolve(),
  }), (received: unknown) => received === error)
  assert.equal(await shareQuotationFile(file, {
    canShare: () => true, share: () => { throw new DOMException('Closed', 'AbortError') },
  }), 'cancelled')
})
