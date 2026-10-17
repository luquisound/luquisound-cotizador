import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { calculateQuotation } from './calculation'
import { createQuotation, createRow, type CatalogItem, type Quotation, type RowSection } from './model'
import { serializeWorkspace, type WorkspaceSaveResult } from './persistence'
import {
  CATALOG_STORAGE_KEY, CURRENT_QUOTATION_STORAGE_KEY, loadCatalog, loadCurrentQuotation,
  parseCatalogBackup, saveCatalog, saveCurrentQuotation, serializeCatalogBackup,
} from './working-storage'
import { createQuotationFile, downloadQuotationFile, shareQuotationFile } from './export'
import { QuotationPreview } from './QuotationPreview'
import { HeaderEditor, RowEditor } from './QuotationDialogs'
import { CatalogEditor } from './CatalogTools'
import type { CatalogImportDocument } from './catalog'
import { loadSharedCatalog, mergeSharedCatalog } from './shared-catalog'
import type { BlueDollarQuote } from './exchange-quote'
import { startExchangeRateRefresh, type ExchangeRefreshState } from './exchange-refresh'
import { parseExchangeRate } from './exchange'

function initialData() {
  try {
    const storage = window.localStorage
    return { catalog: loadCatalog(storage), current: loadCurrentQuotation(storage) }
  } catch {
    return {
      catalog: { catalog: [] as CatalogItem[], error: 'El almacenamiento del catálogo no está disponible.', stored: false },
      current: { quotation: createQuotation(), error: 'No se podrá recuperar este presupuesto al recargar. Podés seguir editándolo y compartirlo.' },
    }
  }
}

