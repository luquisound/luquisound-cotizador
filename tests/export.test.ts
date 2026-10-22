import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createQuotationFile, LOGO_LOAD_TIMEOUT_MS, quotationFileName, renderQuotationCanvas, shareQuotationFile, wrapText,
  type QuotationExportOptions,
} from '../src/features/quotation/export.ts'
import { exchangeRateDescription } from '../src/features/quotation/exchange-quote.ts'
import type { CatalogItem, Quotation } from '../src/features/quotation/model.ts'
import { QUOTATION_GRAPHIC } from '../src/features/quotation/graphic.ts'
import { rowFromCatalog } from '../src/features/quotation/row-provenance.ts'

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
  font: string
}

interface CanvasRectangle {
  x: number
  y: number
  width: number
  height: number
  color: string
}

function renderWithRecordedCanvas(quotation: Quotation, options: QuotationExportOptions = {}): {
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
      texts.push({ text, x, y, width: this.measureText(text).width, align: this.textAlign, color: this.fillStyle, font: this.font })
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
    const result = renderQuotationCanvas(quotation, {} as CanvasImageSource, options)
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

test('new coded selections export their complete commercial title while saved and explicit details remain visible', () => {
  const item: CatalogItem = {
    id: 'synthetic-title', section: 'equipment', sku: 'SYN-RX65',
    concept: 'Synthetic RX-65 MK-II 6.5-inch (pair)', detail: 'SUPPLIER SPECIFICATIONS OMITTED',
    unitPrice: '123,45', currency: 'ARS',
  }
  const selected = rowFromCatalog(item, 'equipment')
  const oldRow = { ...selected, id: 'synthetic-saved', detail: 'Previously saved customer detail' }
  const manualRow = { ...selected, id: 'synthetic-manual', detail: 'Explicit installation instructions' }
  const quotation = { ...exportableQuotation(), rows: [selected, oldRow, manualRow] }
  const before = structuredClone(quotation)
  const rendered = renderWithRecordedCanvas(quotation)
  const text = rendered.texts.map((entry) => entry.text).join(' ')
  assert.ok(text.includes(item.concept))
  assert.ok(!text.includes(item.detail))
  assert.ok(text.includes(oldRow.detail))
  assert.ok(text.includes(manualRow.detail))
  assert.deepEqual(quotation, before)
})

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

test('requests the original multicolour logo and reports an unavailable resource', async () => {
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
    assert.equal(QUOTATION_GRAPHIC.logoUrl, '/brand/luquisound-horizontal.svg')
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

test('exports complete 500-character product names with separate legible prices and increasing row heights', () => {
  const quotation = exportableQuotation()
  const names = [
    { body: 'Nombre sintetico con espacios y modelo completo ', end: 'FIN MODELO ZX-501' },
    { body: 'NOMBRESINTETICOSINESPACIOS', end: 'FINMODELOZX502' },
    { body: 'Primera linea sintetica\nSegunda linea con modelo completo\n', end: '\nFIN MODELO ZX-503' },
  ].map(({ body, end }) => body.repeat(20).slice(0, 500 - end.length) + end)
  assert.ok(names.every((name) => name.length === 500))
  quotation.rows = names.map((concept, index) => ({
    ...quotation.rows[0], id: `synthetic-long-name-${index}`, concept, detail: '',
  }))
  const before = structuredClone(quotation)
  const result = renderWithRecordedCanvas(quotation)
  const short = renderWithRecordedCanvas({
    ...quotation, rows: quotation.rows.map((row) => ({ ...row, concept: 'Nombre sintetico corto' })),
  })
  assert.ok(result.height > short.height)
  assert.equal(result.width, 1080)
  const nameTexts = result.texts.filter(({ font }) => / 36px /.test(font))
  const prices = result.texts.filter(({ font }) => / 38px /.test(font))
  const boundaries = result.rectangles.filter(({ color }) => color === '#D8D8D8')
  const total = result.texts.find(({ text }) => text === 'TOTAL')
  assert.ok(total)
  assert.equal(prices.length, names.length)
  assert.equal(boundaries.length, names.length)
  let previousBoundary = result.rectangles[1].height
  for (const [index, boundary] of boundaries.entries()) {
    const lines = nameTexts.filter(({ y }) => y > previousBoundary && y < boundary.y)
    const amounts = prices.filter(({ y }) => y > previousBoundary && y < boundary.y)
    assert.ok(lines.length > 1)
    assert.equal(lines.map(({ text }) => text).join('').replace(/\s/g, ''), names[index].replace(/\s/g, ''))
    assert.equal(amounts.length, 1)
    const amount = amounts[0]
    assert.equal(amount.text, 'ARS 2.400,00')
    assert.equal(amount.align, 'right')
    assert.ok(amount.y + 38 <= boundary.y)
    assert.ok(amount.x <= result.width && amount.x - amount.width >= 64)
    assert.ok(lines.every(({ x, y, width }) => x >= 64 && x + width < amount.x - amount.width
      && y + 36 <= boundary.y && y + 36 < total.y))
    previousBoundary = boundary.y
  }
  assert.ok(previousBoundary < total.y && total.y < result.footerY)
  assert.deepEqual(quotation, before)
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

function provisionalQuotation(): Quotation {
  const quotation = exportableQuotation()
  const source = {
    document: 'PRIVATE-SOURCE-ONLY.xlsx', sheet: 'PRIVATE-SHEET', row: 123, date: null,
    version: 'PRIVATE-VERSION', checksum: 'f'.repeat(64),
  }
  quotation.rows[0].provenance = {
    catalogItemId: 'private-item', supplier: 'PRIVATE-SUPPLIER', sku: 'PRIVATE-SKU', source,
    originalUnitPrice: '2400', originalCurrency: 'ARS', priceBasis: 'provisional-list',
    listPrice: { amount: '2400', currency: 'ARS', basis: 'retail-list-before-discount', provisional: true, source },
    stock: { quantity: 4, checkedAt: null, validUntil: null, observation: 'historical', source },
    availabilityPolicy: 'historical-positive',
  }
  return quotation
}

test('exports only the customer availability warning while retaining private trace outside the image', () => {
  const quotation = provisionalQuotation()
  const result = renderWithRecordedCanvas(quotation, { availabilityWarning: false })
  const texts = result.texts.map(({ text }) => text).join(' ')
  assert.equal(result.texts.filter(({ text }) => text === 'Disponibilidad a confirmar.').length, 1)
  assert.doesNotMatch(texts, /PRIVATE-|ffff|private-item|Stock|Histórico/)
  assert.ok(texts.includes('ARS 2.400,00'))
  const warning = result.texts.find(({ text }) => text === 'Disponibilidad a confirmar.')!
  assert.ok(warning.x + warning.width <= 1016)
  assert.ok(warning.y + 30 <= result.footerY)
})

test('supports an explicit availability warning without adding private metadata to manual quotations', () => {
  const quotation = exportableQuotation()
  const ordinary = renderWithRecordedCanvas(quotation)
  const warning = renderWithRecordedCanvas(quotation, { availabilityWarning: true })
  assert.ok(!ordinary.texts.some(({ text }) => text === 'Disponibilidad a confirmar.'))
  assert.ok(warning.texts.some(({ text }) => text === 'Disponibilidad a confirmar.'))
  assert.equal(ordinary.rectangles[1].color, warning.rectangles[1].color)
  assert.equal(ordinary.rectangles[1].height, warning.rectangles[1].height)
  assert.equal(ordinary.rectangles.at(-1)?.color, warning.rectangles.at(-1)?.color)
})

test('grows an extensive image to reserve the availability warning above the contact footer', () => {
  const quotation = provisionalQuotation()
  quotation.rows = Array.from({ length: 30 }, (_, index) => ({
    ...quotation.rows[0], id: `synthetic-provisional-${index}`,
  }))
  const provisional = renderWithRecordedCanvas(quotation)
  const ordinary = renderWithRecordedCanvas({
    ...quotation, rows: quotation.rows.map(({ provenance: _provenance, ...row }) => row),
  })
  assert.equal(provisional.height - ordinary.height, 44)
  const warning = provisional.texts.find(({ text }) => text === 'Disponibilidad a confirmar.')!
  assert.ok(warning.y + 30 <= provisional.footerY)
  assert.ok(provisional.texts.filter(({ y }) => y < provisional.footerY).every(({ y }) => y + 30 <= provisional.footerY))
})

test('blocks zero, negative, unknown, stale and quarantined source rows before accessing browser APIs', async () => {
  for (const quantity of [0, -1, null]) {
    const quotation = provisionalQuotation()
    quotation.rows[0].provenance!.stock!.quantity = quantity
    await assert.rejects(createQuotationFile(quotation), /stock/)
    assert.throws(() => renderQuotationCanvas(quotation, {} as CanvasImageSource), /stock/)
  }
  const stale = provisionalQuotation()
  stale.rows[0].provenance!.availabilityPolicy = 'fresh-positive'
  stale.rows[0].provenance!.stock = {
    ...stale.rows[0].provenance!.stock!, observation: 'current',
    checkedAt: '2020-01-01T00:00:00.000Z', validUntil: '2020-01-01T00:15:00.000Z',
  }
  await assert.rejects(createQuotationFile(stale), /venció/)
  const blocked = provisionalQuotation()
  blocked.rows[0].provenance!.selectionBlock = 'Synthetic source conflict'
  await assert.rejects(createQuotationFile(blocked), /Synthetic source conflict/)
})

test('a logo that never settles times out after fifteen seconds and releases handlers', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Image')
  const images: HangingLogo[] = []
  class HangingLogo {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor() { images.push(this) }
    set src(_value: string) {}
  }
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: HangingLogo })
  try {
    const pending = createQuotationFile(exportableQuotation())
    const rejected = assert.rejects(pending, /logo tardó demasiado/)
    const lateLoad = images[0].onload
    context.mock.timers.tick(LOGO_LOAD_TIMEOUT_MS - 1)
    assert.notEqual(images[0].onload, null)
    context.mock.timers.tick(1)
    await rejected
    assert.equal(images[0].onload, null)
    assert.equal(images[0].onerror, null)
    lateLoad?.()
    context.mock.timers.tick(60_000)
  } finally {
    context.mock.timers.reset()
    if (previous) Object.defineProperty(globalThis, 'Image', previous)
    else Reflect.deleteProperty(globalThis, 'Image')
  }
})

test('a verified latest observation can replace expired stored stock while current zero and expiry still block export', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-17T10:05:00.000Z') })
  const quotation = provisionalQuotation()
  const provenance = quotation.rows[0].provenance!
  provenance.availabilityPolicy = 'fresh-positive'
  provenance.stock = {
    ...provenance.stock!, observation: 'current',
    checkedAt: '2020-01-01T00:00:00.000Z', validUntil: '2020-01-01T00:15:00.000Z',
  }
  const latest: CatalogItem = {
    id: provenance.catalogItemId, concept: quotation.rows[0].concept, detail: '', section: 'equipment',
    supplier: provenance.supplier, sku: provenance.sku, currency: 'ARS', unitPrice: '2400',
    availabilityPolicy: 'fresh-positive', stock: {
      ...provenance.stock, checkedAt: '2026-10-17T10:00:00.000Z', validUntil: '2026-10-17T10:15:00.000Z',
    },
  }
  const before = structuredClone(quotation)
  assert.throws(() => renderWithRecordedCanvas(quotation), /venció/)
  assert.ok(renderWithRecordedCanvas(quotation, { availabilityCatalog: [latest] }).width > 0)
  const previousImage = Object.getOwnPropertyDescriptor(globalThis, 'Image')
  let requests = 0
  class FailedLogo {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) { requests += 1; queueMicrotask(() => this.onerror?.()) }
  }
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: FailedLogo })
  try {
    await assert.rejects(createQuotationFile(quotation, { availabilityCatalog: [latest] }), /logo/)
    assert.equal(requests, 1)
    const zero = { ...latest, stock: { ...latest.stock!, quantity: 0 } }
    await assert.rejects(createQuotationFile(quotation, { availabilityCatalog: [zero] }), /cero/)
    assert.throws(() => renderWithRecordedCanvas(quotation, { availabilityCatalog: [zero] }), /cero/)
    context.mock.timers.tick(10 * 60_000)
    await assert.rejects(createQuotationFile(quotation, { availabilityCatalog: [latest] }), /venció/)
    assert.equal(requests, 1)
    assert.deepEqual(quotation, before)
  } finally {
    context.mock.timers.reset()
    if (previousImage) Object.defineProperty(globalThis, 'Image', previousImage)
    else Reflect.deleteProperty(globalThis, 'Image')
  }
})

