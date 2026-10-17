import { useMemo, useState, type FormEvent } from 'react'
import { calculateQuotation } from './calculation'
import { getAudioCategories, readAudioCategory } from './audio-categories'
import { CatalogPicker } from './CatalogTools'
import { CatalogAvailability } from './CatalogAvailability'
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
  onSave: (row: QuotationRow) => void; onRemove: () => void; onClose: () => void
  isNew?: boolean
}

export function RowEditor({ row, quotation, catalog, onSave, onRemove, onClose, isNew = false }: RowEditorProps) {
  const [draft, setDraft] = useState(row)
  const [selectionError, setSelectionError] = useState('')
  const observedRows = useMemo(() => [draft], [draft])
  const now = useCatalogClock(catalog, observedRows)
  const availabilityItem = getRowAvailabilityItem(draft, catalog)
  const provenance = draft.provenance
  const source = provenance?.source ?? provenance?.listPrice?.source
  const validation = calculateQuotation({ ...quotation, rows: [draft] }).rows[0]?.errors ?? []
  function chooseCatalog(item: CatalogItem) {
    try {
      setDraft(selectCatalogForRow(draft, item, quotation.currency))
      setSelectionError('')
    } catch (cause: unknown) {
      setSelectionError(cause instanceof Error ? cause.message : 'No se pudo seleccionar el producto. Revisá su precio y disponibilidad.')
    }
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
    setDraft(nextDraft)
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); onSave(draft) }
  return (
    <Dialog title={row.section === 'equipment' ? `${isNew ? 'Agregar' : 'Editar'} equipamiento` : `${isNew ? 'Agregar' : 'Editar'} instalación o accesorio`} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <label>Categoría del presupuesto<select value={draft.audioCategory ?? ''} onChange={(event) => changeAudioCategory(event.target.value)}>{getAudioCategories(draft.section).map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}<option value="">Otro</option></select></label>
        <CatalogPicker catalog={catalog} section={row.section} onChoose={chooseCatalog} />
        {selectionError && <p className="field-errors" role="alert">{selectionError}</p>}
        <label>Concepto<input autoFocus value={draft.concept} maxLength={500} list={row.section === 'extras' ? 'extra-suggestions' : undefined} onChange={(event) => setDraft({ ...draft, concept: event.target.value })} placeholder={row.section === 'extras' ? 'Cables, mano de obra o trabajo libre' : 'Escribí un producto o trabajo'} /></label>
        <datalist id="extra-suggestions"><option value="Cables" /><option value="Mano de obra" /><option value="Aros adaptadores" /><option value="Insonorización" /><option value="Chapa y pintura" /></datalist>
        <label>Detalle <span>(opcional)</span><textarea rows={2} value={draft.detail} maxLength={2000} onChange={(event) => setDraft({ ...draft, detail: event.target.value })} /></label>
        <div className="form-grid"><label>Cantidad<input inputMode="decimal" value={draft.quantity} maxLength={30} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></label><label>Estado del precio<select value={draft.priceState} onChange={(event) => setDraft({ ...draft, priceState: event.target.value as QuotationRow['priceState'] })}><option value="pending">Pendiente</option><option value="priced">Con precio</option><option value="included">Incluido sin cargo</option></select></label></div>
        <label>Moneda del ítem<select value={draft.currency} onChange={(event) => changeCurrency(event.target.value as Currency)}><option value="ARS">ARS · Pesos argentinos</option><option value="USD">USD · Dólares estadounidenses</option></select></label>
        <label>Precio unitario · {draft.currency}<input inputMode="decimal" value={draft.priceState === 'included' ? '0' : draft.unitPrice} disabled={draft.priceState === 'included'} maxLength={30} placeholder="Sin precio asignado" onChange={(event) => setDraft({ ...draft, unitPrice: event.target.value, priceState: event.target.value.trim() ? 'priced' : 'pending' })} /></label>
        <p className="field-help">Usá coma para decimales: 1.234,56. Cero es un precio válido; «Incluido sin cargo» se indica por separado. Podés guardar un precio pendiente.</p>
        <p className="field-help">Los cambios de esta fila se aplican sólo a este presupuesto. Para un precio que se use en próximas selecciones, editá la opción en Mi catálogo.</p>
        {provenance && <details className="catalog-metadata">
          <summary>Origen y precio de esta fila <span>(privado)</span></summary>
          <div className="form-stack">
            <p className="catalog-provenance">Proveedor: {provenance.supplier || 'no informado'} · SKU: {provenance.sku || 'no informado'}</p>
            <p className="catalog-provenance">Fuente: {source?.document ?? 'no informada'} · Versión: {source?.version ?? 'no informada'} · Fecha comercial: {source?.date ?? 'no informada'}</p>
            <p className="catalog-provenance">SHA-256: {source?.checksum ?? 'no informado'}</p>
            {source?.sheet && <p className="catalog-provenance">Hoja: {source.sheet}{source.row === undefined ? '' : ` · Fila ${source.row}`}</p>}
            <p className="field-help">Precio al seleccionar: {provenance.originalUnitPrice.trim() ? `${provenance.originalCurrency} ${provenance.originalUnitPrice}` : `pendiente (${provenance.originalCurrency})`}. {getRowPriceOverride(draft) ? 'El importe, la moneda o el estado sin cargo fue modificado en este presupuesto.' : 'El importe y la moneda coinciden con los seleccionados del catálogo.'}</p>
            {(provenance.priceBasis === 'provisional-list' || provenance.listPrice?.provisional) && <p className="notice pending">Fuente histórica provisional: PVP de lista antes del 20% de descuento. Confirmá disponibilidad antes de enviar; no es un precio vigente verificado.</p>}
            {availabilityItem && <CatalogAvailability item={availabilityItem} now={now} />}
            <p className="field-help">La trazabilidad se conserva al editar el concepto o el precio. Estos datos privados no se agregan a la imagen para el cliente.</p>
          </div>
        </details>}
        {draft.concept.trim() && validation.length > 0 && <ul className="field-errors">{validation.map((error) => <li key={error}>{error}</li>)}</ul>}
        <div className="dialog-actions">{!isNew && <button type="button" className="button danger" onClick={() => { if (window.confirm('¿Eliminar este concepto del presupuesto?')) onRemove() }}>Eliminar</button>}<button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button primary">Aplicar cambios</button></div>
      </form>
    </Dialog>
  )
}
