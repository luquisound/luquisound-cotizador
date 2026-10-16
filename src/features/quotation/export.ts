import { calculateQuotation, formatMoney, parseMoney, parseQuantity } from './calculation.ts'
import type { Quotation, QuotationRow, RowSection } from './model.ts'

const WIDTH = 1080
const MARGIN = 64
const CONTENT_WIDTH = WIDTH - MARGIN * 2
const YELLOW = '#FFDA00'
const BLACK = '#141414'
const FONT = 'Impact, "Arial Narrow", Arial, sans-serif'
const BODY_FONT = 'Arial, sans-serif'
const FOOTER_HEIGHT = 84
const MAX_CANVAS_PIXELS = 16_000_000

type MeasureText = (text: string) => number
type CalculatedRow = ReturnType<typeof calculateQuotation>['rows'][number]

interface RowLayout {
  row: QuotationRow
  conceptLines: string[]
  detailLines: string[]
  quantityLines: string[]
  amountLines: string[]
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

function setFont(context: CanvasRenderingContext2D, size: number, bold = false, family = FONT): void {
  context.font = `${bold ? '700 ' : ''}${size}px ${family}`
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

function quantityLabel(row: QuotationRow, currency: Quotation['currency']): string {
  const quantity = parseQuantity(row.quantity)
  if (!quantity.ok || quantity.thousandths === 1000) return ''
  const amount = BigInt(quantity.thousandths)
  const whole = new Intl.NumberFormat('es-AR').format(amount / 1000n)
  const fraction = String(amount % 1000n).padStart(3, '0').replace(/0+$/g, '')
  const label = `${whole}${fraction ? `,${fraction}` : ''}`
  if (row.priceState === 'included') return `${label} unidades · Sin cargo`
  const price = parseMoney(row.unitPrice)
  return price.ok ? `${label} × ${formatMoney(price.cents, currency)} c/u` : ''
}

function amountLabel(result: CalculatedRow, currency: Quotation['currency']): string {
  if (result.lineTotalCents === null) {
    throw new Error('Completá los campos pendientes antes de preparar la imagen.')
  }
  return result.row.priceState === 'included'
    ? 'Incluido'
    : formatMoney(result.lineTotalCents, currency)
}

function layoutRow(
  context: CanvasRenderingContext2D, result: CalculatedRow, currency: Quotation['currency'],
  conceptWidth: number, amountWidth: number,
): RowLayout {
  setFont(context, 36, true, BODY_FONT)
  const conceptLines = measureLines(context, result.row.concept.trim(), conceptWidth)
  setFont(context, 26, false, BODY_FONT)
  const detailLines = result.row.detail.trim()
    ? measureLines(context, result.row.detail.trim(), conceptWidth) : []
  setFont(context, 24, false, BODY_FONT)
  const quantity = quantityLabel(result.row, currency)
  const quantityLines = quantity ? measureLines(context, quantity, conceptWidth) : []
  setFont(context, 38, true, BODY_FONT)
  const amountLines = measureLines(context, amountLabel(result, currency), amountWidth)
  const textHeight = conceptLines.length * 44
    + (detailLines.length ? 8 + detailLines.length * 32 : 0)
    + (quantityLines.length ? 8 + quantityLines.length * 30 : 0)
  return {
    row: result.row, conceptLines, detailLines, quantityLines, amountLines,
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

export function renderQuotationCanvas(quotation: Quotation, logo: CanvasImageSource): HTMLCanvasElement {
  const calculation = calculateQuotation(quotation)
  if (!calculation.canExport) {
    throw new Error('Completá los campos pendientes antes de preparar la imagen.')
  }
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('El navegador no pudo crear la imagen.')

  setFont(context, 84)
  const titleLines = measureLines(context, quotation.title.trim().toLocaleUpperCase('es-AR'), CONTENT_WIDTH - 60)
  setFont(context, 30, false, BODY_FONT)
  const subtitleLines = quotation.subtitle.trim()
    ? measureLines(context, quotation.subtitle.trim(), CONTENT_WIDTH) : []
  const subtitleY = 174 + titleLines.length * 92 + 12
  const headerHeight = Math.max(348, subtitleY + subtitleLines.length * 38 + 28)
  setFont(context, 38, true, BODY_FONT)
  const amountWidth = Math.min(450, Math.max(260, ...calculation.rows.map(
    (row) => Math.ceil(context.measureText(amountLabel(row, quotation.currency)).width),
  )))
  const conceptWidth = CONTENT_WIDTH - amountWidth - 36
  const sections: SectionLayout[] = (['equipment', 'extras'] as const).map((section) => ({
    section,
    rows: calculation.rows.filter((result) => result.row.section === section)
      .map((result) => layoutRow(context, result, quotation.currency, conceptWidth, amountWidth)),
  })).filter((section) => section.rows.length > 0)
  setFont(context, 30, false, BODY_FONT)
  const noteLines = quotation.notes.trim()
    ? measureLines(context, quotation.notes.trim(), CONTENT_WIDTH) : []
  const notesHeight = noteLines.length ? 68 + noteLines.length * 38 : 0
  const contentHeight = 44 + sections.reduce(
    (height, section) => height + 60 + section.rows.reduce((sum, row) => sum + row.height, 0) + 36,
    0,
  ) + notesHeight + 12
  setFont(context, 112)
  const totalAmount = formatMoney(calculation.totalCents, quotation.currency).slice(quotation.currency.length + 1)
  const totalLines = measureLines(context, totalAmount, CONTENT_WIDTH - 152)
  const totalHeight = Math.max(184, totalLines.length * 118 + 48)
  const bodyHeight = Math.max(contentHeight, 1320 - headerHeight - 5 - totalHeight - FOOTER_HEIGHT)
  const height = Math.ceil(headerHeight + 5 + bodyHeight + totalHeight + FOOTER_HEIGHT)
  if (WIDTH * height > MAX_CANVAS_PIXELS) {
    throw new Error('El presupuesto es demasiado extenso para una sola imagen. Dividilo en dos presupuestos.')
  }

  canvas.width = WIDTH
  canvas.height = height
  context.fillStyle = '#FFFFFF'
  context.fillRect(0, 0, WIDTH, height)
  context.fillStyle = BLACK
  context.fillRect(0, 0, WIDTH, headerHeight)
  context.drawImage(logo, MARGIN, 40, 670, 670 * 393.05 / 3469.76)
  context.textAlign = 'right'
  context.fillStyle = '#A3A3A3'
  setFont(context, 20, true, BODY_FONT)
  drawLines(context, ['PRESUPUESTO', 'DE AUDIO'], WIDTH - MARGIN, 45, 25)
  context.textAlign = 'left'
  setFont(context, 84, true, BODY_FONT)
  context.fillStyle = YELLOW
  context.fillText('+', MARGIN, 174)
  setFont(context, 84)
  context.fillStyle = '#FFFFFF'
  drawLines(context, titleLines, MARGIN + 60, 174, 92)
  context.fillStyle = '#B3B3B3'
  setFont(context, 30, false, BODY_FONT)
  drawLines(context, subtitleLines, MARGIN, subtitleY, 38)
  context.fillStyle = YELLOW
  context.fillRect(0, headerHeight, WIDTH, 5)

  let y = headerHeight + 5 + 44
  for (const section of sections) {
    context.fillStyle = '#696969'
    setFont(context, 24, true, BODY_FONT)
    context.fillText(section.section === 'equipment' ? 'EQUIPAMIENTO' : 'INSTALACIÓN Y ACCESORIOS', MARGIN, y)
    y += 60
    for (const row of section.rows) {
      const rowY = y + 22
      context.fillStyle = BLACK
      setFont(context, 36, true, BODY_FONT)
      drawLines(context, row.conceptLines, MARGIN, rowY, 44)
      let detailY = rowY + row.conceptLines.length * 44
      if (row.detailLines.length) {
        detailY += 8
        context.fillStyle = '#565656'
        setFont(context, 26, false, BODY_FONT)
        drawLines(context, row.detailLines, MARGIN, detailY, 32)
        detailY += row.detailLines.length * 32
      }
      if (row.quantityLines.length) {
        context.fillStyle = '#565656'
        setFont(context, 24, false, BODY_FONT)
        drawLines(context, row.quantityLines, MARGIN, detailY + 8, 30)
      }
      context.fillStyle = BLACK
      context.textAlign = 'right'
      setFont(context, 38, true, BODY_FONT)
      drawLines(context, row.amountLines, WIDTH - MARGIN, y + (row.height - row.amountLines.length * 46) / 2, 46)
      context.textAlign = 'left'
      y += row.height
      context.fillStyle = '#D8D8D8'
      context.fillRect(MARGIN, y - 1, CONTENT_WIDTH, 1)
    }
    y += 36
  }
  if (noteLines.length) {
    context.fillStyle = '#696969'
    setFont(context, 24, true, BODY_FONT)
    context.fillText('OBSERVACIONES', MARGIN, y)
    context.fillStyle = '#454545'
    setFont(context, 30, false, BODY_FONT)
    drawLines(context, noteLines, MARGIN, y + 48, 38)
  }

  const totalY = headerHeight + 5 + bodyHeight
  context.fillStyle = YELLOW
  context.fillRect(MARGIN, totalY, CONTENT_WIDTH, 2)
  context.fillStyle = BLACK
  const totalLabelY = totalY + (totalHeight - 64) / 2
  setFont(context, 30, true, BODY_FONT)
  context.fillText('TOTAL', MARGIN, totalLabelY)
  context.fillStyle = '#626262'
  setFont(context, 20, true, BODY_FONT)
  context.fillText(quotation.currency, MARGIN, totalLabelY + 38)
  context.fillStyle = BLACK
  context.textAlign = 'right'
  setFont(context, 112)
  drawLines(context, totalLines, WIDTH - MARGIN, totalY + (totalHeight - totalLines.length * 118) / 2, 118)
  context.textAlign = 'left'

  const footerY = height - FOOTER_HEIGHT
  context.fillStyle = BLACK
  context.fillRect(0, footerY, WIDTH, FOOTER_HEIGHT)
  setFont(context, 30, false, BODY_FONT)
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

export async function createQuotationFile(quotation: Quotation): Promise<File> {
  if (!calculateQuotation(quotation).canExport) {
    throw new Error('Completá los campos pendientes antes de preparar la imagen.')
  }
  const logo = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('No se pudo cargar el logo. Intentá preparar la imagen nuevamente.'))
    image.src = '/brand/luquisound-horizontal.svg'
  })
  await document.fonts.ready
  const canvas = renderQuotationCanvas(quotation, logo)
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
