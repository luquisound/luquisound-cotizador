import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { calculateQuotation, formatMoney, isEmptyRow, parseMoney, parseQuantity } from './calculation'
import { ADAPTER_VARIANTS, getAudioCategories, isSingleRowCategory, readAudioCategory } from './audio-categories'
import { getRowAdapterSize, selectDirectAdapterSize } from './adapter-editor'
import { readAdapterVariant } from './adapters'
import { AdapterVariantFields, type AdapterVariantDraft } from './AdapterVariantFields'
import { RowProductPicker } from './CatalogTools'
import { CatalogAvailability } from './CatalogAvailability'
import { canSelectCatalogItem } from './catalog-stock'
import { resolveCatalogQuery } from './catalog-search'
import { Dialog } from './QuotationDialog'
import { getRowAvailabilityItem } from './quotation-availability'
import { getRowPriceOverride } from './row-provenance'
import { selectCatalogForRow } from './row-selection'
import { useCatalogClock } from './useCatalogClock'
import type { CatalogItem, Currency, Quotation, QuotationRow } from './model'

interface HeaderEditorProps {
  quotation: Quotation
  onSave: (quotation: Quotation) => void
  onClose: () => void
}

export function HeaderEditor({ quotation, onSave, onClose }: HeaderEditorProps) {
  const [draft, setDraft] = useState(quotation)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // The rate may finish loading while this form keeps unsaved header edits.
    onSave({ ...draft, exchangeRate: quotation.exchangeRate, exchangeRateQuote: quotation.exchangeRateQuote })
  }
  return (
    <Dialog title="Datos del presupuesto" onClose={onClose}>
      <form onSubmit={submit} className="form-stack">
        <label>Título<input autoFocus value={draft.title} maxLength={500} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Título del proyecto" /></label>
        <label>Subtítulo <span>(opcional)</span><input value={draft.subtitle} maxLength={300} onChange={(event) => setDraft({ ...draft, subtitle: event.target.value })} placeholder="Vehículo o descripción" /></label>
        <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" type="submit">Aplicar cambios</button></div>
      </form>
    </Dialog>
  )
}

interface RowEditorProps {
  row: QuotationRow; quotation: Quotation; catalog: CatalogItem[]
  onSave: (row: QuotationRow, addVariant?: boolean) => void; onRemove: () => void; onClose: () => void
  onEditExisting: (rowId: string) => void
  isNew?: boolean
  directConcept?: string
}