test('exports adapter variants under one heading with separate native currency amounts', () => {
  const quotation = exportableQuotation()
  const sample = quotation.rows[0]
  quotation.rows = [
    {
      ...sample, id: 'small', section: 'extras', audioCategory: 'adapters',
      concept: 'Aros adaptadores 3D', quantity: '2', unitPrice: '100',
      adapterVariant: { productKey: 'small', size: '6,5', presentation: 'pair' },
    },
    {
      ...sample, id: 'large', section: 'extras', audioCategory: 'adapters',
      concept: 'Aros adaptadores 3D', quantity: '2', unitPrice: '5', currency: 'USD',
      adapterVariant: { productKey: 'large', size: '8', presentation: 'unit' },
    },
  ]
  const snapshot = structuredClone(quotation)
  const result = renderWithRecordedCanvas(quotation)
  assert.equal(result.texts.filter(({ text }) => text === 'Aros adaptadores 3D').length, 1)
  const text = result.texts.map(({ text: entry }) => entry).join(' ')
  assert.ok(text.includes('2 pares × 6,5″ · ARS 200,00'))
  assert.ok(text.includes('2 unidades × 8″ · USD 10,00'))
  const amounts = result.texts.filter(({ align }) => align === 'right').map(({ text: entry }) => entry)
  assert.ok(amounts.includes('ARS 200,00'))
  assert.ok(amounts.includes('USD 10,00'))
  assert.ok(!text.includes('Agregar') && !text.includes('Editar'))
  assert.deepEqual(quotation, snapshot)
})

