import { useDeferredValue, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type Ref } from 'react'
import { parseMoney } from './calculation.ts'
import {
  applyCatalogImport, buildCatalogImportPreview, CATALOG_IMPORT_MAX_BYTES, CATALOG_IMPORT_MAX_ITEMS,
  getCatalogCategories, getCatalogChoices, getCatalogDefaultCurrency, parseCatalogImport,
} from './catalog.ts'
import type { CatalogCategoryOption, CatalogImportDocument, CatalogImportPreview, CatalogReferencePrice, CatalogSource } from './catalog.ts'
import type { CatalogItem, Currency, RowSection } from './model.ts'
import { Dialog } from './QuotationDialog.tsx'
import { buildCatalogEdit, captureCatalogEditBaseline } from './catalog-edit.ts'
import { queryCatalogRanked, resolveCatalogQuery } from './catalog-search.ts'
import { canSelectCatalogItem } from './catalog-stock.ts'
import { CatalogAvailability } from './CatalogAvailability.tsx'
import { getCatalogSelectionPrice } from './row-provenance.ts'
import { useCatalogClock } from './useCatalogClock.ts'
import { getPriceInputLengthError } from './price-input.ts'
import { changePriceCurrency, type CurrencyConversionOrigin } from './row-currency.ts'
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
  parts.push(`fecha ${source.date ?? 'no informada'}`)
  if (source.version) parts.push(`versi\u00f3n ${source.version}`)
  if (source.checksum) parts.push(`SHA-256 ${source.checksum}`)
  return parts.join(' · ')
}

function catalogPriceLabel(item: CatalogItem): string {
  try {
    const price = getCatalogSelectionPrice(item)
    if (price.priceBasis === 'pending') return 'Precio pendiente'
    const label = price.priceBasis === 'manual' ? 'Precio manual del cat\u00e1logo'
      : price.priceBasis === 'provisional-list' ? 'Lista hist\u00f3rica provisional, antes del 20%'
        : 'Lista aprobada, antes del descuento'
    return `${label}: ${price.currency} ${price.unitPrice}`
  } catch {
    return 'Precio manual inv\u00e1lido: revisalo antes de seleccionar'
  }
}

function referenceAmount(price: CatalogReferencePrice): string {
  if (price.amount === null) return 'Importe no indicado'
  const [whole, fraction] = price.amount.split('.')
  const value = `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${fraction === undefined ? '' : `,${fraction}`}`
  return `${price.currency ?? 'Moneda no identificada'} ${value}`
}

function referenceInput(price: CatalogReferencePrice, currency: Currency | undefined): string | null {
  if (price.currency === null || (currency !== undefined && price.currency !== currency)
    || price.amount === null || (price.role !== 'list' && price.role !== 'sale')) return null
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(price.amount)) return null
  const input = price.amount.replace('.', ',')
  return parseMoney(input).ok ? input : null
}

function referenceUnavailableReason(price: CatalogReferencePrice, currency: Currency | undefined): string {
  if (price.amount === null) return 'Esta referencia no indica un importe.'
  if (price.role === 'cost' || price.role === 'unknown') return 'El costo o un rol no identificado no se toma como venta. Cargá el precio de venta manualmente.'
  if (price.currency === null) return 'La moneda no está identificada. Cargá el precio de venta manualmente.'
  if (currency !== undefined && price.currency !== currency) return `La referencia está en ${price.currency}. Cargá un precio de venta en ${currency}; no se convierte automáticamente.`
  return 'Este importe requiere revisión manual: admite hasta dos decimales y debe estar dentro del límite de cálculo.'
}

function confirmReference(item: CatalogItem, price: CatalogReferencePrice, currency: Currency | undefined): string | null {
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
  allowCurrencyChange?: boolean
  disabled?: boolean
  onUse: (unitPrice: string, currency: Currency) => void
}

