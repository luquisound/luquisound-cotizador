import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { calculateQuotation, isEmptyRow } from './calculation'
import { createQuotation, hasQuotationContent, type CatalogItem, type Quotation, type QuotationRow, type RowSection } from './model'
import { isDirectExtraRow, isSingleRowCategory, type AudioCategory } from './audio-categories'
import { createQuotationRowDraft, saveQuotationRow } from './row-actions'
import { serializeWorkspace } from './persistence'
import {
  CATALOG_STORAGE_KEY, CURRENT_QUOTATION_STORAGE_KEY, loadCatalog, loadCurrentQuotation,
  saveCatalog, saveCurrentQuotation, serializeCatalogBackup,
} from './working-storage'
import { createQuotationFile, downloadQuotationFile, shareQuotationFile } from './export'
import { QuotationPreview } from './QuotationPreview'
import { HeaderEditor, RowEditor } from './QuotationDialogs'
import { RowPriceEditor } from './RowPriceEditor'
import { DiscountEditor } from './DiscountEditor'
import { prepareFixedServiceQuotation } from './fixed-services'
import type { CatalogImportDocument } from './catalog'
import { mergeSharedCatalog } from './shared-catalog'
import { startCatalogRefresh, type CatalogRefreshStatus } from './catalog-refresh'
import type { BlueDollarQuote } from './exchange-quote'
import { startExchangeRateRefresh, type ExchangeRefreshState } from './exchange-refresh'
import { parseExchangeRate } from './exchange'
import { BulkEntryDialog } from './BulkEntryDialog'
import { canSelectCatalogItem } from './catalog-stock'
import { inspectQuotationAvailability } from './quotation-availability'
import { useCatalogClock } from './useCatalogClock'
import { createHarnessPresetRow, isHarnessPresetRow } from './harness-preset'

function initialData() {
  try {
    const storage = window.localStorage
    const current = loadCurrentQuotation(storage)
    return { catalog: loadCatalog(storage), current: { ...current, quotation: prepareFixedServiceQuotation(current.quotation) } }
  } catch {
    return {
      catalog: { catalog: [] as CatalogItem[], error: 'El almacenamiento del catálogo no está disponible.', stored: false, raw: null },
      current: { quotation: createQuotation(), error: 'No se podrá recuperar este presupuesto al recargar. Podés seguir editándolo y compartirlo.', raw: null },
    }
  }
}

type RowEditingState = { kind: 'new'; row: QuotationRow } | { kind: 'existing'; rowId: string }

