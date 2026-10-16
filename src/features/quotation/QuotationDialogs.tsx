import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { calculateQuotation, parseMoney } from './calculation'
import type { CatalogItem, Currency, Quotation, QuotationRow } from './model'

interface DialogProps { title: string; onClose: () => void; children: ReactNode }

export function Dialog({ title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return (
    <dialog ref={ref} className="editor-dialog" aria-label={title} onCancel={onClose}>
      <div className="dialog-heading"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}>×</button></div>
      {children}
    </dialog>
  )
}

interface HeaderEditorProps { quotation: Quotation; onSave: (quotation: Quotation) => void; onClose: () => void }

export function HeaderEditor({ quotation, onSave, onClose }: HeaderEditorProps) {
  const [draft, setDraft] = useState(quotation)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft.currency !== quotation.currency && !window.confirm('Cambiar la moneda no convierte los importes. Todos los precios quedarán expresados en la nueva moneda. ¿Continuar?')) return
    onSave(draft)
  }
  return (
    <Dialog title="Datos del presupuesto" onClose={onClose}>
      <form onSubmit={submit} className="form-stack">
        <label>Título<input autoFocus value={draft.title} maxLength={200} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Título del proyecto" /></label>
        <label>Subtítulo <span>(opcional)</span><input value={draft.subtitle} maxLength={300} onChange={(event) => setDraft({ ...draft, subtitle: event.target.value })} placeholder="Vehículo o descripción" /></label>
        <label>Moneda<select value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value as Currency })}><option value="ARS">ARS · Pesos argentinos</option><option value="USD">USD · Dólares estadounidenses</option></select></label>
        <p className="field-help">Una sola moneda por presupuesto. No hay conversión automática.</p>
        <label>Notas para el cliente <span>(opcional)</span><textarea rows={3} value={draft.notes} maxLength={4000} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
        <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" type="submit">Aplicar cambios</button></div>
      </form>
    </Dialog>
  )
}

interface RowEditorProps {
  row: QuotationRow; quotation: Quotation; catalog: CatalogItem[]
  onSave: (row: QuotationRow) => void; onRemove: () => void; onClose: () => void
}

export function RowEditor({ row, quotation, catalog, onSave, onRemove, onClose }: RowEditorProps) {
  const [draft, setDraft] = useState(row)
  const matchingCatalog = catalog.filter((item) => item.currency === quotation.currency && item.section === row.section)
  const validation = calculateQuotation({ ...quotation, rows: [draft] }).rows[0]?.errors ?? []
  function chooseCatalog(id: string) {
    const item = matchingCatalog.find((entry) => entry.id === id)
    if (item) setDraft({ ...draft, concept: item.concept, detail: item.detail, unitPrice: item.unitPrice, priceState: item.unitPrice ? 'priced' : 'pending' })
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); onSave(draft) }
  return (
    <Dialog title={row.section === 'equipment' ? 'Editar equipamiento' : 'Editar instalación o accesorio'} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <label>Elegir del catálogo <span>(opcional)</span><select value="" onChange={(event) => chooseCatalog(event.target.value)}><option value="">Escribir manualmente / dejar vacío</option>{matchingCatalog.map((item) => <option key={item.id} value={item.id}>{item.concept}</option>)}</select></label>
        {matchingCatalog.length === 0 && <p className="field-help">No hay opciones en {quotation.currency} para esta sección. Podés escribir cualquier concepto o sumar opciones a tu catálogo.</p>}
        <label>Concepto<input autoFocus value={draft.concept} maxLength={300} list={row.section === 'extras' ? 'extra-suggestions' : undefined} onChange={(event) => setDraft({ ...draft, concept: event.target.value })} placeholder={row.section === 'extras' ? 'Cables, mano de obra o trabajo libre' : 'Escribí un producto o trabajo'} /></label>
        <datalist id="extra-suggestions"><option value="Cables" /><option value="Mano de obra" /><option value="Aros adaptadores" /><option value="Insonorización" /><option value="Chapa y pintura" /></datalist>
        <label>Detalle <span>(opcional)</span><textarea rows={2} value={draft.detail} maxLength={1000} onChange={(event) => setDraft({ ...draft, detail: event.target.value })} /></label>
        <div className="form-grid"><label>Cantidad<input inputMode="decimal" value={draft.quantity} maxLength={30} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></label><label>Estado del precio<select value={draft.priceState} onChange={(event) => setDraft({ ...draft, priceState: event.target.value as QuotationRow['priceState'] })}><option value="pending">Pendiente</option><option value="priced">Con precio</option><option value="included">Incluido sin cargo</option></select></label></div>
        <label>Precio unitario · {quotation.currency}<input inputMode="decimal" value={draft.priceState === 'included' ? '0' : draft.unitPrice} disabled={draft.priceState === 'included'} maxLength={30} placeholder="Sin precio asignado" onChange={(event) => setDraft({ ...draft, unitPrice: event.target.value, priceState: event.target.value.trim() ? 'priced' : 'pending' })} /></label>
        <p className="field-help">Usá coma para decimales: 1.234,56. Cero es un precio válido; «Incluido sin cargo» se indica por separado. Podés guardar un precio pendiente.</p>
        {draft.concept.trim() && validation.length > 0 && <ul className="field-errors">{validation.map((error) => <li key={error}>{error}</li>)}</ul>}
        <div className="dialog-actions"><button type="button" className="button danger" onClick={() => { if (window.confirm('¿Eliminar este concepto del presupuesto?')) onRemove() }}>Eliminar</button><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button primary">Aplicar cambios</button></div>
      </form>
    </Dialog>
  )
}