export function RowEditor({ row, quotation, catalog, onSave, onRemove, onClose, onEditExisting, isNew = false, directConcept }: RowEditorProps) {
  const [draft, setDraft] = useState(row)
  const [adapterDraft, setAdapterDraft] = useState<AdapterVariantDraft>(() => ({
    productKey: row.adapterVariant?.productKey ?? crypto.randomUUID(),
    size: row.adapterVariant?.size ?? '',
    presentation: row.adapterVariant?.presentation ?? '',
  }))
  const [selectedVariantId, setSelectedVariantId] = useState('')
  const [adapterError, setAdapterError] = useState('')
  const [selectionError, setSelectionError] = useState('')
  const [priceTouched, setPriceTouched] = useState(!isNew)
  const [optionsOpen, setOptionsOpen] = useState(() => !parseQuantity(row.quantity).ok)
  const [priceBuffer, setPriceBuffer] = useState(row.priceState === 'included' ? '0' : row.unitPrice)
  const productInput = useRef<HTMLInputElement>(null)
  const priceInput = useRef<HTMLInputElement>(null)
  const sizeInput = useRef<HTMLSelectElement>(null)
  const includedPriceOrigin = useRef(row.priceState === 'included')
  const priceStateBeforeIncluded = useRef<'pending' | 'priced'>(row.priceState === 'included' ? row.unitPrice.trim() ? 'priced' : 'pending' : row.priceState)
  const priceHelpId = useId()
  const priceErrorId = useId()
  const quantityErrorId = useId()
  const selectionErrorId = useId()
  const adapterMode = Boolean(directConcept && row.audioCategory === 'adapters')
  const adapterSize = getRowAdapterSize(draft)
  const existingAdapters = isNew && !adapterMode ? quotation.rows.filter((entry) => readAdapterVariant(entry.adapterVariant, entry.section, entry.audioCategory)
    && !isEmptyRow(entry)) : []
  const occupiedCategory = isSingleRowCategory(draft.audioCategory) && (isNew || row.audioCategory !== draft.audioCategory)
    ? quotation.rows.find((entry) => entry.id !== row.id && entry.section === draft.section && entry.audioCategory === draft.audioCategory && !isEmptyRow(entry))
    : undefined
  const observedRows = useMemo(() => [draft], [draft])
  const now = useCatalogClock(catalog, observedRows)
  const availabilityItem = getRowAvailabilityItem(draft, catalog)
  const provenance = draft.provenance
  const source = provenance?.source ?? provenance?.listPrice?.source
  const calculated = calculateQuotation({ ...quotation, rows: [draft] }).rows[0]
  const quantity = parseQuantity(draft.quantity)
  const price = draft.priceState === 'priced' ? parseMoney(draft.unitPrice) : null
  const priceError = price && !price.ok ? price.reason : null
  const arithmeticErrors = quantity.ok && (price?.ok || draft.priceState === 'included') && draft.concept.trim()
    ? calculated?.errors ?? [] : []
  const category = getAudioCategories(draft.section).find((entry) => entry.id === draft.audioCategory)
  const optionsSummary = [
    `Cant. ${draft.quantity.trim() || 'pendiente'}`, directConcept ? '' : category?.label ?? 'Otro',
    draft.detail.trim() ? 'Con detalle' : '', draft.currency,
    draft.priceState === 'included' ? 'Incluido sin cargo' : '',
  ].filter(Boolean).join(' · ')
  // The child dialog opens before this effect; focus without scrolling the page.
  useEffect(() => {
    const input = adapterMode && isNew && !adapterSize ? sizeInput.current : directConcept ? priceInput.current : productInput.current
    input?.focus({ preventScroll: true })
  }, [adapterMode, adapterSize, directConcept, isNew])
  function chooseCatalog(item: CatalogItem): boolean {
    try {
      const selected = selectCatalogForRow(draft, item, quotation.currency)
      setDraft(selected)
      setAdapterDraft({ productKey: item.id, size: '', presentation: '' })
      setSelectedVariantId('')
      setAdapterError('')
      setPriceBuffer(selected.unitPrice)
      includedPriceOrigin.current = false
      setSelectionError('')
      setPriceTouched(false)
      window.requestAnimationFrame(() => { priceInput.current?.focus() })
      return true
    } catch (cause: unknown) {
      setSelectionError(cause instanceof Error ? cause.message : 'No se pudo seleccionar el producto. Revisá su precio y disponibilidad.')
      return false
    }
  }
  function chooseAdapter(rowId: string) {
    const existing = existingAdapters.find((entry) => entry.id === rowId)
    const existingAvailability = existing ? getRowAvailabilityItem(existing, catalog) : undefined
    if (existingAvailability && !canSelectCatalogItem(existingAvailability, now)) {
      setSelectionError('Esta variante requiere revisar su disponibilidad antes de agregarla.')
      return
    }
    const nextDraft = existing?.adapterVariant
      ? { ...existing, id: row.id, quantity: draft.quantity }
      : { ...row, audioCategory: draft.audioCategory, quantity: draft.quantity }
    setSelectedVariantId(rowId)
    setDraft(nextDraft)
    setAdapterDraft(existing?.adapterVariant ? { ...existing.adapterVariant } : { productKey: crypto.randomUUID(), size: '', presentation: '' })
    setPriceBuffer(nextDraft.priceState === 'included' ? '0' : nextDraft.unitPrice)
    includedPriceOrigin.current = nextDraft.priceState === 'included'
    priceStateBeforeIncluded.current = nextDraft.priceState === 'included' ? nextDraft.unitPrice.trim() ? 'priced' : 'pending' : nextDraft.priceState
    setPriceTouched(false)
    setSelectionError('')
    setAdapterError('')
  }
  function changeCurrency(currency: Currency) {
    if (currency === draft.currency) return
    if (draft.unitPrice.trim() && !window.confirm('Cambiar la moneda conserva el importe escrito, sin convertirlo. ¿Continuar?')) return
    setDraft({ ...draft, currency })
  }
  function changeAudioCategory(value: string) {
    const audioCategory = readAudioCategory(value, draft.section)
    const nextDraft = { ...draft }
    if (audioCategory) nextDraft.audioCategory = audioCategory
    else delete nextDraft.audioCategory
    if (audioCategory !== 'adapters') {
      delete nextDraft.adapterVariant
      setAdapterDraft({ productKey: crypto.randomUUID(), size: '', presentation: '' })
      setSelectedVariantId('')
    }
    setAdapterError('')
    setDraft(nextDraft)
  }
  function changeIncluded(included: boolean) {
    if (included) {
      if (draft.priceState !== 'included') priceStateBeforeIncluded.current = draft.priceState
      includedPriceOrigin.current = true
      setPriceBuffer('0')
      setDraft({ ...draft, priceState: 'included' })
    } else {
      includedPriceOrigin.current = false
      setPriceBuffer(draft.unitPrice)
      setDraft({ ...draft, priceState: priceStateBeforeIncluded.current })
    }
  }
  function changePrice(unitPrice: string) {
    setPriceBuffer(unitPrice)
    if (directConcept && includedPriceOrigin.current) {
      const parsed = parseMoney(unitPrice)
      if (parsed.ok && parsed.cents === 0) {
        priceStateBeforeIncluded.current = 'priced'
        setDraft({ ...draft, unitPrice, priceState: 'included' })
        return
      }
    }
    setDraft({ ...draft, unitPrice, priceState: unitPrice.trim() ? 'priced' : 'pending' })
  }
  function changeAdapterSize(value: string) {
    if ((value !== '6.5' && value !== '8') || value === adapterSize) return
    const selected = selectDirectAdapterSize(draft, value)
    setSelectedVariantId('')
    setAdapterError('')
    setDraft(selected)
    setPriceBuffer(selected.unitPrice)
    includedPriceOrigin.current = false
    priceStateBeforeIncluded.current = 'priced'
    setPriceTouched(false)
    setSelectionError('')
    window.requestAnimationFrame(() => { priceInput.current?.focus() })
  }
  function groupLegacyAdapter() {
    if (!adapterSize) return
    setDraft({ ...draft, adapterVariant: selectDirectAdapterSize(draft, adapterSize).adapterVariant })
    setAdapterError('')
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    saveDraft()
  }
  function saveDraft(addVariant = false) {
    if (occupiedCategory) return
    if (adapterMode && isNew && !adapterSize) {
      setSelectionError('Elegí el tamaño de los aros.')
      sizeInput.current?.focus()
      return
    }
    if (!directConcept && isNew && !draft.provenance && !resolveCatalogQuery(catalog, draft.concept, canSelectCatalogItem).manualAllowed) {
      setSelectionError('Ese código o nombre corresponde a un producto no habilitado. Elegí otro producto o escribí un concepto independiente.')
      productInput.current?.focus()
      return
    }
    const next = { ...draft }
    delete next.adapterVariant
    const adapterVariant = readAdapterVariant(adapterMode ? draft.adapterVariant : adapterDraft, draft.section, draft.audioCategory)
    if (!adapterMode && draft.audioCategory === 'adapters' && (adapterDraft.size.trim() || adapterDraft.presentation) && !adapterVariant) {
      setAdapterError('Ingresá una medida positiva con hasta tres decimales y seleccioná si la cantidad corresponde a unidades, pares o juegos.')
      return
    }
    if (adapterVariant) {
      next.adapterVariant = adapterVariant
      if (!next.concept.trim()) next.concept = 'Aros adaptadores 3D'
    }
    // Preserve incomplete drafts and legacy states; only editing the price approves it.
    onSave(next, addVariant)
  }
  const quantityField = <>
    <label>Cantidad<input inputMode="decimal" value={draft.quantity} maxLength={30} aria-invalid={!quantity.ok} aria-describedby={!quantity.ok ? quantityErrorId : undefined} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></label>
    {!quantity.ok && <p id={quantityErrorId} className="field-errors">{quantity.reason} Se conserva como borrador.</p>}
  </>
  const sizeField = <label>{isNew ? 'Tamaño' : 'Corregir tamaño de esta variante'}<select ref={sizeInput} value={adapterSize} aria-invalid={Boolean(selectionError && !adapterSize)} aria-describedby={selectionError && !adapterSize ? selectionErrorId : undefined} onChange={(event) => changeAdapterSize(event.target.value)}><option value="" disabled>{isNew ? 'Elegir tamaño' : 'Sin especificar (presupuesto anterior)'}</option>{ADAPTER_VARIANTS.map((variant) => <option key={variant.id} value={variant.id}>{variant.label} · ARS {variant.unitPrice} / unidad</option>)}</select></label>
  return (
    <Dialog title={directConcept ? `${isNew ? 'Agregar' : 'Editar'} ${directConcept}` : row.section === 'equipment' ? `${isNew ? 'Agregar' : 'Editar'} equipamiento` : `${isNew ? 'Agregar' : 'Editar'} instalación o accesorio`} onClose={onClose}>
      <form className="form-stack row-editor-form" onSubmit={submit}>
        {!directConcept && <RowProductPicker catalog={catalog} section={row.section} value={draft.concept} inputRef={productInput} onChange={(concept) => { setDraft({ ...draft, concept }); setSelectionError('') }} onChoose={chooseCatalog} />}
        {selectionError && <p id={selectionErrorId} className="field-errors" role="alert">{selectionError}</p>}
        {provenance && <p className="row-selection-note">Del catálogo{provenance.sku ? ` · ${provenance.sku}` : ''}{getRowPriceOverride(draft) ? ' · Precio editado' : ''}</p>}
        {draft.audioCategory === 'adapters' && !adapterMode && <AdapterVariantFields value={adapterDraft} existingRows={existingAdapters} selectedRowId={selectedVariantId} onChange={(value) => { setAdapterDraft(value); setAdapterError('') }} onChoose={chooseAdapter} />}
        {adapterError && <p className="field-errors" role="alert">{adapterError}</p>}
        {adapterMode && <>
          {isNew ? sizeField : <p className="field-help">Medida de esta variante: {adapterSize ? `${adapterSize.replace('.', ',')} pulgadas` : 'sin especificar'}.</p>}
          {quantityField}
          {!isNew && !row.adapterVariant && adapterSize && !readAdapterVariant(draft.adapterVariant, draft.section, draft.audioCategory) && <button type="button" className="button secondary" onClick={groupLegacyAdapter}>Agrupar por esta medida</button>}
        </>}
        {!isNew && draft.audioCategory === 'adapters' && <button type="button" className="button secondary adapter-add-variant" onClick={() => saveDraft(true)}>Guardar y agregar otra medida</button>}
        <div className="row-price-field">
          <label>Precio unitario · {draft.currency}<input ref={priceInput} inputMode="decimal" value={directConcept ? priceBuffer : draft.priceState === 'included' ? '0' : draft.unitPrice} disabled={draft.priceState === 'included' && !directConcept} maxLength={30} placeholder="Sin precio asignado" aria-invalid={Boolean(priceTouched && priceError)} aria-describedby={`${priceHelpId}${priceTouched && priceError ? ` ${priceErrorId}` : ''}`} onBlur={() => setPriceTouched(true)} onFocus={(event) => { if (directConcept) event.currentTarget.select() }} onInput={(event) => { if (directConcept && event.currentTarget.value === priceBuffer) changePrice(event.currentTarget.value) }} onChange={(event) => changePrice(event.target.value)} /></label>
          <p id={priceHelpId} className="field-help row-price-status">{draft.priceState === 'included' ? directConcept ? 'Incluido sin cargo.' : 'Incluido sin cargo. Podés cambiarlo en Más opciones.' : draft.priceState === 'pending' ? draft.unitPrice.trim() ? 'Precio pendiente de confirmar. Editá el importe para asignarlo.' : 'Sin precio: queda pendiente.' : quantity.ok && quantity.thousandths !== 1000 && calculated?.lineTotalCents !== null && calculated?.lineTotalCents !== undefined ? `Cantidad ${draft.quantity} · Importe ${formatMoney(calculated.lineTotalCents, draft.currency)}` : 'Precio de una unidad.'}</p>
          {priceTouched && priceError && <p id={priceErrorId} className="field-errors" role="status">{priceError} Se conserva como borrador.</p>}
          {arithmeticErrors.length > 0 && <ul className="field-errors">{arithmeticErrors.map((error) => <li key={error}>{error}</li>)}</ul>}
        </div>
        {occupiedCategory && <div className="notice pending" role="status"><p>Esta categoría ya tiene un concepto. Podés editarlo o elegir otra categoría para esta fila.</p><button type="button" className="button secondary" onClick={() => onEditExisting(occupiedCategory.id)}>Editar concepto existente</button></div>}
        {availabilityItem && !canSelectCatalogItem(availabilityItem, now) && <p className="field-errors" role="status">Este producto requiere revisar su disponibilidad en Más opciones antes de exportar.</p>}
        <details className="row-more-options" open={optionsOpen} onToggle={(event) => setOptionsOpen(event.currentTarget.open)}>
          <summary><span>Más opciones</span><span className="row-options-summary">{optionsSummary}</span></summary>
          <div className="form-stack row-options-content">
            {adapterMode && !isNew && sizeField}
            {!adapterMode && quantityField}
            <label>Detalle <span>(opcional)</span><textarea rows={2} value={draft.detail} maxLength={2000} onChange={(event) => setDraft({ ...draft, detail: event.target.value })} /></label>
            {!directConcept && <label>Categoría del presupuesto<select value={draft.audioCategory ?? ''} onChange={(event) => changeAudioCategory(event.target.value)}>{getAudioCategories(draft.section).map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}<option value="">Otro</option></select></label>}
            <label>Moneda del ítem<select value={draft.currency} onChange={(event) => changeCurrency(event.target.value as Currency)}><option value="ARS">ARS · Pesos argentinos</option><option value="USD">USD · Dólares estadounidenses</option></select></label>
            <label className="row-included-toggle"><input type="checkbox" checked={draft.priceState === 'included'} onChange={(event) => changeIncluded(event.target.checked)} /><span>Incluido sin cargo</span></label>
            {provenance && <details className="catalog-metadata">
              <summary>Origen y precio de esta fila <span>(privado)</span></summary>
              <div className="form-stack">
                <p className="catalog-provenance">Proveedor: {provenance.supplier || 'no informado'} · SKU: {provenance.sku || 'no informado'}</p>
                <p className="catalog-provenance">Fuente: {source?.document ?? 'no informada'} · Versión: {source?.version ?? 'no informada'} · Fecha comercial: {source?.date ?? 'no informada'}</p>
                <p className="catalog-provenance">SHA-256: {source?.checksum ?? 'no informado'}</p>
                {source?.sheet && <p className="catalog-provenance">Hoja: {source.sheet}{source.row === undefined ? '' : ` · Fila ${source.row}`}</p>}
                <p className="field-help">Precio al seleccionar: {provenance.originalUnitPrice.trim() ? `${provenance.originalCurrency} ${provenance.originalUnitPrice}` : `pendiente (${provenance.originalCurrency})`}. {getRowPriceOverride(draft) ? 'El precio se editó en este presupuesto.' : 'Se conserva el precio seleccionado.'}</p>
                {(provenance.priceBasis === 'provisional-list' || provenance.listPrice?.provisional) && <p className="notice pending">Lista histórica provisional, antes del descuento. Confirmá disponibilidad antes de enviar.</p>}
                {availabilityItem && <CatalogAvailability item={availabilityItem} now={now} />}
                <p className="field-help">Los cambios son sólo de este presupuesto. El origen se conserva y no aparece en la imagen.</p>
              </div>
            </details>}
            {!isNew && <button type="button" className="button danger row-remove" onClick={() => { if (window.confirm('¿Eliminar este concepto del presupuesto?')) onRemove() }}>Eliminar concepto</button>}
          </div>
        </details>
        <div className="dialog-actions row-editor-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={Boolean(occupiedCategory)}>{isNew ? 'Agregar' : 'Guardar'}</button></div>
      </form>
    </Dialog>
  )
}
