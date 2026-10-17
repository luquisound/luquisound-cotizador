import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createQuotationFile, quotationFileName, renderQuotationCanvas, shareQuotationFile, wrapText,
} from '../src/features/quotation/export.ts'
import { exchangeRateDescription } from '../src/features/quotation/exchange-quote.ts'
import type { Quotation } from '../src/features/quotation/model.ts'
import { QUOTATION_GRAPHIC } from '../src/features/quotation/graphic.ts'

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
      quantity: '1', currency: 'ARS', unitPrice: '0', priceState: 'pending',
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

interface CanvasText {
  text: string
  x: number
  y: number
  width: number
  align: string
  color: string
}

interface CanvasRectangle {
  x: number
  y: number
  width: number
  height: number
  color: string
}

function renderWithRecordedCanvas(quotation: Quotation): {
  width: number
  height: number
  texts: CanvasText[]
  rectangles: CanvasRectangle[]
  footerY: number
} {
  const texts: CanvasText[] = []
  const rectangles: CanvasRectangle[] = []
  const noop = () => {}
  const context = {
    font: '', fillStyle: '', strokeStyle: '', textAlign: '', textBaseline: '', lineWidth: 0,
    measureText(text: string) {
      const size = Number(/([0-9]+)px/.exec(this.font)?.[1] ?? '24')
      return { width: Array.from(text).length * size * 0.75 }
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, width: this.measureText(text).width, align: this.textAlign, color: this.fillStyle })
    },
    fillRect(x: number, y: number, width: number, height: number) {
      rectangles.push({ x, y, width, height, color: this.fillStyle })
    },
    beginPath: noop, moveTo: noop, lineTo: noop, quadraticCurveTo: noop,
    stroke: noop, arc: noop, fill: noop, bezierCurveTo: noop, closePath: noop,
    drawImage: noop, save: noop, translate: noop, scale: noop, restore: noop,
  }
  const canvas = { width: 0, height: 0, getContext: () => context }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => canvas },
  })
  try {
    const result = renderQuotationCanvas(quotation, {} as CanvasImageSource)
    const footer = rectangles.at(-1)
    assert.ok(footer)
    return { width: result.width, height: result.height, texts, rectangles, footerY: footer.y }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else Reflect.deleteProperty(globalThis, 'document')
  }
}

function exportableQuotation(): Quotation {
  return {
    id: 'synthetic-export', title: 'PRESUPUESTO', subtitle: '', currency: 'ARS', notes: '',
    exchangeRate: '1.234,56',
    exchangeRateQuote: {
      rate: '1.234,56', source: 'DolarAPI', market: 'blue', side: 'sell',
      updatedAt: '2026-10-16T13:30:00.000Z', fetchedAt: '2026-10-16T13:31:00.000Z',
    },
    createdAt: '2026-10-16T13:31:00.000Z', updatedAt: '2026-10-16T13:31:00.000Z',
    rows: [{
      id: 'synthetic-row', section: 'equipment', concept: 'Equipo de prueba', detail: '',
      quantity: '1', currency: 'ARS', unitPrice: '2400', priceState: 'priced',
    }],
  }
}

test('renders a yellow custom header with dark text and keeps the contact footer dark', () => {
  const quotation = { ...exportableQuotation(), title: 'AUDIO A MEDIDA', subtitle: 'Vehiculo de prueba' }
  const result = renderWithRecordedCanvas(quotation)
  const header = result.rectangles[1]
  assert.ok(header)
  assert.equal(header.y, 0)
  assert.equal(header.width, 1080)
  assert.equal(header.color, '#FFDA00')
  const headerTexts = result.texts.filter(({ y }) => y < header.height)
  assert.deepEqual(headerTexts.map(({ text }) => text), [
    'PRESUPUESTO', 'DE AUDIO', 'AUDIO A MEDIDA', 'Vehiculo de prueba',
  ])
  assert.ok(headerTexts.every(({ color }) => color === '#141414'))
  assert.ok(result.rectangles.some(({ y, height, color }) => y === header.height && height === 5 && color === '#141414'))
  assert.equal(result.rectangles.at(-1)?.color, '#141414')
  const contacts = result.texts.filter(({ y }) => y > result.footerY)
  assert.deepEqual(contacts.map(({ text }) => text), ['11 7358-1958', '@luquisound.ok'])
  assert.ok(contacts.every(({ color }) => color === '#FFDA00'))
})

test('loads the shared black logo resource before preparing the PNG', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Image')
  const requested: string[] = []
  class LogoImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(value: string) {
      requested.push(value)
      queueMicrotask(() => this.onerror?.())
    }
  }
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: LogoImage })
  try {
    await assert.rejects(createQuotationFile(exportableQuotation()), /logo/)
    assert.equal(QUOTATION_GRAPHIC.logoUrl, '/brand/luquisound-horizontal-black.svg')
    assert.deepEqual(requested, [QUOTATION_GRAPHIC.logoUrl])
  } finally {
    if (previous) Object.defineProperty(globalThis, 'Image', previous)
    else Reflect.deleteProperty(globalThis, 'Image')
  }
})