interface CatalogEditorProps { catalog: CatalogItem[]; onSave: (catalog: CatalogItem[]) => boolean; onClose: () => void }

export function CatalogEditor({ catalog, onSave, onClose }: CatalogEditorProps) {
  const emptyItem = (): CatalogItem => ({ id: crypto.randomUUID(), concept: '', detail: '', section: 'equipment', currency: 'ARS', unitPrice: '' })
  const [draft, setDraft] = useState<CatalogItem>(emptyItem)
  const [error, setError] = useState('')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.concept.trim()) { setError('Escribí un concepto para guardar esta opción.'); return }
    if (catalog.length >= 2000 && !catalog.some((item) => item.id === draft.id)) { setError('El catálogo admite hasta 2000 opciones. Eliminá una antes de agregar otra.'); return }
    if (draft.unitPrice.trim() && !parseMoney(draft.unitPrice).ok) { setError('Revisá el precio. Usá un importe positivo o cero y coma para decimales.'); return }
    if (!onSave([...catalog.filter((item) => item.id !== draft.id), { ...draft, concept: draft.concept.trim() }])) return
    setDraft(emptyItem()); setError('')
  }
  return (
    <Dialog title="Mi catálogo" onClose={onClose}>
      <p className="field-help">Opciones personales de este navegador. Cambiar un precio acá no modifica presupuestos existentes. El catálogo es opcional.</p>
      <div className="catalog-list">{catalog.length === 0 ? <p>Todavía no agregaste opciones.</p> : catalog.map((item) => <div className="catalog-entry" key={item.id}><button className="catalog-choice" type="button" onClick={() => { setDraft(item); setError('') }}><strong>{item.concept}</strong><span>{item.currency} · {item.unitPrice || 'Precio pendiente'}</span></button><button type="button" className="icon-button" aria-label={`Eliminar ${item.concept} del catálogo`} onClick={() => { if (window.confirm('¿Eliminar esta opción del catálogo? Los presupuestos existentes se conservan.')) onSave(catalog.filter((entry) => entry.id !== item.id)) }}>×</button></div>)}</div>
      <form className="form-stack" onSubmit={submit}>
        <h3>{catalog.some((item) => item.id === draft.id) ? 'Editar opción' : 'Nueva opción'}</h3>
        <label>Concepto<input value={draft.concept} maxLength={300} onChange={(event) => setDraft({ ...draft, concept: event.target.value })} /></label>
        <label>Detalle <span>(opcional)</span><input value={draft.detail} maxLength={1000} onChange={(event) => setDraft({ ...draft, detail: event.target.value })} /></label>
        <div className="form-grid"><label>Sección<select value={draft.section} onChange={(event) => setDraft({ ...draft, section: event.target.value as CatalogItem['section'] })}><option value="equipment">Equipamiento</option><option value="extras">Instalación y accesorios</option></select></label><label>Moneda<select value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value as Currency })}><option value="ARS">ARS</option><option value="USD">USD</option></select></label></div>
        <label>Precio sugerido <span>(opcional)</span><input inputMode="decimal" placeholder="Sin precio asignado" value={draft.unitPrice} maxLength={30} onChange={(event) => setDraft({ ...draft, unitPrice: event.target.value })} /></label>
        {error && <p role="alert" className="field-errors">{error}</p>}
        <div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setDraft(emptyItem())}>Limpiar</button><button className="button primary" type="submit">Guardar opción</button></div>
      </form>
    </Dialog>
  )
}
