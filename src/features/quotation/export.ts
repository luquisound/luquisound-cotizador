import { calculateQuotation, formatMoney, formatMoneyAmount, parseMoney, parseQuantity } from './calculation.ts'
import { getCurrencyLabel } from './currency-display.ts'
import type { CatalogItem, Quotation, QuotationRow, RowSection } from './model.ts'
import { BODY_FONT, HEADING_FONT, loadQuotationFonts } from './typography.ts'
import { exchangeRateDescription } from './exchange-quote.ts'
import { QUOTATION_GRAPHIC } from './graphic.ts'
import { inspectQuotationAvailability } from './quotation-availability.ts'
import { buildQuotationPresentation, formatQuantityThousandths } from './presentation.ts'
import type { QuotationPresentationItem } from './presentation.ts'

const WIDTH = 1080
const MARGIN = 64
const CONTENT_WIDTH = WIDTH - MARGIN * 2
const { yellow: YELLOW, black: BLACK } = QUOTATION_GRAPHIC
const FOOTER_HEIGHT = 84
const MAX_CANVAS_PIXELS = 16_000_000
export const LOGO_LOAD_TIMEOUT_MS = 15_000

export interface QuotationExportOptions {
  availabilityWarning?: boolean
  availabilityCatalog?: readonly CatalogItem[]
}

type MeasureText = (text: string) => number
type CalculatedRow = ReturnType<typeof calculateQuotation>['rows'][number]

interface RowLayout {
  conceptLines: string[]
  detailLines: string[]
  quantityLines: string[]
  amountLines: string[]
  headingHeight: number
  amountAtTop: boolean
  height: number
}

interface SectionLayout {
  section: RowSection
  rows: RowLayout[]
}

export interface FileShareNavigator {
  canShare?: (data: { files: File[] }) => boolean
  share?: (data: { files: File[] }) => Promise<void>
}

export type ShareResult = 'shared' | 'cancelled' | 'unsupported'

/** Wrap complete text without dropping words or splitting Unicode code points. */
export function wrapText(measure: MeasureText, text: string, maxWidth: number): string[] {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
    throw new RangeError('Text width must be a positive finite number.')
  }

  const lines: string[] = []
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean)
    let line = ''
    for (const word of words) {
      const joined = line ? `${line} ${word}` : word
      if (measure(joined) <= maxWidth) {
        line = joined
        continue
      }
      if (line) lines.push(line)
      line = ''
      for (const character of Array.from(word)) {
        if (measure(character) > maxWidth) {
          throw new RangeError('A character does not fit within the text width.')
        }
        if (line && measure(line + character) > maxWidth) {
          lines.push(line)
          line = ''
        }
        line += character
      }
    }
    lines.push(line)
  }
  return lines
}

export function quotationFileName(quotation: Pick<Quotation, 'title'>): string {
  const title = quotation.title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80).replace(/-+$/g, '')
  return `luquisound-${title || 'presupuesto'}.png`
}

function setFont(context: CanvasRenderingContext2D, size: number, family = HEADING_FONT): void {
  context.font = `${family === HEADING_FONT ? 700 : 400} ${size}px "${family}"`
  context.textBaseline = 'top'
}

function measureLines(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  return wrapText((line) => context.measureText(line).width, text, width)
}

function drawLines(
  context: CanvasRenderingContext2D, lines: string[], x: number, y: number, lineHeight: number,
): void {
  for (const [index, line] of lines.entries()) context.fillText(line, x, y + index * lineHeight)
}

function quantityLabel(row: QuotationRow): string {
  const quantity = parseQuantity(row.quantity)
  if (!quantity.ok || quantity.thousandths === 1000) return ''
  const label = formatQuantityThousandths(quantity.thousandths)
  if (row.priceState === 'included') return `${label} unidades · Sin cargo`
  const price = parseMoney(row.unitPrice)
  return price.ok ? `${label} × ${formatMoney(price.cents, row.currency)} c/u` : ''
}

