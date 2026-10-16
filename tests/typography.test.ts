import assert from 'node:assert/strict'
import test from 'node:test'
import { BODY_FONT, HEADING_FONT, loadQuotationFonts } from '../src/features/quotation/typography.ts'

async function withFontLoader(
  load: (font: string, sample: string) => Promise<{ status: string }[]>,
  check: () => Promise<void>,
): Promise<void> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { fonts: { load } } })
  try { await check() }
  finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else Reflect.deleteProperty(globalThis, 'document')
  }
}

test('loads both declared families before allowing image preparation', async () => {
  const requests: string[] = []
  await withFontLoader(async (font, sample) => {
    requests.push(font)
    assert.ok(sample.includes('0123456789'))
    return [{ status: 'loaded' }]
  }, async () => { await loadQuotationFonts() })
  assert.deepEqual(requests, [`700 84px "${HEADING_FONT}"`, `400 36px "${BODY_FONT}"`])
})

test('rejects an absent face instead of accepting a silent system fallback', async () => {
  await withFontLoader(async () => [], async () => {
    await assert.rejects(loadQuotationFonts(), /tipograf/)
  })
})

test('rejects a face that did not finish loading', async () => {
  await withFontLoader(async () => [{ status: 'error' }], async () => {
    await assert.rejects(loadQuotationFonts(), /tipograf/)
  })
})

test('reports an unreadable local font file as a preparation failure', async () => {
  await withFontLoader(() => Promise.reject(new Error('Synthetic font failure')), async () => {
    await assert.rejects(loadQuotationFonts(), /tipograf/)
  })
})
