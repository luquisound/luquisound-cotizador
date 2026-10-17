import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { parseMoney } from './calculation.ts'
import {
  applyCatalogImport, buildCatalogImportPreview, CATALOG_IMPORT_MAX_BYTES, CATALOG_IMPORT_MAX_ITEMS,
  getCatalogCategories, getCatalogChoices, parseCatalogImport, queryCatalog,
} from './catalog.ts'
import type { CatalogCategoryOption, CatalogImportDocument, CatalogImportPreview, CatalogReferencePrice, CatalogSource } from './catalog.ts'
import type { CatalogItem, Currency, RowSection } from './model.ts'
import { Dialog } from './QuotationDialog.tsx'
import './catalog-ui.css'

const PAGE_SIZE = 25
const PICKER_LIMIT = 20
const roleLabels: Record<CatalogReferencePrice['role'], string> = {
  cost: 'Costo', list: 'Precio de lista', sale: 'Venta histórica', unknown: 'Rol no identificado',
}

function emptyItem(): CatalogItem {
  return { id: crypto.randomUUID(), concept: '', detail: '', section: 'equipment', currency: 'ARS', unitPrice: '' }
}

function editableSignature(item: CatalogItem): string {
  return JSON.stringify([
    item.concept, item.detail, item.section, item.currency, item.unitPrice,
    item.supplier ?? '', item.sku ?? '', item.brand ?? '', item.category ?? '', item.unit ?? '', item.presentation ?? '',
  ])
}

function sourceLabel(source: CatalogSource): string {
  const parts = [source.document]
  if (source.page !== undefined) parts.push(`página ${source.page}`)
  if (source.sheet) parts.push(`hoja ${source.sheet}`)
  if (source.row !== undefined) parts.push(`fila ${source.row}`)
  if (source.date !== null) parts.push(`fecha ${source.date}`)
  return parts.join(' · ')
}

function referenceAmount(price: CatalogReferencePrice): string {
  if (price.amount === null) return 'Importe no indicado'
  const [whole, fraction] = price.amount.split('.')
  const value = `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${fraction === undefined ? '' : `,${fraction}`}`
  return `${price.currency ?? 'Moneda no identificada'} ${value}`
}

function referenceInput(price: CatalogReferencePrice, currency: Currency): string | null {
  if (price.currency !== currency || price.amount === null || (price.role !== 'list' && price.role !== 'sale')) return null
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(price.amount)) return null
  const input = price.amount.replace('.', ',')
  return parseMoney(input).ok ? input : null
}

function referenceUnavailableReason(price: CatalogReferencePrice, currency: Currency): string {
  if (price.amount === null) return 'Esta referencia no indica un importe.'
  if (price.role === 'cost' || price.role === 'unknown') return 'El costo o un rol no identificado no se toma como venta. Cargá el precio de venta manualmente.'
  if (price.currency === null) return 'La moneda no está identificada. Cargá el precio de venta manualmente.'
  if (price.currency !== currency) return `La referencia está en ${price.currency}. Cargá un precio de venta en ${currency}; no se convierte automáticamente.`
  return 'Este importe requiere revisión manual: admite hasta dos decimales y debe estar dentro del límite de cálculo.'
}

function confirmReference(item: CatalogItem, price: CatalogReferencePrice, currency: Currency): string | null {
  const input = referenceInput(price, currency)
  if (input === null) return null
  const confirmed = window.confirm([
    `Usar ${referenceAmount(price)} como precio de venta de «${item.concept}».`,
    `${roleLabels[price.role]} · Referencia histórica · Fecha: ${price.date ?? 'no indicada'}.`,
    'No es un precio vigente aprobado. El valor seguirá editable y reemplazará el precio que estés cargando. ¿Continuar?',
  ].join('\n'))
  return confirmed ? input : null
}

interface HistoricalReferencesProps {
  item: CatalogItem
  currency: Currency
  onUse: (unitPrice: string) => void
}