function amountLabel(result: CalculatedRow): string {
  if (result.lineTotalCents === null) {
    throw new Error('Completá los campos pendientes antes de preparar la imagen.')
  }
  return result.row.priceState === 'included'
    ? 'Incluido'
    : formatMoney(result.lineTotalCents, result.row.currency)
}

function layoutRow(
  context: CanvasRenderingContext2D, item: QuotationPresentationItem,
  conceptWidth: number, amountWidth: number,
): RowLayout {
  const result = item.kind === 'row' ? item.item : undefined
  const concept = item.kind === 'adapters' ? item.title : item.item.row.concept.trim()
  const details = item.kind === 'adapters' ? item.details
    : item.item.row.detail.trim() ? [item.item.row.detail.trim()] : []
  const amounts = item.kind === 'adapters' ? item.amounts : [amountLabel(item.item)]
  setFont(context, 36, BODY_FONT)
  const conceptLines = measureLines(context, concept, conceptWidth)
  setFont(context, 26, BODY_FONT)
  const detailLines = details.flatMap((detail) => measureLines(
    context, detail, item.kind === 'adapters' ? CONTENT_WIDTH : conceptWidth,
  ))
  setFont(context, 24, BODY_FONT)
  const quantity = result ? quantityLabel(result.row) : ''
  const quantityLines = quantity ? measureLines(context, quantity, conceptWidth) : []
  setFont(context, 38, BODY_FONT)
  const amountLines = amounts.flatMap((amount) => measureLines(context, amount, amountWidth))
  const amountAtTop = item.kind === 'adapters'
  const headingHeight = amountAtTop
    ? Math.max(conceptLines.length * 44, amountLines.length * 46) : conceptLines.length * 44
  const textHeight = headingHeight
    + (detailLines.length ? 8 + detailLines.length * 32 : 0)
    + (quantityLines.length ? 8 + quantityLines.length * 30 : 0)
  return {
    conceptLines, detailLines, quantityLines, amountLines, headingHeight, amountAtTop,
    height: Math.max(88, 22 + Math.max(textHeight, amountLines.length * 46) + 22),
  }
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const radius = size / 4
  context.beginPath()
  context.moveTo(x + radius, y)
  context.lineTo(x + size - radius, y)
  context.quadraticCurveTo(x + size, y, x + size, y + radius)
  context.lineTo(x + size, y + size - radius)
  context.quadraticCurveTo(x + size, y + size, x + size - radius, y + size)
  context.lineTo(x + radius, y + size)
  context.quadraticCurveTo(x, y + size, x, y + size - radius)
  context.lineTo(x, y + radius)
  context.quadraticCurveTo(x, y, x + radius, y)
  context.stroke()
}

function drawContactIcon(context: CanvasRenderingContext2D, x: number, y: number, instagram: boolean): void {
  context.strokeStyle = YELLOW
  context.lineWidth = 2.5
  if (instagram) {
    roundedRect(context, x, y, 30)
    context.beginPath()
    context.arc(x + 15, y + 15, 7, 0, Math.PI * 2)
    context.stroke()
    context.fillStyle = YELLOW
    context.beginPath()
    context.arc(x + 23, y + 7, 2, 0, Math.PI * 2)
    context.fill()
  } else {
    context.beginPath()
    context.arc(x + 15, y + 14, 14, Math.PI * 0.72, Math.PI * 2.6)
    context.lineTo(x + 1, y + 31)
    context.lineTo(x + 10, y + 27)
    context.stroke()
    context.beginPath()
    context.moveTo(x + 9, y + 7)
    context.bezierCurveTo(x + 2, y + 13, x + 18, y + 30, x + 24, y + 21)
    context.lineTo(x + 19, y + 17)
    context.lineTo(x + 16, y + 20)
    context.lineTo(x + 10, y + 13)
    context.lineTo(x + 13, y + 10)
    context.closePath()
    context.stroke()
  }
}

