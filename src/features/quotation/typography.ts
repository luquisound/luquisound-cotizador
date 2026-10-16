export const HEADING_FONT = 'Luquisound Pliant Static Expanded'
export const BODY_FONT = 'Luquisound Barlow'

const REQUIRED_FONTS = [
  `700 84px "${HEADING_FONT}"`,
  `400 36px "${BODY_FONT}"`,
] as const
const FONT_SAMPLE = 'Presupuesto Instalaci\u00f3n \u00e1\u00e9\u00ed\u00f3\u00fa\u00f1 $ 0123456789'
const FONT_LOAD_TIMEOUT_MS = 15_000

/** Explicitly load both declared faces before measuring or rendering the PNG. */
export async function loadQuotationFonts(): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.all(REQUIRED_FONTS.map(async (font) => {
        const faces = await document.fonts.load(font, FONT_SAMPLE)
        if (faces.length === 0 || faces.some((face) => face.status !== 'loaded')) {
          throw new Error('A required quotation font is unavailable.')
        }
      })),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Quotation fonts timed out.')), FONT_LOAD_TIMEOUT_MS)
      }),
    ])
  } catch {
    throw new Error('No se pudieron cargar las tipograf\u00edas. Volv\u00e9 a intentar preparar la imagen.')
  } finally {
    clearTimeout(timeout)
  }
}