function HistoricalReferences({ item, currency, onUse }: HistoricalReferencesProps) {
  const [open, setOpen] = useState(false)
  const references = item.referencePrices ?? []
  if (references.length === 0) return null
  return (
    <details className="catalog-metadata" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Referencias históricas ({references.length})</summary>
      {open && <>
        <p className="field-help">Información privada de consulta. Ningún importe se usa como venta sin tu confirmación.</p>
        <ul className="catalog-reference-list">
          {references.map((price, index) => {
            const input = referenceInput(price, currency)
            return (
              <li className="catalog-reference" key={index}>
                <strong className="catalog-reference-heading">{roleLabels[price.role]} · Histórica</strong>
                <span className="catalog-reference-value">{referenceAmount(price)}</span>
                <p className="catalog-reference-note">Fecha del precio: {price.date ?? 'no indicada'}</p>
                <p className="catalog-provenance">{price.source ? sourceLabel(price.source) : 'Procedencia de esta referencia no indicada.'}</p>
                <div className="catalog-reference-action">
                  {input === null
                    ? <p className="catalog-reference-note">{referenceUnavailableReason(price, currency)}</p>
                    : <button type="button" className="button secondary" onClick={() => {
                      const confirmedInput = confirmReference(item, price, currency)
                      if (confirmedInput !== null) onUse(confirmedInput)
                    }}>Usar referencia como precio</button>}
                </div>
              </li>
            )
          })}
        </ul>
      </>}
    </details>
  )
}

interface CatalogCategorySelectProps {
  label: string
  options: CatalogCategoryOption[]
  value: string
  onChange: (value: string) => void
}