export default function QuotationApp() {
  const [initial] = useState(initialData)
  const [quotation, setQuotation] = useState(initial.current.quotation)
  const [catalog, setCatalog] = useState(initial.catalog.catalog)
  const quotationRef = useRef(initial.current.quotation)
  const catalogRef = useRef(initial.catalog.catalog)
  const catalogStorageRaw = useRef(initial.catalog.raw)
  const currentStorageRaw = useRef(initial.current.raw)
  const [catalogStorageEnabled, setCatalogStorageEnabled] = useState(!initial.catalog.error)
  const [recoveryEnabled, setRecoveryEnabled] = useState(!initial.current.error)
  const catalogWriteAllowed = useRef(!initial.catalog.error)
  const recoveryWriteAllowed = useRef(!initial.current.error)
  const [catalogError, setCatalogError] = useState(initial.catalog.error)
  const [recoveryError, setRecoveryError] = useState(initial.current.error)
  const [dialog, setDialog] = useState<'header' | 'bulk' | 'discount' | null>(null)
  const [rowEditing, setRowEditing] = useState<RowEditingState | null>(null)
  const [priceEditing, setPriceEditing] = useState<RowEditingState | null>(null)
  const [message, setMessage] = useState('')
  const [prepared, setPrepared] = useState<{ file: File; quotation: Quotation; provisional: boolean } | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [sharedCatalogStatus, setSharedCatalogStatus] = useState<CatalogRefreshStatus>('loading')
  const [rateState, setRateState] = useState<(ExchangeRefreshState & { id: string }) | null>(null)
  const [rateRefreshRequest, setRateRefreshRequest] = useState<{ id: string; token: string } | null>(null)
  const bulkButton = useRef<HTMLButtonElement>(null)
  const newQuotationButton = useRef<HTMLButtonElement>(null)
  const rowEditorTrigger = useRef<HTMLElement | null>(null)
  const discountTrigger = useRef<HTMLElement | null>(null)
  const generation = useRef(0)
  const calculation = calculateQuotation(quotation)
  const availabilityNow = useCatalogClock(catalog, quotation.rows)
  const availability = inspectQuotationAvailability(quotation, catalog, availabilityNow)
  const canExport = calculation.canExport && availability.issues.length === 0
  const preparedFile = prepared?.quotation === quotation && canExport && prepared.provisional === availability.hasProvisional ? prepared.file : null
  const editingRow = rowEditing?.kind === 'new'
    ? rowEditing.row
    : quotation.rows.find((row) => row.id === rowEditing?.rowId)
  const priceEditingRow = priceEditing?.kind === 'new'
    ? priceEditing.row
    : quotation.rows.find((row) => row.id === priceEditing?.rowId)
  const rateLoading = quotation.exchangeRateMode !== 'frozen' && rateState?.id === quotation.id && rateState.loading
  const rateError = quotation.exchangeRateMode !== 'frozen' && rateState?.id === quotation.id ? rateState.error : null
  const displayedRate = parseExchangeRate(quotation.exchangeRate ?? '')

  function persistCatalog(next: CatalogItem[]) {
    const storage = window.localStorage
    const result = saveCatalog(storage, next, {
      expectedRaw: catalogStorageRaw.current,
    })
    if (result.ok) catalogStorageRaw.current = result.raw
    if (result.conflict) {
      catalogWriteAllowed.current = false
      setCatalogStorageEnabled(false)
    }
    return result
  }

  function persistCurrent(next: Quotation, overwriteInvalid = false) {
    const storage = window.localStorage
    const result = saveCurrentQuotation(storage, next, {
      expectedRaw: overwriteInvalid ? storage.getItem(CURRENT_QUOTATION_STORAGE_KEY) : currentStorageRaw.current,
      overwriteInvalid,
    })
    if (result.ok) currentStorageRaw.current = result.raw
    if (result.conflict) {
      recoveryWriteAllowed.current = false
      setRecoveryEnabled(false)
    }
    return result
  }

  function startNewQuotation() {
    if ((hasQuotationContent(quotationRef.current) || recoveryError) && !window.confirm(
      '¿Comenzar un presupuesto nuevo? Se reemplazará el presupuesto en curso de este navegador. Descargá la imagen del actual antes de continuar. El catálogo y sus precios se conservan.',
    )) {
      window.requestAnimationFrame(() => newQuotationButton.current?.focus())
      return
    }
    const next = createQuotation()
    if (!updateQuotation(next)) return
    recoveryWriteAllowed.current = true
    setRecoveryEnabled(true)
    try {
      setRecoveryError(persistCurrent(next, true).error)
    } catch {
      setRecoveryError('No se podrá recuperar este presupuesto al recargar. Podés seguir editándolo y compartirlo.')
    }
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.quotation-heading-edit')?.focus())
  }

  function closeBulk() {
    setDialog(null)
    window.requestAnimationFrame(() => bulkButton.current?.focus())
  }

  function openDiscount() {
    discountTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setDialog('discount')
  }

  function closeDiscount() {
    setDialog(null)
    window.requestAnimationFrame(() => {
      const target = discountTrigger.current?.isConnected ? discountTrigger.current
        : document.querySelector<HTMLButtonElement>('.quotation-heading-edit')
      target?.focus()
    })
  }

  function addBulkRows(rows: QuotationRow[]): boolean {
    const current = quotationRef.current
    if (current.rows.length + rows.length > 1000) {
      setMessage('La lista supera el máximo de 1000 conceptos. El presupuesto se conserva.')
      return false
    }
    const next = { ...current, rows: [...current.rows, ...rows] }
    const review = inspectQuotationAvailability({ ...current, rows }, catalogRef.current)
    if (review.issues.length > 0) {
      setMessage('Revisá la disponibilidad de los productos antes de agregar la lista.')
      return false
    }
    return updateQuotation(next)
  }

  function refreshSavedDollar() {
    const current = quotationRef.current
    if (!window.confirm('¿Consultar el dólar actual? Se conservarán los precios de cada concepto y podrán cambiar los totales convertidos.')) return
    if (updateQuotation({ ...current, exchangeRateMode: 'automatic' })) {
      setRateRefreshRequest({ id: current.id, token: crypto.randomUUID() })
    }
  }

  function updateQuotation(next: Quotation): boolean {
    try {
      serializeWorkspace({ version: 1, activeQuotationId: next.id, quotations: [next], catalog: [] })
    } catch {
      window.alert('El presupuesto supera el tamaño permitido. Reducí su contenido antes de continuar.')
      return false
    }
    generation.current += 1
    setPreparing(false)
    setMessage('')
    const updated = { ...next, updatedAt: new Date().toISOString() }
    quotationRef.current = updated
    setQuotation(updated)
    return true
  }

  const applyDollarQuote = useEffectEvent((id: string, quote: BlueDollarQuote): boolean => {
    const current = quotationRef.current
    if (current.id !== id || current.exchangeRateMode === 'frozen') return false
    return updateQuotation({ ...current, exchangeRate: quote.rate, exchangeRateQuote: quote })
  })
  const currentDollarQuote = useEffectEvent(() => quotation.exchangeRateQuote)

  useEffect(() => {
    if (quotation.exchangeRateMode === 'frozen') return
    const refresh = startExchangeRateRefresh({
      initialQuote: rateRefreshRequest?.id === quotation.id ? undefined : currentDollarQuote(),
      isActive: () => document.visibilityState !== 'hidden' && navigator.onLine,
      onQuote: (quote) => applyDollarQuote(quotation.id, quote),
      onState: (state) => { setRateState({ id: quotation.id, ...state }) },
    })
    function checkRate() {
      refresh.check()
    }
    window.addEventListener('focus', checkRate)
    window.addEventListener('online', checkRate)
    document.addEventListener('visibilitychange', checkRate)
    return () => {
      refresh.stop()
      window.removeEventListener('focus', checkRate)
      window.removeEventListener('online', checkRate)
      document.removeEventListener('visibilitychange', checkRate)
    }
  }, [quotation.id, quotation.exchangeRateMode, rateRefreshRequest])

  function updateCatalog(next: CatalogItem[]): boolean {
    try { serializeCatalogBackup(next) }
    catch {
      setCatalogError('El catálogo supera el tamaño o el formato permitido. Tus opciones actuales se conservan.')
      return false
    }
    catalogRef.current = next
    setCatalog(next)
    return true
  }

  const applySharedCatalog = useEffectEvent((document: CatalogImportDocument): boolean => {
    try {
      const current = catalogRef.current
      const next = mergeSharedCatalog(current, document)
      return next === current || updateCatalog(next)
    } catch {
      return false
    }
  })

  useEffect(() => {
    const refresh = startCatalogRefresh({
      isActive: () => document.visibilityState !== 'hidden' && navigator.onLine,
      onCatalog: applySharedCatalog,
      onStatus: setSharedCatalogStatus,
    })
    function checkCatalog() {
      refresh.check()
    }
    window.addEventListener('focus', checkCatalog)
    window.addEventListener('online', checkCatalog)
    document.addEventListener('visibilitychange', checkCatalog)
    return () => {
      refresh.stop()
      window.removeEventListener('focus', checkCatalog)
      window.removeEventListener('online', checkCatalog)
      document.removeEventListener('visibilitychange', checkCatalog)
    }
  }, [])

  useEffect(() => {
    if (!catalogStorageEnabled) return
    const timer = window.setTimeout(() => {
      if (!catalogWriteAllowed.current || catalogRef.current !== catalog) return
      try {
        const result = persistCatalog(catalog)
        setCatalogError(result.error)
      } catch { setCatalogError('No se pudo acceder al catálogo guardado. Las opciones disponibles siguen en esta pestaña.') }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [catalog, catalogStorageEnabled])

  useEffect(() => {
    if (!recoveryEnabled) return
    const timer = window.setTimeout(() => {
      if (!recoveryWriteAllowed.current || quotationRef.current !== quotation) return
      try { setRecoveryError(persistCurrent(quotation).error) }
      catch { setRecoveryError('No se podrá recuperar este presupuesto al recargar. Podés seguir editándolo y compartirlo.') }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [quotation, recoveryEnabled])

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === CATALOG_STORAGE_KEY || event.key === null) {
        catalogWriteAllowed.current = false
        setCatalogStorageEnabled(false)
        setCatalogError('Otra pestaña cambió el catálogo. Su guardado se pausó para evitar sobrescribirlo. Recargá para usar los datos guardados por la otra pestaña.')
      }
      if (event.key === CURRENT_QUOTATION_STORAGE_KEY || event.key === null) {
        recoveryWriteAllowed.current = false
        setRecoveryEnabled(false)
        setRecoveryError('Otra pestaña cambió el presupuesto en curso. La recuperación de esta pestaña se pausó; podés seguir editando y compartirlo. Recargá para abrir el de la otra pestaña.')
      }
    }
    function flush() {
      if (catalogWriteAllowed.current) {
        try { persistCatalog(catalogRef.current) } catch { /* Preserve in-memory data when storage is unavailable. */ }
      }
      if (recoveryWriteAllowed.current) {
        try { persistCurrent(quotationRef.current) } catch { /* Editing and export remain available. */ }
      }
    }
    window.addEventListener('storage', handleStorage)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('pagehide', flush)
    }
  }, [catalog, quotation])

  function rememberRowTrigger() {
    rowEditorTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }

  function closeRowEditor(rowId?: string, audioCategory = editingRow?.audioCategory) {
    setRowEditing(null)
    window.requestAnimationFrame(() => {
      const rowButton = rowId
        ? document.querySelector<HTMLElement>(`[data-row-id="${rowId}"]`)
        : null
      const previous = rowEditorTrigger.current
      const categoryTarget = audioCategory
        ? document.querySelector<HTMLElement>(`button[data-audio-category="${audioCategory}"]`)
          ?? document.querySelector<HTMLElement>(`[data-audio-category="${audioCategory}"] [data-row-id]`)
        : null
      const target = rowButton ?? (previous?.isConnected ? previous : categoryTarget ?? document.querySelector<HTMLElement>('.quotation-add-row'))
      target?.focus()
    })
  }

  function editRow(rowId: string) {
    rememberRowTrigger()
    setRowEditing({ kind: 'existing', rowId })
  }

  function closePriceEditor() {
    const previous = rowEditorTrigger.current
    const rowId = priceEditingRow?.id
    setPriceEditing(null)
    window.requestAnimationFrame(() => {
      const target = rowId ? document.querySelector<HTMLElement>(`[data-row-price-id="${rowId}"]`) : null
      const focusTarget = target ?? (previous?.isConnected ? previous : document.querySelector<HTMLButtonElement>('.quotation-heading-edit'))
      focusTarget?.focus()
    })
  }

  function editPrice(rowId: string) {
    rememberRowTrigger()
    setPriceEditing({ kind: 'existing', rowId })
  }

  function savePrice(nextRow: QuotationRow) {
    if (!priceEditing) return
    const current = quotationRef.current
    const row = priceEditing.kind === 'new'
      ? priceEditing.row
      : current.rows.find((entry) => entry.id === priceEditing.rowId)
    if (!row) { closePriceEditor(); return }
    if (nextRow.id !== row.id) return
    const result = saveQuotationRow(current, nextRow, priceEditing.kind)
    if (!result.ok) { window.alert(result.error); return }
    if ((priceEditing.kind === 'existing' && nextRow === row) || updateQuotation({ ...current, rows: result.rows })) closePriceEditor()
  }

  function addRow(section: RowSection, audioCategory?: AudioCategory) {
    const current = quotationRef.current
    const existing = isSingleRowCategory(audioCategory)
      ? current.rows.find((row) => row.section === section && row.audioCategory === audioCategory && !isEmptyRow(row))
      : undefined
    if (existing) { editRow(existing.id); return }
    if (current.rows.length >= 1000 && audioCategory !== 'adapters') { setMessage('Llegaste al máximo de 1000 conceptos en este presupuesto.'); return }
    rememberRowTrigger()
    setRowEditing({ kind: 'new', row: createQuotationRowDraft(section, current.currency, audioCategory) })
  }

  function currentHarnessPreset(): QuotationRow | undefined {
    const rows = quotationRef.current.rows
    return rows.find(isHarnessPresetRow)
      ?? rows.find((row) => row.section === 'extras' && row.audioCategory === 'harness' && !isEmptyRow(row))
  }

  function editHarnessPreset() {
    const existing = currentHarnessPreset()
    if (existing) { editPrice(existing.id); return }
    if (quotationRef.current.rows.length >= 1000) {
      setMessage('Llegaste al m\u00e1ximo de 1000 conceptos en este presupuesto.')
      return
    }
    rememberRowTrigger()
    setPriceEditing({ kind: 'new', row: createHarnessPresetRow(false) })
  }

  function saveRow(row: QuotationRow, addVariant = false) {
    if (!rowEditing) return
    if (rowEditing.kind === 'new' && isEmptyRow(row) && !isHarnessPresetRow(row)) { closeRowEditor(); return }
    const current = quotationRef.current
    const result = saveQuotationRow(current, row, rowEditing.kind)
    if (!result.ok) { window.alert(result.error); return }
    if (updateQuotation({ ...current, rows: result.rows })) {
      if (addVariant && rowEditing.kind === 'existing' && row.audioCategory === 'adapters') addRow('extras', 'adapters')
      else closeRowEditor(result.rowId, row.audioCategory)
      if (result.merged) setMessage('Se sumó la cantidad a la variante de aros existente.')
    }
  }

  function removeRow() {
    if (rowEditing?.kind !== 'existing') return
    const current = quotationRef.current
    const removed = current.rows.find((row) => row.id === rowEditing.rowId)
    const categoryRows = current.rows.filter((row) => row.section === removed?.section && row.audioCategory === removed?.audioCategory && !isEmptyRow(row))
    const index = categoryRows.findIndex((row) => row.id === rowEditing.rowId)
    const neighbor = categoryRows[index + 1] ?? categoryRows[index - 1]
    if (updateQuotation({ ...current, rows: current.rows.filter((row) => row.id !== rowEditing.rowId) })) closeRowEditor(neighbor?.id, removed?.audioCategory)
  }

  async function prepareImage() {
    const currentAvailability = inspectQuotationAvailability(quotation, catalogRef.current)
    if (!calculation.canExport || currentAvailability.issues.length > 0) { setMessage('Completá los datos pendientes y revisá la disponibilidad antes de preparar la imagen.'); return }
    const request = ++generation.current
    setPreparing(true)
    setMessage('Preparando imagen…')
    try {
      const file = await createQuotationFile(quotation, { availabilityCatalog: catalogRef.current, availabilityWarning: currentAvailability.hasProvisional })
      if (request === generation.current) {
        const latestAvailability = inspectQuotationAvailability(quotationRef.current, catalogRef.current)
        if (latestAvailability.issues.length > 0 || latestAvailability.hasProvisional !== currentAvailability.hasProvisional) {
          setMessage('La disponibilidad cambió mientras se preparaba la imagen. Revisala antes de volver a preparar.')
          return
        }
        setPrepared({ file, quotation, provisional: currentAvailability.hasProvisional })
        setMessage('Imagen lista. Podés descargarla o compartirla y seguir ajustando el presupuesto.')
      }
    } catch (error) {
      if (request === generation.current) setMessage(error instanceof Error ? error.message : 'No se pudo preparar la imagen. Intentá otra vez.')
    } finally {
      if (request === generation.current) setPreparing(false)
    }
  }

  function fileReadyForDelivery(): File | null {
    const current = quotationRef.current
    const review = inspectQuotationAvailability(current, catalogRef.current)
    if (!prepared || prepared.quotation !== current || !calculateQuotation(current).canExport
      || review.issues.length > 0 || review.hasProvisional !== prepared.provisional) {
      setPrepared(null)
      setMessage('Revisá los datos y la disponibilidad antes de volver a preparar la imagen.')
      return null
    }
    return prepared.file
  }

  function downloadPreparedImage() {
    const file = fileReadyForDelivery()
    if (file) downloadQuotationFile(file)
  }

  async function shareImage() {
    if (sharing) return
    const file = fileReadyForDelivery()
    if (!file) return
    const request = generation.current
    setSharing(true)
    try {
      const result = await shareQuotationFile(file, navigator)
      if (request !== generation.current) return
      if (result === 'unsupported') {
        const currentFile = fileReadyForDelivery()
        if (!currentFile) return
        downloadQuotationFile(currentFile)
        setMessage('Este navegador no permite compartir archivos. Se descargó la imagen para compartirla manualmente.')
      } else if (result === 'cancelled') setMessage('Compartir cancelado. La imagen sigue disponible.')
      else setMessage('Menú de compartir cerrado. El envío se confirma en la aplicación que elijas.')
    } catch {
      if (request === generation.current) setMessage('No se pudo abrir el menú para compartir. Podés descargar la imagen.')
    } finally {
      setSharing(false)
    }
  }

  return (
    <div className="quotation-workspace">
      <a className="skip-link" href="#quotation">Ir al presupuesto</a>
      <main className="workspace-main">
        <div id="quotation">
          <QuotationPreview
            quotation={quotation}
            onEditHeader={() => setDialog('header')}
            onEditRow={editRow}
            onEditPrice={editPrice}
            onAddRow={addRow}
            onEditHarnessPreset={editHarnessPreset}
            onEditDiscount={openDiscount}
            notices={<>
              {recoveryError && <p className="notice error" role="alert">{recoveryError}</p>}
              {catalogError && <p className="notice error" role="status">{catalogError} Podés seguir armando este presupuesto.</p>}
              {sharedCatalogStatus === 'error' && <p className="notice error" role="status">No se pudo actualizar el catálogo compartido. Tus opciones y precios se conservan. Se reintentará automáticamente.</p>}
            </>}
            exchangeDetails={<>
              <p className="exchange-panel" id="quotation-exchange-rate">
                <span>Dólar del presupuesto</span><span className="exchange-summary-value">{displayedRate.ok ? displayedRate.rateLabel : rateLoading ? 'Consultando…' : 'Pendiente'}</span>
              </p>
              {quotation.exchangeRateMode === 'frozen' && <div className="exchange-frozen"><p className="field-help">Dólar guardado en este presupuesto. Se mantiene hasta que lo actualices.</p><button className="button secondary" type="button" onClick={refreshSavedDollar}>Actualizar dólar guardado</button></div>}
              {rateLoading && <p className="field-help" role="status">Consultando cotización…</p>}
              {quotation.exchangeRateQuote && availabilityNow - Date.parse(quotation.exchangeRateQuote.updatedAt) > 24 * 60 * 60 * 1000 && <p className="exchange-warning">Cotización anterior: revisá la fecha antes de compartir.</p>}
              {rateError && <p className="exchange-warning" role="alert">{rateError}</p>}
            </>}
          />
        </div>
        <nav className="workspace-options" aria-label="Opciones del presupuesto">
          <button ref={bulkButton} className="button secondary" type="button" onClick={() => setDialog('bulk')}>Pegar códigos o nombres</button>
          <button ref={newQuotationButton} className="button secondary" type="button" onClick={startNewQuotation}>Nuevo presupuesto</button>
        </nav>
        <p className="current-quotation-note">El presupuesto en curso se recupera al recargar.</p>
      </main>
      <footer className="export-bar">
        <p className={message ? 'export-message' : 'sr-only'} role="status" aria-live="polite">{message}</p>
        <div className="export-actions">{preparedFile ? <><button className="button secondary" type="button" onClick={downloadPreparedImage}>Descargar PNG</button><button className="button primary" disabled={sharing} type="button" onClick={() => { void shareImage() }}>{sharing ? 'Abriendo…' : 'Compartir imagen'}</button></> : <button className="button primary" disabled={preparing || !canExport} type="button" onClick={() => { void prepareImage() }}>{preparing ? 'Preparando…' : 'Preparar imagen'}</button>}</div>
      </footer>
      {dialog === 'header' && <HeaderEditor quotation={quotation} onClose={() => setDialog(null)} onSave={(next) => { if (updateQuotation(next)) setDialog(null) }} />}
      {dialog === 'bulk' && <BulkEntryDialog catalog={catalog} canSelect={canSelectCatalogItem} defaultCurrency={quotation.currency} existingRowCount={quotation.rows.length} onApply={addBulkRows} onClose={closeBulk} />}
      {dialog === 'discount' && <DiscountEditor quotation={quotation} onClose={closeDiscount} onSave={(discount) => {
        const next = { ...quotation }
        if (discount) next.discount = discount
        else delete next.discount
        if (updateQuotation(next)) closeDiscount()
      }} />}
      {editingRow && <RowEditor key={editingRow.id} row={editingRow} quotation={quotation} catalog={catalog} isNew={rowEditing?.kind === 'new'} directConcept={isDirectExtraRow(editingRow) ? editingRow.concept : undefined} onClose={() => closeRowEditor()} onSave={saveRow} onRemove={removeRow} onEditExisting={(rowId) => setRowEditing({ kind: 'existing', rowId })} />}
      {priceEditingRow && <RowPriceEditor key={priceEditingRow.id} row={priceEditingRow} quotation={quotation} onClose={closePriceEditor} onSave={savePrice} />}
    </div>
  )
}