export function renderQuotationCanvas(
  quotation: Quotation, logo: CanvasImageSource, options: QuotationExportOptions = {},
): HTMLCanvasElement {
  const calculation = calculateQuotation(quotation)
  const discount = calculation.discount
  if (!calculation.canExport || !calculation.conversion.ok) {
    throw new Error('Completá los campos pendientes antes de preparar la imagen.')
  }
  const availability = inspectQuotationAvailability(quotation, options.availabilityCatalog)
  if (availability.issues.length) throw new Error(availability.issues[0])
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('El navegador no pudo crear la imagen.')

  setFont(context, 84)
  const titleLines = measureLines(context, quotation.title.trim(), CONTENT_WIDTH)
  setFont(context, 30, BODY_FONT)
  const subtitleLines = quotation.subtitle.trim()
    ? measureLines(context, quotation.subtitle.trim(), CONTENT_WIDTH) : []
  const subtitleY = 174 + titleLines.length * 92 + 12
  const headerHeight = Math.max(348, subtitleY + subtitleLines.length * 38 + 28)
  const presentation = buildQuotationPresentation(calculation.rows, quotation.blockOrder)
  setFont(context, 38, BODY_FONT)
  const amountLabels = presentation.flatMap((item) => (
    item.kind === 'adapters' ? item.amounts : [amountLabel(item.item)]
  ))
  const amountWidth = Math.min(450, Math.max(260, ...amountLabels.map(
    (amount) => Math.ceil(context.measureText(amount).width),
  )))
  const conceptWidth = CONTENT_WIDTH - amountWidth - 36
  const sections: SectionLayout[] = (['equipment', 'extras'] as const).map((section) => ({
    section,
    rows: presentation.filter((item) => (
      (item.kind === 'adapters' ? item.items[0].row : item.item.row).section === section
    )).map((item) => layoutRow(context, item, conceptWidth, amountWidth)),
  })).filter((section) => section.rows.length > 0)
  setFont(context, 30, BODY_FONT)
  const noteLines = quotation.notes.trim()
    ? measureLines(context, quotation.notes.trim(), CONTENT_WIDTH) : []
  const discountLines = discount
    ? measureLines(context, `Descuento en equipos · ${discount.percentage} %`, CONTENT_WIDTH) : []
  const discountAmounts = discount
    ? (['ARS', 'USD'] as const).filter((currency) => discount.eligibleTotals[currency] > 0)
      .flatMap((currency) => measureLines(context, `− ${formatMoney(discount.amounts[currency], currency)}`, CONTENT_WIDTH))
    : []
  const discountHeight = discountLines.length ? (discountLines.length + discountAmounts.length) * 38 + 28 : 0
  const notesHeight = noteLines.length ? 68 + noteLines.length * 38 : 0
  const contentHeight = 44 + sections.reduce(
    (height, section) => height + 60 + section.rows.reduce((sum, row) => sum + row.height, 0) + 36,
    0,
  ) + notesHeight + 12
  setFont(context, 80)
  const totalRows = (['ARS', 'USD'] as const).map((currency) => {
    const cents = calculation.totals[currency]
    if (cents === null) throw new Error('Completá los campos pendientes antes de preparar la imagen.')
    const amount = formatMoneyAmount(cents)
    const lines = measureLines(context, amount, CONTENT_WIDTH - 152)
    return { currency, lines, height: Math.max(100, lines.length * 90 + 20) }
  })
  setFont(context, 24, BODY_FONT)
  const rateLines = measureLines(context, calculation.conversion.rateLabel, CONTENT_WIDTH)
  const rateSourceLines = measureLines(context, exchangeRateDescription(quotation), CONTENT_WIDTH)
  const availabilityLines = availability.hasProvisional || options.availabilityWarning
    ? measureLines(context, 'Disponibilidad a confirmar.', CONTENT_WIDTH) : []
  const rateHeight = rateLines.length * 30 + 8 + rateSourceLines.length * 30
  const availabilityHeight = availabilityLines.length ? 14 + availabilityLines.length * 30 : 0
  const totalHeight = discountHeight + 76 + totalRows.reduce((sum, row) => sum + row.height, 0) + 18 + rateHeight + availabilityHeight + 28
  const bodyHeight = Math.max(contentHeight, 1320 - headerHeight - 5 - totalHeight - FOOTER_HEIGHT)
  const height = Math.ceil(headerHeight + 5 + bodyHeight + totalHeight + FOOTER_HEIGHT)
  if (WIDTH * height > MAX_CANVAS_PIXELS) {
    throw new Error('El presupuesto es demasiado extenso para una sola imagen. Dividilo en dos presupuestos.')
  }

  canvas.width = WIDTH
  canvas.height = height
  context.fillStyle = '#FFFFFF'
  context.fillRect(0, 0, WIDTH, height)
  context.fillStyle = YELLOW
  context.fillRect(0, 0, WIDTH, headerHeight)
  context.drawImage(logo, MARGIN, 40, 670, 670 * 393.05 / 3469.76)
  context.textAlign = 'right'
  context.fillStyle = BLACK
  setFont(context, 20, BODY_FONT)
  drawLines(context, ['PRESUPUESTO', 'DE AUDIO'], WIDTH - MARGIN, 45, 25)
  context.textAlign = 'left'
  setFont(context, 84)
  context.fillStyle = BLACK
  drawLines(context, titleLines, MARGIN, 174, 92)
  context.fillStyle = BLACK
  setFont(context, 30, BODY_FONT)
  drawLines(context, subtitleLines, MARGIN, subtitleY, 38)
  context.fillStyle = BLACK
  context.fillRect(0, headerHeight, WIDTH, 5)

  let y = headerHeight + 5 + 44
  for (const section of sections) {
    context.fillStyle = '#696969'
    setFont(context, 24, BODY_FONT)
    context.fillText(section.section === 'equipment' ? 'EQUIPAMIENTO' : 'INSTALACIÓN Y ACCESORIOS', MARGIN, y)
    y += 60
    for (const row of section.rows) {
      const rowY = y + 22
      context.fillStyle = BLACK
      setFont(context, 36, BODY_FONT)
      drawLines(context, row.conceptLines, MARGIN, rowY, 44)
      let detailY = rowY + row.headingHeight
      if (row.detailLines.length) {
        detailY += 8
        context.fillStyle = '#565656'
        setFont(context, 26, BODY_FONT)
        drawLines(context, row.detailLines, MARGIN, detailY, 32)
        detailY += row.detailLines.length * 32
      }
      if (row.quantityLines.length) {
        context.fillStyle = '#565656'
        setFont(context, 24, BODY_FONT)
        drawLines(context, row.quantityLines, MARGIN, detailY + 8, 30)
      }
      context.fillStyle = BLACK
      context.textAlign = 'right'
      setFont(context, 38, BODY_FONT)
      const amountY = row.amountAtTop ? rowY : y + (row.height - row.amountLines.length * 46) / 2
      drawLines(context, row.amountLines, WIDTH - MARGIN, amountY, 46)
      context.textAlign = 'left'
      y += row.height
      context.fillStyle = '#D8D8D8'
      context.fillRect(MARGIN, y - 1, CONTENT_WIDTH, 1)
    }
    y += 36
  }
  if (noteLines.length) {
    context.fillStyle = '#696969'
    setFont(context, 24, BODY_FONT)
    context.fillText('OBSERVACIONES', MARGIN, y)
    context.fillStyle = '#454545'
    setFont(context, 30, BODY_FONT)
    drawLines(context, noteLines, MARGIN, y + 48, 38)
  }

  const totalY = headerHeight + 5 + bodyHeight
  context.fillStyle = YELLOW
  context.fillRect(MARGIN, totalY, CONTENT_WIDTH, 2)
  context.fillStyle = BLACK
  setFont(context, 30, BODY_FONT)
  if (discountLines.length) {
    drawLines(context, discountLines, MARGIN, totalY + 28, 38)
    context.textAlign = 'right'
    drawLines(context, discountAmounts, WIDTH - MARGIN, totalY + 28 + discountLines.length * 38, 38)
    context.textAlign = 'left'
  }
  context.fillText('TOTAL', MARGIN, totalY + discountHeight + 28)
  let totalRowY = totalY + discountHeight + 76
  for (const row of totalRows) {
    context.fillStyle = '#626262'
    setFont(context, 30, BODY_FONT)
    context.fillText(getCurrencyLabel(row.currency), MARGIN, totalRowY + (row.height - 36) / 2)
    context.fillStyle = BLACK
    context.textAlign = 'right'
    setFont(context, 80)
    drawLines(context, row.lines, WIDTH - MARGIN, totalRowY + (row.height - row.lines.length * 90) / 2, 90)
    context.textAlign = 'left'
    totalRowY += row.height
  }
  context.fillStyle = '#626262'
  setFont(context, 24, BODY_FONT)
  drawLines(context, rateLines, MARGIN, totalRowY + 18, 30)
  drawLines(context, rateSourceLines, MARGIN, totalRowY + 18 + rateLines.length * 30 + 8, 30)
  drawLines(context, availabilityLines, MARGIN, totalRowY + 18 + rateHeight + 14, 30)

  const footerY = height - FOOTER_HEIGHT
  context.fillStyle = BLACK
  context.fillRect(0, footerY, WIDTH, FOOTER_HEIGHT)
  setFont(context, 30, BODY_FONT)
  const contacts = [
    { text: '11 7358-1958', instagram: false },
    { text: '@luquisound.ok', instagram: true },
  ]
  for (const contact of contacts) {
    const x = contact.instagram
      ? WIDTH - MARGIN - context.measureText(contact.text).width - 48
      : MARGIN
    context.save()
    context.translate(x, footerY + 24)
    context.scale(1.2, 1.2)
    drawContactIcon(context, 0, 0, contact.instagram)
    context.restore()
    context.fillStyle = YELLOW
    context.fillText(contact.text, x + 48, footerY + 26)
  }
  return canvas
}