function CatalogCategorySelect({ label, options, value, onChange }: CatalogCategorySelectProps) {
  return (
    <label className="catalog-search">{label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Todas</option>
        {options.map((option) => <option key={option.key} value={option.key}>
          {option.key === 'uncategorized' ? 'Sin clasificar'
            : `${option.label}${option.key === 'category:sin clasificar' || option.key === 'category:todas' ? ' (categoría)' : ''}`}
        </option>)}
      </select>
    </label>
  )
}

interface CatalogPickerProps {
  catalog: CatalogItem[]
  currency: Currency
  section: RowSection
  onChoose: (item: CatalogItem) => void
}

export function CatalogPicker({ catalog, currency, section, onChoose }: CatalogPickerProps) {
  const [query, setQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const deferredQuery = useDeferredValue(query)
  const searchId = useId()
  const available = useMemo(() => getCatalogChoices(catalog, currency, section), [catalog, currency, section])
  const categories = useMemo(() => getCatalogCategories(available), [available])
  const category = categories.some((option) => option.key === selectedCategory) ? selectedCategory : ''
  const results = useMemo(() => queryCatalog(available, deferredQuery, category), [available, deferredQuery, category])
  return (
    <fieldset className="catalog-picker">
      <legend>Elegir del catálogo <span>(opcional)</span></legend>
      <details className="catalog-picker-search">
        <summary>Buscar en el catálogo ({available.length} opciones)</summary>
      <div className="catalog-filters">
        <label className="catalog-search" htmlFor={searchId}>Buscar por código, marca o nombre
          <input id={searchId} type="search" autoComplete="off" maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar una opción" />
        </label>
        <CatalogCategorySelect label="Filtrar productos por categoría" options={categories} value={category} onChange={setSelectedCategory} />
      </div>
      <p className="field-help">Podés escribir manualmente o dejar el campo vacío. Elegir un producto conserva su precio de venta; las referencias se revisan por separado.</p>
      <p className="catalog-count" aria-live="polite">{results.length === 0
        ? 'No hay coincidencias para esta búsqueda y moneda.'
        : `${results.length} coincidencias${results.length > PICKER_LIMIT ? ` · Se muestran las primeras ${PICKER_LIMIT}; afiná la búsqueda.` : ''}`}</p>
      <ul className="catalog-picker-results" aria-busy={query !== deferredQuery}>
        {results.slice(0, PICKER_LIMIT).map((item) => (
          <li className="catalog-picker-card" key={item.id}>
            <button type="button" className="catalog-picker-choice" onClick={() => onChoose(item)}>
              <strong className="catalog-item-name">{item.concept}</strong>
              {(item.sku || item.brand || item.supplier) && <span className="catalog-item-meta">{[item.sku, item.brand, item.supplier].filter(Boolean).join(' · ')}</span>}
              <span className="catalog-item-price">{item.unitPrice.trim() ? `Venta: ${item.currency} ${item.unitPrice}` : 'Precio de venta pendiente'}</span>
              <span className="catalog-item-meta">Usar producto</span>
            </button>
            <HistoricalReferences item={item} currency={currency} onUse={(unitPrice) => onChoose({ ...item, unitPrice, currency })} />
          </li>
        ))}
      </ul>
      </details>
    </fieldset>
  )
}

interface CatalogEditorProps {
  catalog: CatalogItem[]
  saveStatus: string
  saveError: string | null
  sharedCatalogStatus: 'loading' | 'ready' | 'unavailable' | 'error'
  onRetrySharedCatalog: () => void
  onExportBackup: () => void
  onImportBackup: (file: File, signal?: AbortSignal) => Promise<boolean>
  onEnableStorage?: () => void
  onSave: (catalog: CatalogItem[]) => boolean
  onClose: () => void
}

export function CatalogEditor({
  catalog, saveStatus, saveError, sharedCatalogStatus, onRetrySharedCatalog,
  onExportBackup, onImportBackup, onEnableStorage, onSave, onClose,
}: CatalogEditorProps) {
  const [draft, setDraft] = useState<CatalogItem>(emptyItem)
  const [baseline, setBaseline] = useState(() => editableSignature(draft))
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [query, setQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [page, setPage] = useState({ index: 0, category: '' })
  const [reading, setReading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [backupError, setBackupError] = useState('')
  const [importError, setImportError] = useState('')
  const [importDocument, setImportDocument] = useState<CatalogImportDocument | null>(null)
  const [preview, setPreview] = useState<CatalogImportPreview | null>(null)
  const [fileName, setFileName] = useState('')
  const [allowUpdates, setAllowUpdates] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const readToken = useRef(0)
  const backupController = useRef<AbortController | null>(null)
  const searchId = useId()
  const deferredQuery = useDeferredValue(query)
  const categories = useMemo(() => getCatalogCategories(catalog), [catalog])
  const category = categories.some((option) => option.key === selectedCategory) ? selectedCategory : ''
  const results = useMemo(() => queryCatalog(catalog, deferredQuery, category), [catalog, deferredQuery, category])
  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE))
  const visiblePage = page.category === category ? Math.min(page.index, pageCount - 1) : 0
  const editingExisting = catalog.some((item) => item.id === draft.id)
  const dirty = editableSignature(draft) !== baseline
  useEffect(() => () => {
    readToken.current += 1
    backupController.current?.abort()
  }, [])

  function cancelRead(): void {
    readToken.current += 1
    backupController.current?.abort()
    backupController.current = null
    setReading(false)
  }

  function resetDraft(item: CatalogItem = emptyItem()): void {
    const next = structuredClone(item)
    setDraft(next)
    setBaseline(editableSignature(next))
    setError('')
  }

  function resetMissingCategory(nextCatalog: CatalogItem[]): void {
    if (selectedCategory && !getCatalogCategories(nextCatalog).some((option) => option.key === selectedCategory)) {
      setSelectedCategory('')
      setPage({ index: 0, category: '' })
    }
  }

  function discardDraftChanges(): boolean {
    return !dirty || window.confirm('Tenés cambios sin guardar en esta opción. ¿Descartarlos?')
  }

  function close(): void {
    if (!discardDraftChanges()) return
    cancelRead()
    onClose()
  }

  function clearPreview(): void {
    setPreview(null)
    setImportDocument(null)
    setAllowUpdates(false)
    setImportError('')
    setFileName('')
  }

  async function readImport(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    cancelRead()
    const token = ++readToken.current
    clearPreview()
    setFeedback('')
    if (file.size > CATALOG_IMPORT_MAX_BYTES) {
      setImportError('El catálogo supera el límite de 5 MB.')
      return
    }
    setReading(true)
    let content: string
    try {
      content = await file.text()
    } catch {
      if (token === readToken.current) {
        setImportError('No se pudo leer el archivo. Volvé a elegir un JSON de catálogo.')
        setReading(false)
      }
      return
    }
    if (token !== readToken.current) return
    try {
      const parsed = parseCatalogImport(content)
      setImportDocument(parsed)
      setPreview(buildCatalogImportPreview(catalog, parsed))
      setFileName(file.name)
    } catch (cause: unknown) {
      setImportError(cause instanceof Error ? cause.message : 'No se pudo revisar este catálogo.')
    } finally {
      setReading(false)
    }
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !discardDraftChanges()) return
    cancelRead()
    const token = ++readToken.current
    const controller = new AbortController()
    backupController.current = controller
    setRestoring(true)
    setBackupError('')
    setFeedback('')
    try {
      const restored = await onImportBackup(file, controller.signal)
      if (token !== readToken.current || controller.signal.aborted || !restored) return
      resetDraft()
      clearPreview()
      setSelectedCategory('')
      setPage({ index: 0, category: '' })
      setFeedback('Respaldo restaurado. El catálogo y sus precios de venta fueron reemplazados; el presupuesto en curso se conserva.')
    } catch (cause: unknown) {
      if (token === readToken.current && !controller.signal.aborted) {
        setBackupError(cause instanceof Error ? cause.message : 'No se pudo restaurar el respaldo. El catálogo se conserva.')
      }
    } finally {
      if (token === readToken.current) {
        backupController.current = null
        setRestoring(false)
      }
    }
  }

  function refreshPreview(): void {
    if (!importDocument) return
    try {
      setPreview(buildCatalogImportPreview(catalog, importDocument))
      setImportError('')
    } catch {
      setImportError('No se pudo actualizar la vista previa. Volvé a elegir el archivo.')
    }
  }

  function importCatalog(): void {
    if (!preview) return
    const updates = allowUpdates ? preview.updates.length : 0
    const confirmation = [
      `Importar ${preview.additions.length} opciones nuevas y actualizar ${updates}.`,
      'Se conservan los presupuestos, los precios de venta ya cargados y las opciones que no figuran en el archivo.',
      dirty ? 'Los cambios sin guardar de la opción abierta se descartarán.' : '',
      preview.conflicts.length ? 'Los registros con conflicto se omiten.' : '',
      '¿Continuar?',
    ].filter(Boolean).join('\n')
    if (!window.confirm(confirmation)) return
    try {
      const next = applyCatalogImport(catalog, preview, { allowUpdates })
      if (!onSave(next)) {
        setImportError('No se guardó la importación. Revisá el aviso de guardado y conservá el archivo para volver a intentar.')
        return
      }
      resetMissingCategory(next)
      setFeedback(`Importación aplicada al espacio actual: ${preview.additions.length} nuevas y ${updates} actualizadas. Los precios históricos siguen como referencias.`)
      clearPreview()
      resetDraft()
    } catch (cause: unknown) {
      setImportError(cause instanceof Error ? cause.message : 'No se pudo aplicar la importación. El catálogo se conserva.')
    }
  }

  function saveItem(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!draft.concept.trim()) {
      setError('Escribí un concepto para guardar esta opción.')
      inputRef.current?.focus()
      return
    }
    if (!editingExisting && catalog.length >= CATALOG_IMPORT_MAX_ITEMS) {
      setError('El catálogo admite hasta 2000 opciones. Eliminá una antes de agregar otra.')
      return
    }
    if (draft.unitPrice.trim() && !parseMoney(draft.unitPrice).ok) {
      setError('Revisá el precio de venta. Usá cero o un importe positivo y coma para decimales.')
      return
    }
    const normalizeKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
    const supplier = normalizeKey(draft.supplier ?? '')
    const sku = normalizeKey(draft.sku ?? '')
    if (supplier && sku && catalog.some((item) => item.id !== draft.id
      && normalizeKey(item.supplier ?? '') === supplier && normalizeKey(item.sku ?? '') === sku)) {
      setError('Ya existe otra opción con ese proveedor y código. Buscala para editarla o revisá la identificación.')
      return
    }
    const nextItem = { ...draft, concept: draft.concept.trim(), detail: draft.detail.trim(), unitPrice: draft.unitPrice.trim() }
    const next = editingExisting
      ? catalog.map((item) => item.id === draft.id ? nextItem : item)
      : [...catalog, nextItem]
    if (!onSave(next)) {
      setError('No se guardó la opción. Revisá el aviso de guardado y volvé a intentar sin cerrar este formulario.')
      return
    }
    resetMissingCategory(next)
    setFeedback(editingExisting ? 'Opción actualizada. El presupuesto en curso se conserva.' : 'Opción agregada al catálogo.')
    resetDraft()
    clearPreview()
  }

  function removeItem(item: CatalogItem): void {
    if (!window.confirm('¿Eliminar esta opción del catálogo? El presupuesto en curso se conserva.')) return
    const next = catalog.filter((entry) => entry.id !== item.id)
    if (!onSave(next)) {
      setError('No se pudo guardar la eliminación. La opción se conserva.')
      return
    }
    resetMissingCategory(next)
    if (draft.id === item.id) resetDraft()
    setFeedback('Opción quitada del catálogo. El presupuesto en curso se conserva.')
    clearPreview()
  }

  function changeCurrency(value: Currency): void {
    if (value !== draft.currency && draft.unitPrice.trim() && !window.confirm('Cambiar la moneda no convierte el precio de venta. El mismo importe quedará expresado en la nueva moneda. ¿Continuar?')) return
    setDraft({ ...draft, currency: value })
  }

  const resultStart = visiblePage * PAGE_SIZE
  const tooMany = preview !== null && catalog.length + preview.additions.length > CATALOG_IMPORT_MAX_ITEMS
  const hasImportChanges = preview !== null && (preview.additions.length > 0 || (allowUpdates && preview.updates.length > 0))

  return (
    <Dialog title="Mi catálogo" onClose={close}>
      <div className="catalog-tools">
        <p className="field-help">Opciones privadas de este navegador. Cambiar o eliminar una opción no modifica el presupuesto en curso. Siempre podés escribir un concepto manualmente.</p>
        <div>
          <p className="catalog-count" role="status">{sharedCatalogStatus === 'loading' ? 'Cargando catálogo compartido…'
            : sharedCatalogStatus === 'ready' ? 'Catálogo compartido disponible.'
              : sharedCatalogStatus === 'unavailable' ? 'Catálogo compartido no disponible. Podés usar tus opciones o escribir manualmente.'
                : 'No se pudo actualizar el catálogo compartido. Tus opciones y precios se conservan.'}</p>
          {(sharedCatalogStatus === 'error' || sharedCatalogStatus === 'unavailable') && <button type="button" className="button secondary" disabled={restoring} onClick={onRetrySharedCatalog}>Reintentar catálogo compartido</button>}
        </div>
        <p className="catalog-count" role="status">{saveStatus}</p>
        {saveError && <div>
          <p className="field-errors" role="alert">{saveError} Podés descargar un respaldo del catálogo para conservar tus opciones y precios.</p>
          {onEnableStorage && <button type="button" className="button secondary" disabled={restoring} onClick={onEnableStorage}>Habilitar guardado del catálogo</button>}
        </div>}
        {feedback && <p className="catalog-feedback" role="status">{feedback}</p>}
        {restoring && <p className="field-help" role="status">Revisando el respaldo del catálogo…</p>}
        <fieldset className="catalog-tools catalog-controls" disabled={restoring}>
        <details className="catalog-metadata">
          <summary>Respaldos del catálogo</summary>
          <div className="form-stack">
            <p className="field-help">Conservá tus opciones y precios de venta en un archivo. El respaldo no incluye presupuestos.</p>
            <button type="button" className="button secondary" onClick={onExportBackup}>Descargar respaldo del catálogo</button>
            <p className="field-help">Restaurar reemplaza el catálogo y sus precios después de tu confirmación. El presupuesto en curso se conserva. Para combinar opciones de un archivo fuente, usá «Importar catálogo privado».</p>
            <label className="catalog-search">Restaurar respaldo del catálogo
              <input type="file" accept=".json,application/json" onChange={restoreBackup} />
            </label>
            {backupError && <p className="field-errors" role="alert">{backupError}</p>}
          </div>
        </details>
        <section className="catalog-import" aria-label="Importar catálogo privado">
          <h3>Importar catálogo privado</h3>
          <p className="field-help">Elegí un JSON de Luquisound. Se procesa en este navegador; el presupuesto en curso se conserva y ningún precio histórico se carga como venta.</p>
          <label className="catalog-search">Archivo JSON privado
            <input type="file" accept=".json,application/json" disabled={reading} onChange={readImport} />
          </label>
          {reading && <p role="status" className="field-help">Revisando el archivo…</p>}
          {importError && <p className="field-errors" role="alert">{importError}</p>}
          {preview && <section className="catalog-preview" aria-label="Vista previa de importación">
            <h4>Revisá antes de importar</h4>
            <p className="catalog-provenance">{fileName}</p>
            <dl className="catalog-preview-summary">
              <div><dt>Recibidas</dt><dd>{preview.summary.received}</dd></div>
              <div><dt>Nuevas</dt><dd>{preview.summary.additions}</dd></div>
              <div><dt>Actualizaciones</dt><dd>{preview.summary.updates}</dd></div>
              <div><dt>Sin cambios</dt><dd>{preview.summary.unchanged}</dd></div>
              <div><dt>Conflictos</dt><dd>{preview.summary.conflicts}</dd></div>
              <div><dt>Repetidas</dt><dd>{preview.summary.duplicateRows}</dd></div>
            </dl>
            {preview.summary.withoutKey > 0 && <p className="notice">{preview.summary.withoutKey} registros no tienen proveedor y código completos. Se agregan sin actualizar coincidencias; volver a importarlos puede duplicarlos.</p>}
            {preview.conflicts.length > 0 && <>
              <p className="field-help">Los conflictos se omiten. Podés importar los registros sin conflicto.</p>
              <ul className="catalog-preview-conflicts">{preview.conflicts.slice(0, 5).map((conflict, index) => <li key={index}>Registro {conflict.itemIndexes.map((itemIndex) => itemIndex + 1).join(', ')}: {conflict.message}</li>)}</ul>
              {preview.conflicts.length > 5 && <p className="field-help">Hay {preview.conflicts.length - 5} conflictos adicionales para revisar en el archivo.</p>}
            </>}
            {preview.updates.length > 0 && <label className="catalog-confirm-updates">
              <input type="checkbox" checked={allowUpdates} onChange={(event) => setAllowUpdates(event.target.checked)} />
              <span>Confirmo actualizar las {preview.updates.length} opciones coincidentes. Se conservan sus precios de venta y referencias anteriores.</span>
            </label>}
            {tooMany && <p className="field-errors" role="alert">La importación superaría las 2000 opciones. El catálogo se conserva; revisá el archivo antes de continuar.</p>}
            {!hasImportChanges && <p className="field-help">{preview.updates.length > 0 ? 'Marcá la confirmación para aplicar las actualizaciones.' : 'No hay cambios nuevos para importar.'}</p>}
            <div className="dialog-actions">
              <button type="button" className="button secondary" onClick={clearPreview}>Cancelar importación</button>
              <button type="button" className="button secondary" onClick={refreshPreview}>Actualizar vista previa</button>
              <button type="button" className="button primary" disabled={!hasImportChanges || tooMany} onClick={importCatalog}>Confirmar importación</button>
            </div>
          </section>}
        </section>
        <section aria-label="Opciones del catálogo">
          <div className="catalog-manager-heading">
            <h3>Mis opciones</h3>
            <button type="button" className="button secondary" onClick={() => {
              if (!discardDraftChanges()) return
              resetDraft()
              setFeedback('')
              inputRef.current?.focus()
            }}>Crear opción manual</button>
          </div>
          <div className="catalog-filters">
            <label className="catalog-search" htmlFor={searchId}>Buscar en mi catálogo
              <input id={searchId} type="search" autoComplete="off" maxLength={200} value={query} onChange={(event) => { setQuery(event.target.value); setPage({ index: 0, category }) }} placeholder="Código, marca, nombre o proveedor" />
            </label>
            <CatalogCategorySelect label="Filtrar catálogo por categoría" options={categories} value={category} onChange={(value) => {
              setSelectedCategory(value)
              setPage({ index: 0, category: value })
            }} />
          </div>
          <p className="catalog-count" aria-live="polite">{results.length} de {catalog.length} opciones{results.length ? ` · Mostrando ${resultStart + 1}–${Math.min(resultStart + PAGE_SIZE, results.length)}` : ''}</p>
          <ul className="catalog-results" aria-busy={query !== deferredQuery}>
            {results.slice(resultStart, resultStart + PAGE_SIZE).map((item) => <li className="catalog-result" key={item.id}>
              <button type="button" className="catalog-result-main" onClick={() => {
                if (!discardDraftChanges()) return
                resetDraft(item)
                setFeedback('')
                inputRef.current?.focus()
              }}>
                <strong className="catalog-item-name">{item.concept}</strong>
                <span className="catalog-item-meta">{[item.sku, item.brand, item.supplier].filter(Boolean).join(' · ') || 'Opción manual'}</span>
                <span className="catalog-item-price">{item.unitPrice.trim() ? `Venta: ${item.currency} ${item.unitPrice}` : 'Precio de venta pendiente'}</span>
                <span className="catalog-item-meta">Editar opción</span>
              </button>
              <div className="catalog-result-actions"><button type="button" className="button danger" aria-label={`Eliminar ${item.concept} del catálogo`} onClick={() => removeItem(item)}>Eliminar</button></div>
            </li>)}
          </ul>
          {results.length === 0 && <p className="field-help">{catalog.length === 0 ? 'Todavía no agregaste opciones. Importá un catálogo o creá una opción abajo.' : 'No hay coincidencias. Probá con otro nombre o código.'}</p>}
          {pageCount > 1 && <nav className="catalog-pagination" aria-label="Páginas del catálogo">
            <button type="button" className="button secondary" disabled={visiblePage === 0} onClick={() => setPage({ index: visiblePage - 1, category })}>Anterior</button>
            <span>Página {visiblePage + 1} de {pageCount}</span>
            <button type="button" className="button secondary" disabled={visiblePage + 1 >= pageCount} onClick={() => setPage({ index: visiblePage + 1, category })}>Siguiente</button>
          </nav>}
        </section>
        <form className="form-stack catalog-edit-form" onSubmit={saveItem}>
          <h3>{editingExisting ? 'Editar opción' : 'Nueva opción'}</h3>
          <label>Concepto<input ref={inputRef} value={draft.concept} maxLength={500} onChange={(event) => setDraft({ ...draft, concept: event.target.value })} /></label>
          <label>Detalle para el cliente <span>(opcional)</span><textarea rows={2} value={draft.detail} maxLength={2000} onChange={(event) => setDraft({ ...draft, detail: event.target.value })} /></label>
          <div className="form-grid">
            <label>Sección sugerida<select value={draft.section} onChange={(event) => setDraft({ ...draft, section: event.target.value as RowSection })}><option value="equipment">Equipamiento</option><option value="extras">Instalación y accesorios</option></select></label>
            <label>Moneda del precio<select value={draft.currency} onChange={(event) => changeCurrency(event.target.value as Currency)}><option value="ARS">ARS</option><option value="USD">USD</option></select></label>
          </div>
          <label>Precio de venta unitario · {draft.currency} <span>(opcional)</span><input inputMode="decimal" placeholder="Precio pendiente" value={draft.unitPrice} maxLength={64} onChange={(event) => setDraft({ ...draft, unitPrice: event.target.value })} /></label>
          <p className="field-help">Cargá el precio de venta que quieras usar. Coma para decimales; cero es válido. Una referencia de costo o de lista no se convierte automáticamente en venta.</p>
          <details className="catalog-metadata">
            <summary>Identificación y presentación <span>(opcional)</span></summary>
            <div className="form-stack">
              <div className="form-grid">
                <label>Proveedor<input value={draft.supplier ?? ''} maxLength={200} onChange={(event) => setDraft({ ...draft, supplier: event.target.value })} /></label>
                <label>Código / SKU<input value={draft.sku ?? ''} maxLength={128} onChange={(event) => setDraft({ ...draft, sku: event.target.value })} /></label>
                <label>Marca<input value={draft.brand ?? ''} maxLength={200} onChange={(event) => setDraft({ ...draft, brand: event.target.value })} /></label>
                <label>Categoría<input value={draft.category ?? ''} maxLength={200} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label>
                <label>Unidad<input value={draft.unit ?? ''} maxLength={200} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} /></label>
                <label>Presentación<input value={draft.presentation ?? ''} maxLength={200} onChange={(event) => setDraft({ ...draft, presentation: event.target.value })} /></label>
              </div>
              {draft.source && <p className="catalog-provenance">Origen de la ficha: {sourceLabel(draft.source)}</p>}
              <p className="field-help">Identificación y procedencia son datos privados del catálogo. No se agregan al detalle para el cliente.</p>
            </div>
          </details>
          <HistoricalReferences key={draft.id} item={draft} currency={draft.currency} onUse={(unitPrice) => setDraft({ ...draft, unitPrice })} />
          {error && <p className="field-errors" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={() => { if (discardDraftChanges()) resetDraft() }}>Nueva opción</button>
            <button type="submit" className="button primary">Guardar opción</button>
          </div>
        </form>
        </fieldset>
        <div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Cerrar catálogo</button></div>
      </div>
    </Dialog>
  )
}
