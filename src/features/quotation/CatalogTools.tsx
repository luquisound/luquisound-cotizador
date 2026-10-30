import { useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
import { parseMoney } from './calculation.ts'
import {
  getCatalogCategories, getCatalogChoices, getCatalogDefaultCurrency,
} from './catalog.ts'
import type { CatalogCategoryOption, CatalogReferencePrice, CatalogSource } from './catalog.ts'
import type { CatalogItem, Currency, RowSection } from './model.ts'
import { queryCatalogRanked, resolveCatalogQuery } from './catalog-search.ts'
import { canSelectCatalogItem } from './catalog-stock.ts'
import { getCurrencyLabel } from './currency-display.ts'
import { CatalogAvailability } from './CatalogAvailability.tsx'
import { getCatalogSelectionPrice } from './row-provenance.ts'
import { useCatalogClock } from './useCatalogClock.ts'
import './catalog-ui.css'

const PICKER_LIMIT = 20
const roleLabels: Record<CatalogReferencePrice['role'], string> = {
  cost: 'Costo', list: 'Precio de lista', sale: 'Venta histórica', unknown: 'Rol no identificado',
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
      : price.priceBasis === 'provisional-list' ? 'Lista hist\u00f3rica provisional, antes del descuento'
        : 'Lista aprobada, antes del descuento'
    return `${label}: ${getCurrencyLabel(price.currency)} ${price.unitPrice}`
  } catch {
    return 'Precio manual inv\u00e1lido: revisalo antes de seleccionar'
  }
}

function referenceAmount(price: CatalogReferencePrice): string {
  if (price.amount === null) return 'Importe no indicado'
  const [whole, fraction] = price.amount.split('.')
  const value = `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${fraction === undefined ? '' : `,${fraction}`}`
  return `${price.currency === null || price.currency === undefined ? 'Moneda no identificada' : getCurrencyLabel(price.currency)} ${value}`
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
  if (currency !== undefined && price.currency !== currency) return `La referencia está en ${getCurrencyLabel(price.currency)}. Cargá un precio de venta en ${getCurrencyLabel(currency)}; no se convierte automáticamente.`
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
    let resizeFrame: number | null = null
    const resize = () => {
      field.style.height = 'auto'
      field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`
    }
    resize()
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === width) return
      width = field.clientWidth
      if (resizeFrame !== null) return
      // Measure after observer delivery so a height change cannot trigger a resize loop.
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null
        resize()
      })
    })
    observer.observe(field)
    return () => {
      observer.disconnect()
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame)
    }
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