test('exports every long adapter description below the heading and above totals without clipping', () => {
  const quotation = exportableQuotation()
  const sample = quotation.rows[0]
  quotation.rows = [
    {
      ...sample, id: 'long-ring', section: 'extras', audioCategory: 'adapters',
      concept: 'Aro sintético reforzado para prueba',
      detail: `${'Detalle extenso de prueba '.repeat(60)}Final de la variante`,
      adapterVariant: { productKey: 'long-ring', size: '6,5', presentation: 'set' },
    },
    {
      ...sample, id: 'other-ring', section: 'extras', audioCategory: 'adapters',
      concept: 'Aros adaptadores 3D', currency: 'USD',
      adapterVariant: { productKey: 'other-ring', size: '8', presentation: 'pair' },
    },
  ]
  const result = renderWithRecordedCanvas(quotation)
  const text = result.texts.map(({ text: entry }) => entry).join(' ')
  assert.ok(text.includes('Aro sintético reforzado para prueba'))
  assert.ok(text.includes('Final de la variante'))
  assert.ok(text.includes('1 juego × 6,5″'))
  assert.ok(text.includes('1 par × 8″'))
  const heading = result.texts.find(({ text: entry }) => entry === 'Aros adaptadores 3D')
  const totalLabel = result.texts.find(({ text: entry }) => entry === 'TOTAL')
  assert.ok(heading && totalLabel)
  const detailLines = result.texts.filter(({ y, align }) => y > heading.y && y < totalLabel.y && align === 'left')
  assert.ok(detailLines.length > 10)
  assert.ok(detailLines.every(({ x, y, width }) => x + width <= 1016 && y + 32 < totalLabel.y))
  const groupAmounts = result.texts.filter(({ y, align }) => y >= heading.y && y <= heading.y + 46 && align === 'right')
  assert.equal(groupAmounts.length, 2)
  assert.ok(detailLines.every(({ y }) => y > Math.max(...groupAmounts.map((amount) => amount.y)) + 38))
})