function HistoricalReferences({ item, currency, allowCurrencyChange = false, disabled = false, onUse }: HistoricalReferencesProps) {
  const [open, setOpen] = useState(false)
  const references = item.referencePrices ?? []
  const requiredCurrency = allowCurrencyChange ? undefined : currency
  if (references.length === 0) return null
  return (
    <details className="catalog-metadata" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Referencias históricas ({references.length})</summary>
      {open && <>
        <p className="field-help">Información privada de consulta. Ningún importe se usa como venta sin tu confirmación.</p>
        <ul className="catalog-reference-list">
          {references.map((price, index) => {
            const input = referenceInput(price, requiredCurrency)
            return (
              <li className="catalog-reference" key={index}>
                <strong className="catalog-reference-heading">{roleLabels[price.role]} · Histórica</strong>
                <span className="catalog-reference-value">{referenceAmount(price)}</span>
                <p className="catalog-reference-note">Fecha del precio: {price.date ?? 'no indicada'}</p>
                <p className="catalog-provenance">{price.source ? sourceLabel(price.source) : 'Procedencia de esta referencia no indicada.'}</p>
                <div className="catalog-reference-action">
                  {input === null
                    ? <p className="catalog-reference-note">{referenceUnavailableReason(price, requiredCurrency)}</p>
                    : <button type="button" className="button secondary" disabled={disabled} onClick={() => {
                      const confirmedInput = confirmReference(item, price, requiredCurrency)
                      if (confirmedInput !== null && price.currency !== null) onUse(confirmedInput, price.currency)
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

function useNameInput(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const field = ref.current
    if (!field) return
    let width = field.clientWidth
    const resize = () => {
      field.style.height = 'auto'
      field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`
    }
    resize()
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === width) return
      width = field.clientWidth
      resize()
    })
    observer.observe(field)
    return () => observer.disconnect()
  }, [value])
  return ref
}

interface RowProductPickerProps {
  catalog: CatalogItem[]
  section: RowSection
  value: string
  onChange: (value: string) => void
  onChoose: (item: CatalogItem) => boolean
  inputRef?: Ref<HTMLTextAreaElement>
}

export function RowProductPicker({ catalog, section, value, onChange, onChoose, inputRef }: RowProductPickerProps) {
  const [resultsOpen, setResultsOpen] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('')
  const [showUnavailable, setShowUnavailable] = useState(false)
  const [selectionError, setSelectionError] = useState('')
  const localInputRef = useNameInput(value)
  const interacted = useRef(false)
  const suppressFocus = useRef(false)
  const inputId = useId()
  const helpId = useId()
  const resultsHeadingId = useId()
  const now = useCatalogClock(catalog)
  const choices = useMemo(() => getCatalogChoices(catalog, section), [catalog, section])
  const categories = useMemo(() => getCatalogCategories(choices), [choices])
  const category = categories.some((option) => option.key === selectedCategory) ? selectedCategory : ''
  const allResults = useMemo(() => queryCatalogRanked(choices, value, category), [choices, value, category])
  const results = allResults.filter((item) => showUnavailable || canSelectCatalogItem(item, now))
  const resolution = resolveCatalogQuery(choices, value, (item) => canSelectCatalogItem(item, now))
  const exactBlocked = (resolution.matchKind === 'sku' || resolution.matchKind === 'name')
    && resolution.blockedCandidates.length > 0
  const showResults = resultsOpen && value.trim().length > 0
  useImperativeHandle(inputRef, () => localInputRef.current!, [localInputRef])

  function keepManualText(): void {
    setResultsOpen(false)
    setSelectionError('')
    suppressFocus.current = true
    localInputRef.current?.focus({ preventScroll: true })
    suppressFocus.current = false
  }

  function choose(item: CatalogItem): void {
    // Recheck the clock at the explicit action, including confirmed references.
    if (!canSelectCatalogItem(item)) {
      setSelectionError('La disponibilidad cambi\u00f3. Revis\u00e1 el stock del producto antes de agregarlo.')
      return
    }
    setSelectionError('')
    if (onChoose(item)) setResultsOpen(false)
  }

  return (
    <div className="row-product-picker" onKeyDown={(event) => {
      if (event.key === 'Escape' && showResults) {
        event.preventDefault()
        event.stopPropagation()
        keepManualText()
      }
    }}>
      <label className="row-product-field" htmlFor={inputId}>Producto
        <textarea ref={localInputRef} className="product-name-input" id={inputId} rows={2} autoFocus autoComplete="off" maxLength={500}
          value={value} placeholder="Buscar por código o nombre, o escribir manual" aria-describedby={helpId}
          onPointerDown={() => {
            interacted.current = true
            if (value.trim()) setResultsOpen(true)
          }} onFocus={() => {
            // Automatic initial focus must not open an unrequested catalogue list.
            if (interacted.current && !suppressFocus.current && value.trim()) setResultsOpen(true)
          }} onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && value.trim()
              && event.currentTarget.selectionStart === value.length && event.currentTarget.selectionEnd === value.length) {
              event.preventDefault()
              interacted.current = true
              setResultsOpen(true)
            }
          }} onChange={(event) => {
            interacted.current = true
            onChange(event.target.value)
            setResultsOpen(event.target.value.trim().length > 0)
            setSelectionError('')
          }} />
      </label>
      <p id={helpId} className="field-help row-product-help">Escribí libremente o elegí una sugerencia.</p>
      {showResults && <section className="row-product-results" aria-labelledby={resultsHeadingId}>
        <h3 className="row-product-heading" id={resultsHeadingId}>Resultados del catálogo</h3>
        <button type="button" className="button secondary row-product-manual" disabled={!resolution.manualAllowed} onClick={keepManualText}>Usar texto manual</button>
        <details className="row-product-options">
          <summary>Filtrar catálogo</summary>
          <div className="catalog-filters">
            <CatalogCategorySelect label="Categoría del catálogo" options={categories} value={category} onChange={setSelectedCategory} />
            <label className="catalog-confirm-updates"><input type="checkbox" checked={showUnavailable} onChange={(event) => setShowUnavailable(event.target.checked)} /><span>Mostrar no habilitados</span></label>
          </div>
        </details>
        {!showUnavailable && exactBlocked && <p className="notice pending" role="status">Hay una coincidencia exacta no habilitada. Activá Mostrar no habilitados para revisarla.</p>}
        {selectionError && <p className="field-errors" role="alert">{selectionError}</p>}
        <p className="catalog-count" aria-live="polite">{results.length === 0
          ? 'No hay coincidencias habilitadas para esta b\u00fasqueda.'
          : `${results.length} coincidencias${results.length > PICKER_LIMIT ? ` \u00b7 Se muestran las primeras ${PICKER_LIMIT}; afin\u00e1 la b\u00fasqueda.` : ''}`}</p>
        <ul className="catalog-picker-results">
          {results.slice(0, PICKER_LIMIT).map((item) => {
            const selectable = canSelectCatalogItem(item, now)
            return <li className="catalog-picker-card" key={item.id}>
              <button type="button" className="catalog-picker-choice" disabled={!selectable} onClick={() => choose(item)}>
                <strong className="catalog-item-name">{item.concept}</strong>
                {(item.sku || item.brand || item.supplier) && <span className="catalog-item-meta">{[item.sku, item.brand, item.supplier].filter(Boolean).join(' \u00b7 ')}</span>}
                <span className="catalog-item-price">{catalogPriceLabel(item)}</span>
                <CatalogAvailability item={item} now={now} />
                <span className="catalog-item-meta">{selectable ? 'Usar producto' : 'No habilitado para agregar'}</span>
              </button>
              <HistoricalReferences item={item} currency={getCatalogDefaultCurrency(item)} allowCurrencyChange disabled={!selectable} onUse={(unitPrice, currency) => choose({ ...item, unitPrice, currency })} />
            </li>
          })}
        </ul>
      </section>}
    </div>
  )
}

interface CatalogEditorProps {
  catalog: CatalogItem[]
  exchangeRate?: string
  saveStatus: string
  saveError: string | null
  sharedCatalogStatus: 'loading' | 'ready' | 'unavailable' | 'error'
  onExportBackup: () => void
  onImportBackup: (file: File, signal?: AbortSignal) => Promise<boolean>
  onEnableStorage?: () => void
  onSave: (catalog: CatalogItem[]) => boolean
  onClose: () => void
}

export function CatalogEditor({
  catalog, exchangeRate, saveStatus, saveError, sharedCatalogStatus,
  onExportBackup, onImportBackup, onEnableStorage, onSave, onClose,
}: CatalogEditorProps) {
  const [draft, setDraft] = useState<CatalogItem>(emptyItem)
  const [baseline, setBaseline] = useState(() => editableSignature(draft))
  const [editBaseline, setEditBaseline] = useState(() => captureCatalogEditBaseline(draft, false))
  const [error, setError] = useState('')
  const [currencyError, setCurrencyError] = useState('')
  const currencyOrigin = useRef<CurrencyConversionOrigin | undefined>(undefined)
  const [feedback, setFeedback] = useState('')
  const [query, setQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [showUnavailable, setShowUnavailable] = useState(false)
  const [page, setPage] = useState({ index: 0, category: '' })
  const [reading, setReading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [backupError, setBackupError] = useState('')
  const [importError, setImportError] = useState('')
  const [importDocument, setImportDocument] = useState<CatalogImportDocument | null>(null)
  const [preview, setPreview] = useState<CatalogImportPreview | null>(null)
  const [fileName, setFileName] = useState('')
  const [allowUpdates, setAllowUpdates] = useState(false)
  const inputRef = useNameInput(draft.concept)
  const readToken = useRef(0)
  const backupController = useRef<AbortController | null>(null)
  const searchId = useId()
  const priceErrorId = useId()
  const currencyErrorId = useId()
  const [rejectedPriceError, setRejectedPriceError] = useState<string | null>(null)
  const priceLengthError = rejectedPriceError ?? getPriceInputLengthError(draft.unitPrice)
  const deferredQuery = useDeferredValue(query)
  const now = useCatalogClock(catalog)
  const categories = useMemo(() => getCatalogCategories(catalog), [catalog])
  const category = categories.some((option) => option.key === selectedCategory) ? selectedCategory : ''
  const allResults = useMemo(() => queryCatalogRanked(catalog, deferredQuery, category), [catalog, deferredQuery, category])
  const results = allResults.filter((item) => showUnavailable || canSelectCatalogItem(item, now))
  const resolution = resolveCatalogQuery(catalog, deferredQuery, (item) => canSelectCatalogItem(item, now))
  const exactBlocked = resolution.matchKind === 'sku' || resolution.matchKind === 'name' ? resolution.blockedCandidates : []
  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE))
  const visiblePage = page.category === category ? Math.min(page.index, pageCount - 1) : 0
  const editingExisting = editBaseline.snapshot !== null
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
    setEditBaseline(captureCatalogEditBaseline(next, catalog.some((entry) => entry.id === next.id)))
    setError('')
    setCurrencyError('')
    currencyOrigin.current = undefined
    setRejectedPriceError(null)
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
    const applyUpdates = preview.replacesSources || allowUpdates
    const updates = applyUpdates ? preview.updates.length : 0
    const confirmation = [
      `Importar ${preview.additions.length} opciones nuevas y actualizar ${updates}.${preview.replacesSources ? ` Se retirarán ${preview.removals.length} opciones de las fuentes reemplazadas.` : ''}`,
      preview.replacesSources
        ? 'Se conservan las opciones manuales, el presupuesto en curso y los precios de venta de los productos que siguen en el catálogo.'
        : 'Se conservan el presupuesto en curso, los precios de venta ya cargados y las opciones que no figuran en el archivo.',
      dirty ? 'Los cambios sin guardar de la opción abierta se descartarán.' : '',
      !preview.replacesSources && preview.conflicts.length ? 'Los registros con conflicto se omiten.' : '',
      '¿Continuar?',
    ].filter(Boolean).join('\n')
    if (!window.confirm(confirmation)) return
    try {
      const next = applyCatalogImport(catalog, preview, { allowUpdates: applyUpdates })
      if (!onSave(next)) {
        setImportError('No se guardó la importación. Revisá el aviso de guardado y conservá el archivo para volver a intentar.')
        return
      }
      resetMissingCategory(next)
      setFeedback(`Importación aplicada al espacio actual: ${preview.additions.length} nuevas y ${updates} actualizadas.${preview.replacesSources ? ` ${preview.removals.length} retiradas de las fuentes reemplazadas.` : ''} Las referencias sin aprobar siguen como consulta; una lista aprobada se copia al seleccionar. El presupuesto en curso se conserva.`)
      clearPreview()
      resetDraft()
    } catch (cause: unknown) {
      setImportError(cause instanceof Error ? cause.message : 'No se pudo aplicar la importación. El catálogo se conserva.')
    }
  }

  function saveItem(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (getPriceInputLengthError(draft.unitPrice)) return
    let next: CatalogItem[]
    try {
      next = buildCatalogEdit(catalog, draft, editBaseline)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'No se pudo revisar la opción. Tus cambios siguen en el formulario.')
      if (!draft.concept.trim()) inputRef.current?.focus()
      return
    }
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
    if (value === draft.currency) return
    try {
      const converted = changePriceCurrency({ currency: draft.currency, unitPrice: draft.unitPrice, conversionOrigin: currencyOrigin.current }, value, exchangeRate)
      currencyOrigin.current = converted.conversionOrigin
      setDraft({ ...draft, currency: converted.currency, unitPrice: converted.unitPrice })
      setCurrencyError('')
      setRejectedPriceError(null)
    } catch (cause: unknown) {
      setCurrencyError(cause instanceof Error ? cause.message : 'No se pudo convertir el precio. Revisá el dólar del presupuesto.')
    }
  }
  function changePrice(unitPrice: string): void {
    const lengthError = getPriceInputLengthError(unitPrice)
    setRejectedPriceError(lengthError)
    if (!lengthError) {
      currencyOrigin.current = undefined
      setCurrencyError('')
      setDraft({ ...draft, unitPrice })
    }
  }

  const resultStart = visiblePage * PAGE_SIZE
  const tooMany = preview !== null && catalog.length - preview.removals.length + preview.additions.length > CATALOG_IMPORT_MAX_ITEMS
  const hasImportChanges = preview !== null && (preview.additions.length > 0 || preview.removals.length > 0 || ((preview.replacesSources || allowUpdates) && preview.updates.length > 0))
  const replacementConflicts = preview !== null && preview.replacesSources && preview.conflicts.length > 0

  return (
    <Dialog title="Mi catálogo" onClose={close}>
      <div className="catalog-tools">
        <p className="field-help">Opciones privadas de este navegador. Cambiar o eliminar una opción no modifica el presupuesto en curso. Siempre podés escribir un concepto manualmente.</p>
        <div>
          <p className="catalog-count" role="status">{sharedCatalogStatus === 'loading' ? 'Cargando catálogo compartido…'
            : sharedCatalogStatus === 'ready' ? 'Catálogo compartido disponible.'
              : sharedCatalogStatus === 'unavailable' ? 'Catálogo compartido no disponible. Podés usar tus opciones o escribir manualmente.'
                : 'No se pudo actualizar el catálogo compartido. Tus opciones y precios se conservan.'}</p>
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
          <p className="field-help">Elegí un JSON de Luquisound. Se procesa en este navegador y el presupuesto en curso se conserva. Las referencias sin aprobar quedan como consulta. Una lista aprobada explícitamente se copia al elegir el producto y muestra si es histórica provisional.</p>
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
              {preview.replacesSources && <div><dt>A retirar</dt><dd>{preview.summary.removals}</dd></div>}
              <div><dt>Sin cambios</dt><dd>{preview.summary.unchanged}</dd></div>
              <div><dt>Conflictos</dt><dd>{preview.summary.conflicts}</dd></div>
              <div><dt>Repetidas</dt><dd>{preview.summary.duplicateRows}</dd></div>
            </dl>
            {preview.replacesSources && <p className="notice">Este archivo reemplaza sus fuentes indicadas: actualiza las coincidencias y retira del catálogo las opciones de esas fuentes que ya no figuran. Se conservan las opciones manuales, el presupuesto en curso y los precios de venta de los productos que siguen en el catálogo.</p>}
            {preview.summary.withoutKey > 0 && <p className="notice">{preview.summary.withoutKey} registros no tienen proveedor y código completos. Se agregan sin actualizar coincidencias; volver a importarlos puede duplicarlos.</p>}
            {preview.conflicts.length > 0 && <>
              <p className={replacementConflicts ? 'field-errors' : 'field-help'} role={replacementConflicts ? 'alert' : undefined}>{replacementConflicts ? 'Resolvé los conflictos en el archivo antes de reemplazar las fuentes. El catálogo se conserva.' : 'Los conflictos se omiten. Podés importar los registros sin conflicto.'}</p>
              <ul className="catalog-preview-conflicts">{preview.conflicts.slice(0, 5).map((conflict, index) => <li key={index}>{conflict.itemIndexes.length > 0 ? `Registro ${conflict.itemIndexes.map((itemIndex) => itemIndex + 1).join(', ')}: ` : ''}{conflict.message}</li>)}</ul>
              {preview.conflicts.length > 5 && <p className="field-help">Hay {preview.conflicts.length - 5} conflictos adicionales para revisar en el archivo.</p>}
            </>}
            {!preview.replacesSources && preview.updates.length > 0 && <label className="catalog-confirm-updates">
              <input type="checkbox" checked={allowUpdates} onChange={(event) => setAllowUpdates(event.target.checked)} />
              <span>Confirmo actualizar las {preview.updates.length} opciones coincidentes. Se conservan sus precios de venta y referencias anteriores.</span>
            </label>}
            {tooMany && <p className="field-errors" role="alert">La importación superaría las 2000 opciones. El catálogo se conserva; revisá el archivo antes de continuar.</p>}
            {!hasImportChanges && <p className="field-help">{preview.updates.length > 0 ? 'Marcá la confirmación para aplicar las actualizaciones.' : 'No hay cambios nuevos para importar.'}</p>}
            <div className="dialog-actions">
              <button type="button" className="button secondary" onClick={clearPreview}>Cancelar importación</button>
              <button type="button" className="button secondary" onClick={refreshPreview}>Actualizar vista previa</button>
              <button type="button" className="button primary" disabled={!hasImportChanges || tooMany || replacementConflicts} onClick={importCatalog}>Confirmar importación</button>
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
          <label className="catalog-confirm-updates"><input type="checkbox" checked={showUnavailable} onChange={(event) => { setShowUnavailable(event.target.checked); setPage({ index: 0, category }) }} /><span>Mostrar no habilitados</span></label>
          {!showUnavailable && exactBlocked.length > 0 && <div className="notice pending" role="status">
            <p>La coincidencia exacta no está habilitada para cotizar. Marcá Mostrar no habilitados para consultar o editar su ficha.</p>
            {exactBlocked.slice(0, PAGE_SIZE).map((item) => <p key={item.id}><strong>{item.concept}</strong><CatalogAvailability item={item} now={now} /></p>)}
          </div>}
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
                <span className="catalog-item-price">{catalogPriceLabel(item)}</span>
                <CatalogAvailability item={item} now={now} />
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
          <label>Concepto<textarea ref={inputRef} className="product-name-input" rows={2} value={draft.concept} maxLength={500} onChange={(event) => setDraft({ ...draft, concept: event.target.value })} /></label>
          <label>Detalle para el cliente <span>(opcional)</span><textarea rows={2} value={draft.detail} maxLength={2000} onChange={(event) => setDraft({ ...draft, detail: event.target.value })} /></label>
          <div className="form-grid">
            <label>Sección sugerida<select value={draft.section} onChange={(event) => setDraft({ ...draft, section: event.target.value as RowSection })}><option value="equipment">Equipamiento</option><option value="extras">Instalación y accesorios</option></select></label>
            <label>Moneda del precio<select value={draft.currency} aria-invalid={Boolean(currencyError)} aria-describedby={currencyError ? currencyErrorId : undefined} onChange={(event) => changeCurrency(event.target.value as Currency)}><option value="ARS">ARS</option><option value="USD">USD</option></select></label>
          </div>
          {currencyError && <p id={currencyErrorId} className="field-errors" role="alert">{currencyError}</p>}
          <label>Precio manual para próximas selecciones · {draft.currency} <span>(opcional)</span><input className="compact-price-input" inputMode="decimal" placeholder={draft.listPrice ? 'Usar lista aprobada' : 'Precio pendiente'} value={draft.unitPrice} aria-invalid={Boolean(priceLengthError)} aria-describedby={priceLengthError ? priceErrorId : undefined} onChange={(event) => changePrice(event.target.value)} /></label>
          {priceLengthError && <p id={priceErrorId} className="field-errors" role="alert">{priceLengthError}</p>}
          <p className="field-help">Este precio se guarda en el catálogo para futuras selecciones. Coma para decimales; cero es válido. Cambiarlo no modifica filas ya cargadas. Las referencias sin aprobar requieren confirmación.</p>
          {draft.listPrice && <div className="notice pending">
            <p>Lista {draft.listPrice.provisional ? 'histórica provisional' : 'aprobada'}: {draft.listPrice.currency} {draft.listPrice.amount.replace('.', ',')}, PVP antes del 20% de descuento. Si dejás vacío el precio manual, se usará esta lista y su moneda al elegir el producto.</p>
            <p className="catalog-provenance">{sourceLabel(draft.listPrice.source)}</p>
          </div>}
          <CatalogAvailability item={draft} now={now} />
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
          <HistoricalReferences key={draft.id} item={draft} currency={draft.currency} onUse={changePrice} />
          {error && <p className="field-errors" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={() => { if (discardDraftChanges()) resetDraft() }}>Nueva opción</button>
            <button type="submit" className="button primary" disabled={Boolean(getPriceInputLengthError(draft.unitPrice))}>Guardar opción</button>
          </div>
        </form>
        </fieldset>
        <div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Cerrar catálogo</button></div>
      </div>
    </Dialog>
  )
}
