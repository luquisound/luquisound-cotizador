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
import { isFactoryEligibleRow, isFactoryRow, setRowFactoryMode } from './factory-mode'
import { isFixedServiceRow, prepareFixedServiceRow, resolveFixedServicePrice } from './fixed-services'
import { isInactiveHarnessRow } from './harness-preset'
import { getLinkedPriceTotal, getUnitPriceFromTotal } from './linked-price'
import { getCurrencyLabel } from './currency-display.ts'
import { getPriceInputLengthError } from './price-input'
import { changeRowCurrency, clearRowCurrencyConversion } from './row-currency'
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
  const [draft, setDraft] = useState(() => prepareFixedServiceRow(row))
  const [adapterDraft, setAdapterDraft] = useState<AdapterVariantDraft>(() => ({
    productKey: row.adapterVariant?.productKey ?? crypto.randomUUID(),
    size: row.adapterVariant?.size ?? '',
    presentation: row.adapterVariant?.presentation ?? '',
  }))
  const [selectedVariantId, setSelectedVariantId] = useState('')
  const [adapterError, setAdapterError] = useState('')
  const [selectionError, setSelectionError] = useState('')
  const [currencyError, setCurrencyError] = useState('')
  const [priceTouched, setPriceTouched] = useState(!isNew)
  const [rejectedPriceError, setRejectedPriceError] = useState<string | null>(null)
  const [totalDraft, setTotalDraft] = useState<string | null>(null)
  const [totalError, setTotalError] = useState('')
  const [totalRoundingNote, setTotalRoundingNote] = useState('')
  const [optionsOpen, setOptionsOpen] = useState(() => !parseQuantity(row.quantity).ok)
  const [priceBuffer, setPriceBuffer] = useState(() => {
    const prepared = prepareFixedServiceRow(row)
    return prepared.priceState === 'included' ? '0' : prepared.unitPrice
  })
  const productInput = useRef<HTMLTextAreaElement>(null)
  const priceInput = useRef<HTMLInputElement>(null)
  const totalInput = useRef<HTMLInputElement>(null)
  const sizeInput = useRef<HTMLSelectElement>(null)
  const includedPriceOrigin = useRef(row.priceState === 'included')
  const priceStateBeforeIncluded = useRef<'pending' | 'priced'>(row.priceState === 'included' ? row.unitPrice.trim() ? 'priced' : 'pending' : row.priceState)
  const priceHelpId = useId()
  const priceErrorId = useId()
  const totalErrorId = useId()
  const totalRoundingId = useId()
  const quantityErrorId = useId()
  const selectionErrorId = useId()
  const currencyErrorId = useId()
  const adapterMode = Boolean(directConcept && row.audioCategory === 'adapters')
  const fixedService = isFixedServiceRow(draft)
  const factory = isFactoryRow(draft)
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
  const visiblePrice = directConcept ? priceBuffer : draft.priceState === 'included' ? '0' : draft.unitPrice
  const linkedTotal = getLinkedPriceTotal(visiblePrice, draft.quantity)
  const visibleTotal = totalDraft ?? (linkedTotal.ok ? linkedTotal.input : '')
  const priceLengthError = rejectedPriceError ?? getPriceInputLengthError(visiblePrice)
  const priceError = priceLengthError ?? (price && !price.ok ? price.reason : null)
  const showPriceError = Boolean(priceLengthError || (priceTouched && priceError))
  const arithmeticErrors = quantity.ok && (price?.ok || draft.priceState === 'included') && draft.concept.trim()
    ? calculated?.errors ?? [] : []
  const category = getAudioCategories(draft.section).find((entry) => entry.id === draft.audioCategory)
  const optionsSummary = [
    fixedService ? '' : `Cant. ${draft.quantity.trim() || 'pendiente'}`, directConcept ? '' : category?.label ?? 'Otro',
    draft.detail.trim() ? 'Con detalle' : '', getCurrencyLabel(draft.currency),
    draft.priceState === 'included' ? 'Incluido sin cargo' : '',
  ].filter(Boolean).join(' · ')
  // The child dialog opens before this effect; focus without scrolling the page.
  useEffect(() => {
    const input = adapterMode && isNew && !adapterSize ? sizeInput.current : directConcept ? priceInput.current : productInput.current
    input?.focus({ preventScroll: true })
  }, [adapterMode, adapterSize, directConcept, isNew])
  function resetTotalDraft() {
    setTotalDraft(null)
    setTotalError('')
    setTotalRoundingNote('')
  }
  function chooseCatalog(item: CatalogItem): boolean {
    try {
      const selected = prepareFixedServiceRow(selectCatalogForRow(draft, item, quotation.currency))
      resetTotalDraft()
      setDraft(selected)
      setAdapterDraft({ productKey: item.id, size: '', presentation: '' })
      setSelectedVariantId('')
      setAdapterError('')
      setPriceBuffer(selected.unitPrice)
      setRejectedPriceError(null)
      includedPriceOrigin.current = false
      setSelectionError('')
      setCurrencyError('')
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
    const nextDraft = clearRowCurrencyConversion(existing?.adapterVariant
      ? { ...existing, id: row.id, quantity: draft.quantity }
      : { ...row, audioCategory: draft.audioCategory, quantity: draft.quantity })
    resetTotalDraft()
    setSelectedVariantId(rowId)
    setDraft(nextDraft)
    setAdapterDraft(existing?.adapterVariant ? { ...existing.adapterVariant } : { productKey: crypto.randomUUID(), size: '', presentation: '' })
    setPriceBuffer(nextDraft.priceState === 'included' ? '0' : nextDraft.unitPrice)
    includedPriceOrigin.current = nextDraft.priceState === 'included'
    priceStateBeforeIncluded.current = nextDraft.priceState === 'included' ? nextDraft.unitPrice.trim() ? 'priced' : 'pending' : nextDraft.priceState
    setPriceTouched(false)
    setRejectedPriceError(null)
    setSelectionError('')
    setCurrencyError('')
    setAdapterError('')
  }
  function changeCurrency(currency: Currency) {
    if (currency === draft.currency) return
    try {
      const next = changeRowCurrency(draft, currency, quotation.exchangeRate)
      resetTotalDraft()
      setDraft(next)
      setPriceBuffer(next.priceState === 'included' ? '0' : next.unitPrice)
      setCurrencyError('')
      setRejectedPriceError(null)
    } catch (cause: unknown) {
      setCurrencyError(cause instanceof Error ? cause.message : 'No se pudo convertir el precio. Revisá el dólar del presupuesto.')
    }
  }
  function changeAudioCategory(value: string) {
    resetTotalDraft()
    const audioCategory = readAudioCategory(value, draft.section)
    const nextDraft = { ...setRowFactoryMode(draft, false) }
    if (audioCategory) nextDraft.audioCategory = audioCategory
    else delete nextDraft.audioCategory
    if (nextDraft.section !== 'extras' || audioCategory !== 'harness') delete nextDraft.harnessSelection
    if (audioCategory !== 'adapters') {
      delete nextDraft.adapterVariant
      setAdapterDraft({ productKey: crypto.randomUUID(), size: '', presentation: '' })
      setSelectedVariantId('')
    }
    setAdapterError('')
    const prepared = prepareFixedServiceRow(nextDraft)
    setDraft(prepared)
    setPriceBuffer(prepared.priceState === 'included' ? '0' : prepared.unitPrice)
    includedPriceOrigin.current = prepared.priceState === 'included'
    priceStateBeforeIncluded.current = prepared.priceState === 'included' ? prepared.unitPrice.trim() ? 'priced' : 'pending' : prepared.priceState
    setRejectedPriceError(null)
  }
  function changeIncluded(included: boolean) {
    resetTotalDraft()
    setRejectedPriceError(null)
    setCurrencyError('')
    if (included) {
      if (draft.priceState !== 'included') priceStateBeforeIncluded.current = draft.priceState
      includedPriceOrigin.current = true
      setPriceBuffer('0')
      setDraft(resolveFixedServicePrice({ ...draft, priceState: 'included' }))
    } else {
      includedPriceOrigin.current = false
      setPriceBuffer(draft.unitPrice)
      setDraft({ ...draft, priceState: priceStateBeforeIncluded.current })
    }
  }
  function changePrice(unitPrice: string) {
    const lengthError = getPriceInputLengthError(unitPrice)
    setRejectedPriceError(lengthError)
    if (lengthError) return
    resetTotalDraft()
    setCurrencyError('')
    setPriceBuffer(unitPrice)
    if (directConcept && includedPriceOrigin.current) {
      const parsed = parseMoney(unitPrice)
      if (parsed.ok && parsed.cents === 0) {
        priceStateBeforeIncluded.current = 'priced'
        setDraft(resolveFixedServicePrice(clearRowCurrencyConversion({ ...draft, unitPrice, priceState: 'included' })))
        return
      }
    }
    setDraft(resolveFixedServicePrice(clearRowCurrencyConversion({ ...draft, unitPrice, priceState: unitPrice.trim() ? 'priced' : 'pending' })))
  }
  function changeTotal(value: string) {
    const lengthError = getPriceInputLengthError(value)
    if (lengthError) {
      setTotalError(lengthError)
      return
    }
    if (!value.trim()) {
      changePrice('')
      setTotalDraft(value)
      return
    }
    const result = getUnitPriceFromTotal(value, draft.quantity)
    if (!result.ok) {
      setTotalDraft(value)
      setTotalError(result.reason)
      setTotalRoundingNote('')
      return
    }
    changePrice(result.unitPrice)
    setTotalDraft(value)
    if (result.adjusted) setTotalRoundingNote(`Unitario redondeado a 2 decimales. Total aplicado: ${formatMoney(result.totalCents, draft.currency)}.`)
  }
  function changeQuantity(value: string) {
    resetTotalDraft()
    setDraft({ ...draft, quantity: value })
  }
  function changeFactory(enabled: boolean) {
    resetTotalDraft()
    const next = setRowFactoryMode(draft, enabled)
    setDraft(next)
    setPriceBuffer(next.priceState === 'included' ? '0' : next.unitPrice)
    includedPriceOrigin.current = next.priceState === 'included'
    priceStateBeforeIncluded.current = next.priceState === 'included' ? next.unitPrice.trim() ? 'priced' : 'pending' : next.priceState
    setRejectedPriceError(null)
    setCurrencyError('')
  }
  function changeAdapterSize(value: string) {
    if ((value !== '6.5' && value !== '8') || value === adapterSize) return
    resetTotalDraft()
    const selected = clearRowCurrencyConversion(selectDirectAdapterSize(draft, value))
    setSelectedVariantId('')
    setAdapterError('')
    setDraft(selected)
    setPriceBuffer(selected.unitPrice)
    includedPriceOrigin.current = false
    priceStateBeforeIncluded.current = 'priced'
    setPriceTouched(false)
    setRejectedPriceError(null)
    setSelectionError('')
    setCurrencyError('')
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
    if (totalError) {
      totalInput.current?.focus()
      return
    }
    if (getPriceInputLengthError(visiblePrice)) {
      setPriceTouched(true)
      priceInput.current?.focus()
      return
    }
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
    onSave(prepareFixedServiceRow(next), addVariant)
  }
  const quantityField = <>
    <label>Cantidad<input inputMode="decimal" value={draft.quantity} maxLength={30} aria-invalid={!quantity.ok} aria-describedby={!quantity.ok ? quantityErrorId : undefined} onChange={(event) => changeQuantity(event.target.value)} /></label>
    {!quantity.ok && <p id={quantityErrorId} className="field-errors">{quantity.reason} Se conserva como borrador.</p>}
  </>
  const sizeField = <label>{isNew ? 'Tamaño' : 'Corregir tamaño de esta variante'}<select ref={sizeInput} value={adapterSize} aria-invalid={Boolean(selectionError && !adapterSize)} aria-describedby={selectionError && !adapterSize ? selectionErrorId : undefined} onChange={(event) => changeAdapterSize(event.target.value)}><option value="" disabled>{isNew ? 'Elegir tamaño' : 'Sin especificar (presupuesto anterior)'}</option>{ADAPTER_VARIANTS.map((variant) => <option key={variant.id} value={variant.id}>{variant.label} · {getCurrencyLabel(variant.currency)} {variant.unitPrice} / unidad</option>)}</select></label>
  return (
    <Dialog className="row-editor-dialog" title={adapterMode ? `${isNew ? 'Agregar' : 'Editar'} aros adaptadores` : directConcept ? `${isNew ? 'Agregar' : 'Editar'} ${directConcept}` : row.section === 'equipment' ? `${isNew ? 'Agregar' : 'Editar'} equipamiento` : `${isNew ? 'Agregar' : 'Editar'} instalación o accesorio`} onClose={onClose}>
      <form className="form-stack row-editor-form" onSubmit={submit}>
        <div className="form-stack row-editor-content">
          {!directConcept && <fieldset className="row-product-lock" disabled={factory}><RowProductPicker catalog={catalog} section={row.section} value={draft.concept} inputRef={productInput} onChange={(concept) => { setDraft({ ...draft, concept }); setSelectionError('') }} onChoose={chooseCatalog} /></fieldset>}
          {selectionError && <p id={selectionErrorId} className="field-errors" role="alert">{selectionError}</p>}
          {provenance && <p className="row-selection-note">Del catálogo{provenance.sku ? ` · ${provenance.sku}` : ''}{getRowPriceOverride(draft) ? ' · Precio editado' : ''}</p>}
          {draft.audioCategory === 'adapters' && !adapterMode && <AdapterVariantFields value={adapterDraft} existingRows={existingAdapters} selectedRowId={selectedVariantId} onChange={(value) => { setAdapterDraft(value); setAdapterError('') }} onChoose={chooseAdapter} />}
          {adapterError && <p className="field-errors" role="alert">{adapterError}</p>}
          {adapterMode && <>
            {isNew ? sizeField : <p className="field-help">Medida de esta variante: {adapterSize ? `${adapterSize.replace('.', ',')} pulgadas` : 'sin especificar'}.</p>}
            {quantityField}
            {!isNew && !row.adapterVariant && adapterSize && !readAdapterVariant(draft.adapterVariant, draft.section, draft.audioCategory) && <button type="button" className="button secondary" onClick={groupLegacyAdapter}>Agrupar por esta medida</button>}
          </>}
          <div className="row-price-field">
            <div className={`row-price-controls${fixedService ? ' row-price-single' : ''}`}>
              <label className="row-price-input-label"><span className="row-price-label-text">{fixedService ? 'Precio' : 'Precio unitario'}<span className="row-currency-badge">{getCurrencyLabel(draft.currency)}</span></span><input ref={priceInput} className="compact-price-input" inputMode="decimal" value={visiblePrice} disabled={factory || (draft.priceState === 'included' && !directConcept)} placeholder="Sin precio" aria-invalid={showPriceError} aria-describedby={`${priceHelpId}${showPriceError ? ` ${priceErrorId}` : ''}`} onBlur={() => setPriceTouched(true)} onFocus={(event) => { if (directConcept) event.currentTarget.select() }} onInput={(event) => { if (directConcept && event.currentTarget.value === priceBuffer) changePrice(event.currentTarget.value) }} onChange={(event) => changePrice(event.target.value)} /></label>
              {!fixedService && <label className="row-price-input-label"><span className="row-price-label-text">Precio total<span className="row-currency-badge">{getCurrencyLabel(draft.currency)}</span></span><input ref={totalInput} className="compact-price-input row-total-input" inputMode="decimal" value={visibleTotal} disabled={!quantity.ok || factory || (draft.priceState === 'included' && !directConcept)} placeholder="Sin precio" aria-invalid={Boolean(totalError)} aria-describedby={`${priceHelpId}${totalError ? ` ${totalErrorId}` : ''}${totalRoundingNote ? ` ${totalRoundingId}` : ''}`} onChange={(event) => changeTotal(event.target.value)} onBlur={() => { if (!totalError) setTotalDraft(null) }} /></label>}
              {isFactoryEligibleRow(draft) && <label className="row-factory-toggle"><input type="checkbox" checked={factory} onChange={(event) => changeFactory(event.target.checked)} /><span>De fábrica</span></label>}
            </div>
            <p id={priceHelpId} className="field-help row-price-status">{factory ? 'De fábrica: sin cargo.' : isInactiveHarnessRow(draft) ? 'Sin seleccionar: el precio se conserva sin sumarse al presupuesto.' : draft.priceState === 'included' ? directConcept ? 'Incluido sin cargo.' : 'Incluido sin cargo. Podés cambiarlo en Más opciones.' : !quantity.ok ? 'Ingresá una cantidad válida para editar el total.' : draft.priceState === 'pending' ? draft.unitPrice.trim() ? 'Precio pendiente de confirmar. Editá el importe para asignarlo.' : 'Sin precio: queda pendiente.' : fixedService ? 'Precio total del concepto.' : `Cantidad: ${draft.quantity}. Podés editar cualquiera de los dos precios.`}</p>
            {totalError && <p id={totalErrorId} className="field-errors" role="alert">{totalError}</p>}
            {totalRoundingNote && <p id={totalRoundingId} className="field-help">{totalRoundingNote}</p>}
            {showPriceError && <p id={priceErrorId} className="field-errors" role="status">{priceError}{priceLengthError ? '' : ' Se conserva como borrador.'}</p>}
            {arithmeticErrors.length > 0 && <ul className="field-errors">{arithmeticErrors.map((error) => <li key={error}>{error}</li>)}</ul>}
          </div>
          {occupiedCategory && <div className="notice pending" role="status"><p>Esta categoría ya tiene un concepto. Podés editarlo o elegir otra categoría para esta fila.</p><button type="button" className="button secondary" onClick={() => onEditExisting(occupiedCategory.id)}>Editar concepto existente</button></div>}
          {availabilityItem && !canSelectCatalogItem(availabilityItem, now) && <p className="field-errors" role="status">Este producto requiere revisar su disponibilidad en Más opciones antes de exportar.</p>}
          <details className="row-more-options" open={optionsOpen} onToggle={(event) => setOptionsOpen(event.currentTarget.open)}>
            <summary><span className="row-options-heading">Más opciones<svg className="row-options-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></span><span className="row-options-summary">{optionsSummary}</span></summary>
            <div className="form-stack row-options-content">
              {adapterMode && !isNew && sizeField}
              {!adapterMode && !fixedService && quantityField}
              <label>Detalle <span>(opcional)</span><textarea rows={2} value={draft.detail} disabled={factory} maxLength={2000} onChange={(event) => setDraft({ ...draft, detail: event.target.value })} /></label>
              {!directConcept && <label>Categoría del presupuesto<select value={draft.audioCategory ?? ''} onChange={(event) => changeAudioCategory(event.target.value)}>{getAudioCategories(draft.section).map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}<option value="">Otro</option></select></label>}
              <label>Moneda del ítem<select value={draft.currency} aria-invalid={Boolean(currencyError)} aria-describedby={currencyError ? currencyErrorId : undefined} onChange={(event) => changeCurrency(event.target.value as Currency)}><option value="ARS">$ · Pesos argentinos</option><option value="USD">usd · Dólares estadounidenses</option></select></label>
              {currencyError && <p id={currencyErrorId} className="field-errors" role="alert">{currencyError}</p>}
              <label className="row-included-toggle"><input type="checkbox" checked={draft.priceState === 'included'} disabled={factory} onChange={(event) => changeIncluded(event.target.checked)} /><span>Incluido sin cargo</span></label>
              {!isNew && draft.audioCategory === 'adapters' && <button type="button" className="button secondary adapter-add-variant" onClick={() => saveDraft(true)}>Guardar y agregar otra medida</button>}
              {provenance && <details className="catalog-metadata">
                <summary>Origen y precio de esta fila <span>(privado)</span></summary>
                <div className="form-stack">
                  <p className="catalog-provenance">Proveedor: {provenance.supplier || 'no informado'} · SKU: {provenance.sku || 'no informado'}</p>
                  <p className="catalog-provenance">Fuente: {source?.document ?? 'no informada'} · Versión: {source?.version ?? 'no informada'} · Fecha comercial: {source?.date ?? 'no informada'}</p>
                  <p className="catalog-provenance">SHA-256: {source?.checksum ?? 'no informado'}</p>
                  {source?.sheet && <p className="catalog-provenance">Hoja: {source.sheet}{source.row === undefined ? '' : ` · Fila ${source.row}`}</p>}
                  <p className="field-help">Precio al seleccionar: {provenance.originalUnitPrice.trim() ? `${getCurrencyLabel(provenance.originalCurrency)} ${provenance.originalUnitPrice}` : `pendiente (${getCurrencyLabel(provenance.originalCurrency)})`}. {getRowPriceOverride(draft) ? 'El precio se editó en este presupuesto.' : 'Se conserva el precio seleccionado.'}</p>
                  {(provenance.priceBasis === 'provisional-list' || provenance.listPrice?.provisional) && <p className="notice pending">Lista histórica provisional, antes del descuento. Confirmá disponibilidad antes de enviar.</p>}
                  {availabilityItem && <CatalogAvailability item={availabilityItem} now={now} />}
                  <p className="field-help">Los cambios son sólo de este presupuesto. El origen se conserva y no aparece en la imagen.</p>
                </div>
              </details>}
            </div>
          </details>
        </div>
        <div className="dialog-actions row-editor-actions">
          {!isNew && <button type="button" className="button danger row-remove" onClick={() => { if (window.confirm('¿Eliminar este concepto del presupuesto?')) onRemove() }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></svg>Eliminar</button>}
          <button type="button" className="button secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="button primary" disabled={Boolean(occupiedCategory || totalError || getPriceInputLengthError(visiblePrice))}>{isNew ? 'Agregar' : 'Guardar'}</button>
        </div>
      </form>
    </Dialog>
  )
}