test('keeps legacy adapters, repeated equipment, included and explicit zero variants distinct in PNG', () => {
  const quotation = exportableQuotation()
  const sample = quotation.rows[0]
  quotation.rows = [
    { ...sample, id: 'bass-a', audioCategory: 'subwoofer', concept: 'Subwoofer sintético A' },
    { ...sample, id: 'bass-b', audioCategory: 'subwoofer', concept: 'Subwoofer sintético B' },
    {
      ...sample, id: 'legacy', section: 'extras', audioCategory: 'adapters',
      concept: 'Aros anteriores de 6,5 pulgadas', detail: 'Texto conservado',
    },
    {
      ...sample, id: 'included', section: 'extras', audioCategory: 'adapters',
      concept: 'Aros adaptadores 3D', priceState: 'included', unitPrice: '',
      adapterVariant: { productKey: 'included', size: '6,5', presentation: 'unit' },
    },
    {
      ...sample, id: 'zero', section: 'extras', audioCategory: 'adapters',
      concept: 'Aros adaptadores 3D', unitPrice: '0',
      adapterVariant: { productKey: 'zero', size: '8', presentation: 'unit' },
    },
  ]
  const result = renderWithRecordedCanvas(quotation)
  const text = result.texts.map(({ text: entry }) => entry).join(' ')
  assert.ok(text.includes('Subwoofer sintético A') && text.includes('Subwoofer sintético B'))
  assert.ok(text.includes('Aros anteriores de 6,5 pulgadas Texto conservado'))
  assert.ok(text.includes('1 unidad × 6,5″ · Incluido'))
  assert.ok(text.includes('1 unidad × 8″ · ARS 0,00'))
  assert.ok(result.texts.some(({ text: entry, align }) => entry === 'ARS 0,00' && align === 'right'))
})