test('renders the stored source and date completely between the rate and footer', () => {
  const quotation = exportableQuotation()
  const result = renderWithRecordedCanvas(quotation)
  const rate = result.texts.find((entry) => entry.text === '1 USD = 1.234,56 ARS')
  assert.ok(rate)
  const sourceLines = result.texts.filter((entry) => entry.y > rate.y && entry.y < result.footerY)
  assert.equal(sourceLines.map((entry) => entry.text).join(' '), 'Dólar blue · DolarAPI · 16/10/2026, 10:30 (Buenos Aires)')
  assert.ok(sourceLines.length > 1)
  assert.ok(sourceLines.every((entry) => entry.x + entry.width <= 1016 && entry.y + 30 <= result.footerY))
  assert.ok(!result.texts.some((entry) => /Actualizar|Consultando|Error/.test(entry.text)))
})

test('grows a long quotation image to reserve every wrapped source line above the footer', () => {
  const quotation = exportableQuotation()
  quotation.rows = Array.from({ length: 30 }, (_, index) => ({
    ...quotation.rows[0], id: `synthetic-row-${index}`,
  }))
  const automatic = renderWithRecordedCanvas(quotation)
  const legacy = renderWithRecordedCanvas({ ...quotation, exchangeRateQuote: undefined })
  assert.ok(automatic.height > legacy.height)
  const rate = automatic.texts.find((entry) => entry.text === '1 USD = 1.234,56 ARS')
  assert.ok(rate)
  const sourceLines = automatic.texts.filter((entry) => entry.y > rate.y && entry.y < automatic.footerY)
  assert.equal(sourceLines.map((entry) => entry.text).join(' '), exchangeRateDescription(quotation))
  assert.ok(sourceLines.every((entry) => entry.y + 30 <= automatic.footerY))
  assert.ok(legacy.texts.some((entry) => entry.text.includes('Cotización manual')))
})

test('renders mixed row currencies, unit prices and converted totals without clipping long descriptions', () => {
  const quotation = exportableQuotation()
  quotation.exchangeRate = '1000'
  quotation.exchangeRateQuote = undefined
  quotation.rows = [
    {
      ...quotation.rows[0], concept: 'Amplificador '.repeat(25).trim(),
      detail: `${'Descripción extensa '.repeat(50)}Final del detalle`,
      currency: 'USD', quantity: '2', unitPrice: '12,50',
    },
    {
      ...quotation.rows[0], id: 'synthetic-installation', section: 'extras',
      concept: 'Instalación de prueba', currency: 'ARS', unitPrice: '35000',
    },
  ]
  const result = renderWithRecordedCanvas(quotation)
  const text = result.texts.map((entry) => entry.text).join(' ')
  assert.equal(result.width, 1080)
  assert.ok(text.includes('2 × USD 12,50 c/u'))
  assert.ok(text.includes('USD 25,00'))
  assert.ok(text.includes('ARS 35.000,00'))
  assert.ok(text.includes('60.000,00'))
  assert.ok(text.includes('60,00'))
  assert.ok(text.includes('Final del detalle'))
  assert.ok(text.includes('1 USD = 1.000 ARS'))
  const bodyTexts = result.texts.filter((entry) => entry.y >= 348 && entry.y < result.footerY)
  assert.ok(bodyTexts.every((entry) => entry.y + 30 <= result.footerY))
  assert.ok(bodyTexts.every((entry) => entry.align === 'right'
    ? entry.x - entry.width >= 64
    : entry.x + entry.width <= 1016))
})

test('exports categorized concepts in display order without empty suggestions or category controls', () => {
  const quotation = exportableQuotation()
  const sample = quotation.rows[0]
  quotation.rows = [
    { ...sample, id: 'labor', section: 'extras', audioCategory: 'labor', concept: 'Labor item' },
    { ...sample, id: 'free-a', concept: 'Custom unit A' },
    { ...sample, id: 'front', audioCategory: 'speakers', concept: 'Front set' },
    { ...sample, id: 'cables', section: 'extras', audioCategory: 'cables', concept: 'Wire kit' },
    { ...sample, id: 'bass', audioCategory: 'subwoofer', concept: 'Bass unit' },
    { ...sample, id: 'rear', audioCategory: 'speakers', concept: 'Rear set' },
    { ...sample, id: 'dsp', audioCategory: 'amplifier-dsp', concept: 'DSP unit' },
    { ...sample, id: 'extra', section: 'extras', concept: 'Custom work' },
    { ...sample, id: 'free-b', concept: 'Custom unit B' },
  ]
  const populated = renderWithRecordedCanvas(quotation)
  quotation.rows.push(
    {
      ...sample, id: 'empty-amplifier', audioCategory: 'additional-amplifier',
      concept: '', unitPrice: '', priceState: 'pending',
    },
    {
      ...sample, id: 'empty-adapters', section: 'extras', audioCategory: 'adapters',
      concept: '', unitPrice: '', priceState: 'pending',
    },
  )
  const snapshot = structuredClone(quotation)
  const result = renderWithRecordedCanvas(quotation)
  const concepts = [
    'DSP unit', 'Bass unit', 'Front set', 'Rear set', 'Custom unit A', 'Custom unit B',
    'Wire kit', 'Labor item', 'Custom work',
  ]
  assert.deepEqual(result.texts.filter(({ text }) => concepts.includes(text)).map(({ text }) => text), concepts)
  assert.equal(result.height, populated.height)
  assert.equal(result.width, 1080)
  const labels = [
    'Amplificador / DSP', 'Amplificador adicional', 'Subwoofer', 'Parlantes o componentes',
    'Cables y accesorios', 'Ficha / arnés', 'Aros / adaptadores 3D', 'Mano de obra',
    'Agregar otro',
  ]
  assert.ok(!result.texts.some(({ text }) => labels.includes(text)))
  assert.deepEqual(quotation, snapshot)
})