async function loadQuotationLogo(): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      image.onload = null
      image.onerror = null
      if (error) reject(error)
      else resolve(image)
    }
    const timer = setTimeout(() => finish(new Error('El logo tardó demasiado en cargar. Intentá preparar la imagen nuevamente.')), LOGO_LOAD_TIMEOUT_MS)
    image.onload = () => finish()
    image.onerror = () => finish(new Error('No se pudo cargar el logo. Intentá preparar la imagen nuevamente.'))
    try { image.src = QUOTATION_GRAPHIC.logoUrl } catch {
      finish(new Error('No se pudo cargar el logo. Intentá preparar la imagen nuevamente.'))
    }
  })
}

export async function createQuotationFile(quotation: Quotation, options: QuotationExportOptions = {}): Promise<File> {
  if (!calculateQuotation(quotation).canExport) {
    throw new Error('Completá los campos pendientes antes de preparar la imagen.')
  }
  const availability = inspectQuotationAvailability(quotation, options.availabilityCatalog)
  if (availability.issues.length) throw new Error(availability.issues[0])
  const logo = await loadQuotationLogo()
  await loadQuotationFonts()
  const canvas = renderQuotationCanvas(quotation, logo, options)
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result)
        else reject(new Error('El navegador no pudo generar el PNG. Intentá con un presupuesto más corto.'))
      }, 'image/png')
    })
    return new File([blob], quotationFileName(quotation), { type: 'image/png' })
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

export function downloadQuotationFile(file: File): void {
  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  anchor.style.display = 'none'
  document.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}

/** Pass an already prepared file directly from the user's click handler. */
export async function shareQuotationFile(file: File, navigatorLike: FileShareNavigator): Promise<ShareResult> {
  const data = { files: [file] }
  if (!navigatorLike.share || !navigatorLike.canShare?.(data)) return 'unsupported'
  try {
    await navigatorLike.share(data)
    return 'shared'
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') {
      return 'cancelled'
    }
    throw error
  }
}