export default function QuotationApp() {
  const [initial] = useState(initialData)
  const [quotation, setQuotation] = useState(initial.current.quotation)
  const [catalog, setCatalog] = useState(initial.catalog.catalog)
  const quotationRef = useRef(initial.current.quotation)
  const catalogRef = useRef(initial.catalog.catalog)
  const [catalogStorageEnabled, setCatalogStorageEnabled] = useState(!initial.catalog.error)
  const [recoveryEnabled, setRecoveryEnabled] = useState(!initial.current.error)
  const catalogWriteAllowed = useRef(!initial.catalog.error)
  const recoveryWriteAllowed = useRef(!initial.current.error)
  const [catalogError, setCatalogError] = useState(initial.catalog.error)
  const [recoveryError, setRecoveryError] = useState(initial.current.error)
  const [savedCatalog, setSavedCatalog] = useState<CatalogItem[] | null>(initial.catalog.stored ? initial.catalog.catalog : null)
  const [dialog, setDialog] = useState<'header' | 'catalog' | null>(null)
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [prepared, setPrepared] = useState<{ file: File; quotation: Quotation } | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [sharedCatalogStatus, setSharedCatalogStatus] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading')
  const [sharedCatalogAttempt, setSharedCatalogAttempt] = useState(0)
  const [rateState, setRateState] = useState<(ExchangeRefreshState & { id: string }) | null>(null)
  const [rateCheckedAt, setRateCheckedAt] = useState(Date.now)
  const catalogButton = useRef<HTMLButtonElement>(null)
  const generation = useRef(0)
  const preparedFile = prepared?.quotation === quotation ? prepared.file : null
  const catalogSaveStatus = !catalogStorageEnabled ? 'Guardado del catálogo pausado' : catalogError ? 'No se pudo guardar el catálogo' : savedCatalog === catalog ? 'Catálogo y precios conservados en este navegador' : 'Guardando catálogo…'
  const calculation = calculateQuotation(quotation)
  const editingRow = quotation.rows.find((row) => row.id === editingRowId)
  const rateLoading = rateState?.id === quotation.id && rateState.loading
  const rateError = rateState?.id === quotation.id ? rateState.error : null
  const displayedRate = parseExchangeRate(quotation.exchangeRate ?? '')

  function retrySharedCatalog() {
    setSharedCatalogStatus('loading')
    setSharedCatalogAttempt((attempt) => attempt + 1)
  }

  function closeCatalog() {
    setDialog(null)
    // Restore focus after the modal is removed and the page is no longer inert.
    window.requestAnimationFrame(() => {
      const target = catalogButton.current ?? document.querySelector<HTMLButtonElement>('.quotation-heading-edit')
      target?.focus()
    })
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
    if (current.id !== id) return false
    return updateQuotation({ ...current, exchangeRate: quote.rate, exchangeRateQuote: quote })
  })
  const currentDollarQuote = useEffectEvent(() => quotation.exchangeRateQuote)

  useEffect(() => {
    const refresh = startExchangeRateRefresh({
      initialQuote: currentDollarQuote(),
      isActive: () => document.visibilityState !== 'hidden' && navigator.onLine,
      onQuote: (quote) => applyDollarQuote(quotation.id, quote),
      onState: (state) => { setRateState({ id: quotation.id, ...state }); setRateCheckedAt(Date.now()) },
    })
    function checkRate() {
      setRateCheckedAt(Date.now())
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
  }, [quotation.id])

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
        const result = saveCatalog(window.localStorage, catalog)
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
      try { setRecoveryError(saveCurrentQuotation(window.localStorage, quotation).error) }
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
        try { saveCatalog(window.localStorage, catalogRef.current) } catch { /* Preserve in-memory data when storage is unavailable. */ }
      }
      if (recoveryWriteAllowed.current) {
        try { saveCurrentQuotation(window.localStorage, quotationRef.current) } catch { /* Editing and export remain available. */ }
      }
    }
    window.addEventListener('storage', handleStorage)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('pagehide', flush)
    }
  }, [catalog, quotation])

  function addRow(section: RowSection) {
    if (quotation.rows.length >= 1000) { setMessage('Llegaste al máximo de 1000 conceptos en este presupuesto.'); return }
    const row = createRow(section)
    if (updateQuotation({ ...quotation, rows: [...quotation.rows, row] })) setEditingRowId(row.id)
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
    try { result = saveCatalog(window.localStorage, next, { overwriteInvalid: true }) }
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
      const result = saveCatalog(window.localStorage, catalog, { overwriteInvalid: true })
      setCatalogError(result.error)
      if (result.ok) {
        catalogWriteAllowed.current = true
        setCatalogStorageEnabled(true)
        setSavedCatalog(catalog)
      }
    } catch { setCatalogError('No se pudo habilitar el guardado del catálogo. Conservá un respaldo.') }
  }

  async function prepareImage() {
    if (!calculation.canExport) { setMessage('Completá los conceptos, precios y la cotización del dólar antes de preparar la imagen.'); return }
    const request = ++generation.current
    setPreparing(true)
    setMessage('Preparando imagen…')
    try {
      const file = await createQuotationFile(quotation)
      if (request === generation.current) {
        setPrepared({ file, quotation })
        setMessage('Imagen lista. Podés descargarla o compartirla y seguir ajustando el presupuesto.')
      }
    } catch (error) {
      if (request === generation.current) setMessage(error instanceof Error ? error.message : 'No se pudo preparar la imagen. Intentá otra vez.')
    } finally {
      if (request === generation.current) setPreparing(false)
    }
  }

  async function shareImage() {
    if (!preparedFile || sharing) return
    const request = generation.current
    setSharing(true)
    try {
      const result = await shareQuotationFile(preparedFile, navigator)
      if (request !== generation.current) return
      if (result === 'unsupported') {
        downloadQuotationFile(preparedFile)
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
            onEditRow={setEditingRowId}
            onAddRow={addRow}
            notices={<>
              {recoveryError && <p className="notice error" role="alert">{recoveryError}</p>}
              {catalogError && <div className="notice error" role="status"><p>El catálogo tiene un problema de guardado. Podés seguir armando este presupuesto.</p><button ref={catalogButton} className="button secondary" type="button" onClick={() => setDialog('catalog')}>Revisar catálogo</button></div>}
              {sharedCatalogStatus === 'error' && <div className="notice error" role="status"><p>No se pudo actualizar el catálogo compartido. Podés seguir usando tus opciones.</p><button className="button secondary" type="button" onClick={retrySharedCatalog}>Reintentar catálogo compartido</button></div>}
            </>}
            exchangeDetails={<>
              <details className="exchange-panel" id="quotation-exchange-rate">
                <summary><span>Dólar del presupuesto</span><span className="exchange-summary-value">{displayedRate.ok ? displayedRate.rateLabel : rateLoading ? 'Consultando…' : 'Pendiente'}</span></summary>
                <div className="exchange-panel-details">
                  {rateLoading && <p className="field-help" role="status">Consultando cotización…</p>}
                </div>
              </details>
              {quotation.exchangeRateQuote && rateCheckedAt - Date.parse(quotation.exchangeRateQuote.updatedAt) > 24 * 60 * 60 * 1000 && <p className="exchange-warning">Cotización anterior: revisá la fecha antes de compartir.</p>}
              {rateError && <p className="exchange-warning" role="alert">{rateError}</p>}
            </>}
          />
        </div>
        {!calculation.canExport && <details className="notice pending"><summary>Datos pendientes para preparar la imagen ({calculation.issues.length})</summary><ul>{calculation.issues.map((issue, index) => <li key={String(index) + '-' + issue}>{issue}</li>)}</ul>{!calculation.conversion.ok && <a className="button secondary" href="#quotation-exchange-rate">Revisar cotización del dólar</a>}</details>}
        <p className="current-quotation-note">Se recupera solo el presupuesto en curso al recargar.</p>
      </main>
      <footer className="export-bar">
        <p className={message ? 'export-message' : 'sr-only'} role="status" aria-live="polite">{message || (!calculation.canExport ? 'Completá los datos pendientes para preparar la imagen.' : '')}</p>
        <div className="export-actions">{preparedFile ? <><button className="button secondary" type="button" onClick={() => downloadQuotationFile(preparedFile)}>Descargar PNG</button><button className="button primary" disabled={sharing} type="button" onClick={() => { void shareImage() }}>{sharing ? 'Abriendo…' : 'Compartir imagen'}</button></> : <button className="button primary" disabled={preparing || !calculation.canExport} type="button" onClick={() => { void prepareImage() }}>{preparing ? 'Preparando…' : 'Preparar imagen'}</button>}</div>
      </footer>
      {dialog === 'header' && <HeaderEditor quotation={quotation} onClose={() => setDialog(null)} onSave={(next) => { if (updateQuotation(next)) setDialog(null) }} />}
      {dialog === 'catalog' && <CatalogEditor catalog={catalog} saveStatus={catalogSaveStatus} saveError={catalogError} sharedCatalogStatus={sharedCatalogStatus} onRetrySharedCatalog={retrySharedCatalog} onExportBackup={exportCatalogBackup} onImportBackup={importCatalogBackup} onEnableStorage={!catalogStorageEnabled ? enableCatalogStorage : undefined} onClose={closeCatalog} onSave={updateCatalog} />}
      {editingRow && <RowEditor key={editingRow.id} row={editingRow} quotation={quotation} catalog={catalog} onClose={() => setEditingRowId(null)} onSave={(row) => { if (updateQuotation({ ...quotation, rows: quotation.rows.map((entry) => entry.id === row.id ? row : entry) })) setEditingRowId(null) }} onRemove={() => { if (updateQuotation({ ...quotation, rows: quotation.rows.filter((entry) => entry.id !== editingRow.id) })) setEditingRowId(null) }} />}
    </div>
  )
}