test('blocks PNG generation when one explicitly grouped adapter remains pending', async () => {
  const quotation = exportableQuotation()
  quotation.rows = [
    {
      ...quotation.rows[0], id: 'pending-ring', section: 'extras', audioCategory: 'adapters',
      priceState: 'pending', unitPrice: '',
      adapterVariant: { productKey: 'pending-ring', size: '6,5', presentation: 'unit' },
    },
  ]
  await assert.rejects(createQuotationFile(quotation), /campos pendientes/)
})

test('keeps grouped adapter provenance private while preserving availability guards and the customer warning', async () => {
  const quotation = provisionalQuotation()
  quotation.rows[0] = {
    ...quotation.rows[0], section: 'extras', audioCategory: 'adapters',
    concept: 'Aros adaptadores 3D',
    adapterVariant: { productKey: 'private-item', size: '6,5', presentation: 'pair' },
  }
  const result = renderWithRecordedCanvas(quotation)
  const text = result.texts.map(({ text: entry }) => entry).join(' ')
  assert.ok(text.includes('1 par × 6,5″ · ARS 2.400,00'))
  assert.equal(result.texts.filter(({ text: entry }) => entry === 'Disponibilidad a confirmar.').length, 1)
  assert.doesNotMatch(text, /PRIVATE-|ffff|private-item|Stock|Histórico/)
  quotation.rows[0].provenance!.stock!.quantity = 0
  await assert.rejects(createQuotationFile(quotation), /stock/)
  assert.throws(() => renderQuotationCanvas(quotation, {} as CanvasImageSource), /stock/)
})
