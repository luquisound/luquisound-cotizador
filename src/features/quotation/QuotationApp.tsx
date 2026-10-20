import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { calculateQuotation, isEmptyRow } from './calculation'
import { createQuotation, hasQuotationContent, type CatalogItem, type Quotation, type QuotationRow, type RowSection } from './model'
import { isDirectExtraRow, isSingleRowCategory, type AudioCategory } from './audio-categories'
import { createQuotationRowDraft, saveQuotationRow } from './row-actions'
import { serializeWorkspace, type WorkspaceSaveResult } from './persistence'
import {
  CATALOG_STORAGE_KEY, CURRENT_QUOTATION_STORAGE_KEY, loadCatalog, loadCurrentQuotation,
  parseCatalogBackup, saveCatalog, saveCurrentQuotation, serializeCatalogBackup,
} from './working-storage'
import { createQuotationFile, downloadQuotationFile, shareQuotationFile } from './export'
import { QuotationPreview } from './QuotationPreview'
import { HeaderEditor, RowEditor } from './QuotationDialogs'
import { RowPriceEditor } from './RowPriceEditor'
import { prepareFixedServiceQuotation } from './fixed-services'
import { CatalogEditor } from './CatalogTools'
import type { CatalogImportDocument } from './catalog'
import { loadSharedCatalog, mergeSharedCatalog } from './shared-catalog'
import type { BlueDollarQuote } from './exchange-quote'
import { startExchangeRateRefresh, type ExchangeRefreshState } from './exchange-refresh'
import { parseExchangeRate } from './exchange'
import { BulkEntryDialog } from './BulkEntryDialog'
import { canSelectCatalogItem } from './catalog-stock'
import { inspectQuotationAvailability } from './quotation-availability'
import { useCatalogClock } from './useCatalogClock'
import { QuotationLibraryDialog } from './QuotationLibraryDialog'
import { useQuotationLibrary } from './useQuotationLibrary'
import { createHarnessPresetRow, isHarnessPresetRow, setHarnessPresetSelected } from './harness-preset'

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
  const [savedCatalog, setSavedCatalog] = useState<CatalogItem[] | null>(initial.catalog.stored ? initial.catalog.catalog : null)
  const [dialog, setDialog] = useState<'header' | 'catalog' | 'bulk' | 'library' | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const optionsId = useId()
  const optionsContainer = useRef<HTMLDivElement>(null)
  const optionsButton = useRef<HTMLButtonElement>(null)
  const [rowEditing, setRowEditing] = useState<RowEditingState | null>(null)
  const [priceEditingId, setPriceEditingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [prepared, setPrepared] = useState<{ file: File; quotation: Quotation; provisional: boolean } | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [sharedCatalogStatus, setSharedCatalogStatus] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading')
  const [sharedCatalogAttempt, setSharedCatalogAttempt] = useState(0)
  const [rateState, setRateState] = useState<(ExchangeRefreshState & { id: string }) | null>(null)
  const [rateRefreshRequest, setRateRefreshRequest] = useState<{ id: string; token: string } | null>(null)
  const catalogButton = useRef<HTMLButtonElement>(null)
  const libraryButton = useRef<HTMLButtonElement>(null)
  const bulkButton = useRef<HTMLButtonElement>(null)
  const rowEditorTrigger = useRef<HTMLElement | null>(null)
  const generation = useRef(0)
  const catalogSaveStatus = !catalogStorageEnabled ? 'Guardado del catálogo pausado' : catalogError ? 'No se pudo guardar el catálogo' : savedCatalog === catalog ? 'Catálogo y precios conservados en este navegador' : 'Guardando catálogo…'
  const calculation = calculateQuotation(quotation)
  const availabilityNow = useCatalogClock(catalog, quotation.rows)
  const availability = inspectQuotationAvailability(quotation, catalog, availabilityNow)
  const canExport = calculation.canExport && availability.issues.length === 0
  const preparedFile = prepared?.quotation === quotation && canExport && prepared.provisional === availability.hasProvisional ? prepared.file : null
  const savedQuotes = useQuotationLibrary()
  const editingRow = rowEditing?.kind === 'new'
    ? rowEditing.row
    : quotation.rows.find((row) => row.id === rowEditing?.rowId)
  const priceEditingRow = quotation.rows.find((row) => row.id === priceEditingId)
  const rateLoading = quotation.exchangeRateMode !== 'frozen' && rateState?.id === quotation.id && rateState.loading
  const rateError = quotation.exchangeRateMode !== 'frozen' && rateState?.id === quotation.id ? rateState.error : null
  const displayedRate = parseExchangeRate(quotation.exchangeRate ?? '')

  function persistCatalog(next: CatalogItem[], overwriteInvalid = false) {
    const storage = window.localStorage
    const result = saveCatalog(storage, next, {
      expectedRaw: overwriteInvalid ? storage.getItem(CATALOG_STORAGE_KEY) : catalogStorageRaw.current,
      overwriteInvalid,
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

  function retrySharedCatalog() {
    setSharedCatalogStatus('loading')
    setSharedCatalogAttempt((attempt) => attempt + 1)
  }

  function openSecondaryDialog(next: 'catalog' | 'bulk' | 'library') {
    setOptionsOpen(false)
    setDialog(next)
  }

  useEffect(() => {
    if (!optionsOpen) return
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !optionsContainer.current?.contains(event.target)) setOptionsOpen(false)
    }
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOptionsOpen(false)
      optionsButton.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeWithEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeWithEscape)
    }
  }, [optionsOpen])

  function closeCatalog() {
    setDialog(null)
    // Restore focus after the modal is removed and the page is no longer inert.
    window.requestAnimationFrame(() => {
      const target = catalogButton.current ?? optionsButton.current ?? document.querySelector<HTMLButtonElement>('.quotation-heading-edit')
      target?.focus()
    })
  }

  function startNewQuotation() {
    if ((hasQuotationContent(quotationRef.current) || recoveryError) && !window.confirm(
      '¿Comenzar un presupuesto nuevo? Se reemplazará el presupuesto en curso de este navegador. Descargá o guardá el actual antes de continuar. Tu catálogo y sus precios se conservan.',
    )) {
      window.requestAnimationFrame(() => optionsButton.current?.focus())
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

  function closeLibrary() {
    setDialog(null)
    window.requestAnimationFrame(() => (libraryButton.current ?? optionsButton.current)?.focus())
  }

  function closeBulk() {
    setDialog(null)
    window.requestAnimationFrame(() => (bulkButton.current ?? optionsButton.current)?.focus())
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

  function saveNamedQuotation(name: string, replaceEntryId?: string): boolean {
    const current = quotationRef.current
    const saved = savedQuotes.saveCurrent(current, name, replaceEntryId)
    if (saved) {
      updateQuotation({ ...current, exchangeRateMode: 'frozen' })
      setMessage('Presupuesto guardado. Sus importes y el dólar se conservaron sin actualización automática.')
    }
    return saved
  }

  function openNamedQuotation(entryId: string, duplicate = false) {
    if (recoveryError && !window.confirm('Se reemplazarán los datos de recuperación de este navegador por el presupuesto elegido. El catálogo y el historial se conservan. ¿Continuar?')) return
    const next = savedQuotes.openEntry(entryId, duplicate)
    if (!next || !updateQuotation(next)) return
    recoveryWriteAllowed.current = true
    setRecoveryEnabled(true)
    try { setRecoveryError(persistCurrent(next, true).error) }
    catch { setRecoveryError('No se podrá recuperar este presupuesto al recargar. Podés conservarlo en el historial o descargarlo.') }
    closeLibrary()
  }

  function downloadLibraryBackup() {
    try {
      const backup = savedQuotes.createBackup()
      downloadQuotationFile(backup.file)
      setMessage(backup.message)
    } catch {
      setMessage('No se pudo crear el respaldo del historial. Los presupuestos se conservan.')
    }
  }

  function refreshSavedDollar() {
    const current = quotationRef.current
    if (!window.confirm('¿Consultar el dólar actual? Se conservarán los precios de cada concepto y podrán cambiar los totales convertidos. El presupuesto guardado en el historial no se modifica.')) return
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

  const applySharedCatalog = useEffectEvent((document: CatalogImportDocument) => {
    try {
      const current = catalogRef.current
      const next = mergeSharedCatalog(current, document)
      if (next !== current && !updateCatalog(next)) {
        setSharedCatalogStatus('error')
        return
      }
      setSharedCatalogStatus('ready')
    } catch {
      setSharedCatalogStatus('error')
    }
  })

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      controller.abort()
      setSharedCatalogStatus('error')
    }, 15000)
    void loadSharedCatalog(controller.signal).then((document) => {
      if (controller.signal.aborted) return
      if (document === null) setSharedCatalogStatus('unavailable')
      else applySharedCatalog(document)
    }).catch(() => {
      if (!controller.signal.aborted) setSharedCatalogStatus('error')
    }).finally(() => window.clearTimeout(timeout))
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [sharedCatalogAttempt])

  useEffect(() => {
    if (!catalogStorageEnabled) return
    const timer = window.setTimeout(() => {
      if (!catalogWriteAllowed.current || catalogRef.current !== catalog) return
      try {
        const result = persistCatalog(catalog)
        setCatalogError(result.error)
        if (result.ok) setSavedCatalog(catalog)
      } catch { setCatalogError('No se pudo acceder al catálogo guardado. Descargá un respaldo del catálogo.') }
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
        setCatalogError('Otra pestaña cambió el catálogo. Su guardado se pausó para evitar sobrescribirlo. Conservá un respaldo antes de habilitarlo.')
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
    const rowId = priceEditingId
    setPriceEditingId(null)
    window.requestAnimationFrame(() => {
      const target = rowId ? document.querySelector<HTMLElement>(`[data-row-price-id="${rowId}"]`) : null
      const focusTarget = target ?? (previous?.isConnected ? previous : optionsButton.current)
      focusTarget?.focus()
    })
  }

  function editPrice(rowId: string) {
    rememberRowTrigger()
    setPriceEditingId(rowId)
  }

  function savePrice(nextRow: QuotationRow) {
    const current = quotationRef.current
    const row = current.rows.find((entry) => entry.id === priceEditingId)
    if (!row) { closePriceEditor(); return }
    if (nextRow.id !== row.id) return
    const result = saveQuotationRow(current, nextRow, 'existing')
    if (!result.ok) { window.alert(result.error); return }
    if (nextRow === row || updateQuotation({ ...current, rows: result.rows })) closePriceEditor()
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

  function setHarnessSelected(enabled: boolean) {
    const current = quotationRef.current
    const existing = currentHarnessPreset()
    if (!existing && !enabled) return
    if (!existing && current.rows.length >= 1000) {
      setMessage('Llegaste al m\u00e1ximo de 1000 conceptos en este presupuesto.')
      return
    }
    const selected = existing ? setHarnessPresetSelected(existing, enabled) : createHarnessPresetRow(enabled)
    updateQuotation({ ...current, rows: existing
      ? current.rows.map((row) => row.id === existing.id ? selected : row)
      : [...current.rows, selected] })
  }

  function editHarnessPreset() {
    const existing = currentHarnessPreset()
    if (existing) { editPrice(existing.id); return }
    if (quotationRef.current.rows.length >= 1000) {
      setMessage('Llegaste al m\u00e1ximo de 1000 conceptos en este presupuesto.')
      return
    }
    rememberRowTrigger()
    setRowEditing({ kind: 'new', row: createHarnessPresetRow(false) })
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

  function exportCatalogBackup() {
    try {
      const file = new File([serializeCatalogBackup(catalog)], 'luquisound-catalogo-respaldo-' + new Date().toISOString().slice(0, 10) + '.json', { type: 'application/json' })
      downloadQuotationFile(file)
      setMessage('Respaldo del catálogo descargado. Guardalo en un lugar privado.')
    } catch { setCatalogError('No se pudo crear el respaldo del catálogo. Revisá su tamaño y volvé a intentar.') }
  }

  async function importCatalogBackup(file: File, signal?: AbortSignal): Promise<boolean> {
    if (file.size > 5 * 1024 * 1024) throw new Error('El respaldo supera el máximo de 5 MB.')
    const next = parseCatalogBackup(await file.text())
    if (signal?.aborted) return false
    if (!window.confirm('¿Reemplazar el catálogo y sus precios por los del respaldo? El presupuesto en curso se conserva.')) return false
    if (signal?.aborted) return false
    let result: WorkspaceSaveResult
    try { result = persistCatalog(next, true) }
    catch { throw new Error('No se pudo restaurar el catálogo en este navegador.') }
    if (!result.ok) {
      setCatalogError(result.error)
      throw new Error(result.error ?? 'No se pudo restaurar el catálogo.')
    }
    catalogWriteAllowed.current = true
    setCatalogStorageEnabled(true)
    setCatalogError(null)
    catalogRef.current = next
    setCatalog(next)
    setSavedCatalog(next)
    return true
  }

  function enableCatalogStorage() {
    if (!window.confirm('¿Habilitar el guardado del catálogo? Sus datos guardados se reemplazarán por las opciones y precios que ves ahora.')) return
    try {
      const result = persistCatalog(catalog, true)
      setCatalogError(result.error)
      if (result.ok) {
        catalogWriteAllowed.current = true
        setCatalogStorageEnabled(true)
        setSavedCatalog(catalog)
      }
    } catch { setCatalogError('No se pudo habilitar el guardado del catálogo. Conservá un respaldo.') }
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
            onSetHarnessSelected={setHarnessSelected}
            onEditHarnessPreset={editHarnessPreset}
            notices={<>
              {recoveryError && <p className="notice error" role="alert">{recoveryError}</p>}
              {catalogError && <div className="notice error" role="status"><p>El catálogo tiene un problema de guardado. Podés seguir armando este presupuesto.</p><button className="button secondary" type="button" onClick={() => setDialog('catalog')}>Revisar catálogo</button></div>}
              {sharedCatalogStatus === 'error' && <div className="notice error" role="status"><p>No se pudo actualizar el catálogo compartido. Podés seguir usando tus opciones.</p><button className="button secondary" type="button" onClick={retrySharedCatalog}>Reintentar catálogo compartido</button></div>}
            </>}
            exchangeDetails={<>
              <p className="exchange-panel" id="quotation-exchange-rate">
                <span>Dólar del presupuesto</span><span className="exchange-summary-value">{displayedRate.ok ? displayedRate.rateLabel : rateLoading ? 'Consultando…' : 'Pendiente'}</span>
              </p>
              {quotation.exchangeRateMode === 'frozen' && <div className="exchange-frozen"><p className="field-help">Dólar conservado del presupuesto guardado. No se actualiza al abrirlo.</p><button className="button secondary" type="button" onClick={refreshSavedDollar}>Actualizar dólar guardado</button></div>}
              {rateLoading && <p className="field-help" role="status">Consultando cotización…</p>}
              {quotation.exchangeRateQuote && availabilityNow - Date.parse(quotation.exchangeRateQuote.updatedAt) > 24 * 60 * 60 * 1000 && <p className="exchange-warning">Cotización anterior: revisá la fecha antes de compartir.</p>}
              {rateError && <p className="exchange-warning" role="alert">{rateError}</p>}
            </>}
          />
        </div>
        <div className="workspace-options" ref={optionsContainer} onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setOptionsOpen(false)
        }}>
          <button ref={optionsButton} className="workspace-options-toggle" type="button" aria-expanded={optionsOpen} aria-controls={optionsId} onClick={() => setOptionsOpen((open) => !open)}><span aria-hidden="true">⋯</span> Opciones</button>
          {optionsOpen && <nav id={optionsId} className="workspace-options-panel" aria-label="Opciones del presupuesto">
            <button ref={bulkButton} className="button secondary" type="button" onClick={() => openSecondaryDialog('bulk')}>Pegar códigos o nombres</button>
            <button ref={catalogButton} className="button secondary" type="button" onClick={() => openSecondaryDialog('catalog')}>Mi catálogo</button>
            <button ref={libraryButton} className="button secondary" type="button" onClick={() => openSecondaryDialog('library')}>Presupuestos guardados</button>
            <button className="button secondary" type="button" onClick={() => { setOptionsOpen(false); startNewQuotation() }}>Nuevo presupuesto</button>
          </nav>}
        </div>
        <p className="current-quotation-note">El presupuesto en curso se recupera al recargar.</p>
      </main>
      <footer className="export-bar">
        <p className={message ? 'export-message' : 'sr-only'} role="status" aria-live="polite">{message}</p>
        <div className="export-actions">{preparedFile ? <><button className="button secondary" type="button" onClick={downloadPreparedImage}>Descargar PNG</button><button className="button primary" disabled={sharing} type="button" onClick={() => { void shareImage() }}>{sharing ? 'Abriendo…' : 'Compartir imagen'}</button></> : <button className="button primary" disabled={preparing || !canExport} type="button" onClick={() => { void prepareImage() }}>{preparing ? 'Preparando…' : 'Preparar imagen'}</button>}</div>
      </footer>
      {dialog === 'header' && <HeaderEditor quotation={quotation} onClose={() => setDialog(null)} onSave={(next) => { if (updateQuotation(next)) setDialog(null) }} />}
      {dialog === 'catalog' && <CatalogEditor catalog={catalog} exchangeRate={quotation.exchangeRate ?? ''} saveStatus={catalogSaveStatus} saveError={catalogError} sharedCatalogStatus={sharedCatalogStatus} onRetrySharedCatalog={retrySharedCatalog} onExportBackup={exportCatalogBackup} onImportBackup={importCatalogBackup} onEnableStorage={!catalogStorageEnabled ? enableCatalogStorage : undefined} onClose={closeCatalog} onSave={updateCatalog} />}
      {dialog === 'bulk' && <BulkEntryDialog catalog={catalog} canSelect={canSelectCatalogItem} defaultCurrency={quotation.currency} existingRowCount={quotation.rows.length} onApply={addBulkRows} onClose={closeBulk} />}
      {dialog === 'library' && <QuotationLibraryDialog quotation={quotation} library={savedQuotes.library} storageError={savedQuotes.error} savingPaused={savedQuotes.paused} onSaveCurrent={saveNamedQuotation} onOpen={(id) => openNamedQuotation(id)} onDuplicate={(id) => openNamedQuotation(id, true)} onExport={downloadLibraryBackup} onImport={savedQuotes.importLibrary} onResumeSaving={savedQuotes.resumeSaving} onClose={closeLibrary} />}
      {editingRow && <RowEditor key={editingRow.id} row={editingRow} quotation={quotation} catalog={catalog} isNew={rowEditing?.kind === 'new'} directConcept={isDirectExtraRow(editingRow) ? editingRow.concept : undefined} onClose={() => closeRowEditor()} onSave={saveRow} onRemove={removeRow} onEditExisting={(rowId) => setRowEditing({ kind: 'existing', rowId })} />}
      {priceEditingRow && <RowPriceEditor key={priceEditingRow.id} row={priceEditingRow} quotation={quotation} onClose={closePriceEditor} onSave={savePrice} />}
    </div>
  )
}
