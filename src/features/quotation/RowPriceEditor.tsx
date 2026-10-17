import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { calculateQuotation, formatMoney, parseMoney } from './calculation'
import { Dialog } from './QuotationDialog'
import { updateRowUnitPrice } from './row-price'
import type { Quotation, QuotationRow } from './model'

interface RowPriceEditorProps {
  row: QuotationRow
  quotation: Quotation
  onSave: (unitPrice: string) => void
  onClose: () => void
}

export function RowPriceEditor({ row, quotation, onSave, onClose }: RowPriceEditorProps) {
  const [unitPrice, setUnitPrice] = useState(row.priceState === 'included' ? '0' : row.unitPrice)
  const helpId = useId()
  const errorId = useId()
  const input = useRef<HTMLInputElement>(null)
  // Dialog opens in its own effect; focus the amount after showModal has run.
  useEffect(() => { input.current?.focus() }, [])
  const parsed = unitPrice.trim() ? parseMoney(unitPrice) : null
  const error = parsed && !parsed.ok ? parsed.reason : null
  const draft = error ? null : updateRowUnitPrice(row, unitPrice)
  const calculated = draft ? calculateQuotation({ ...quotation, rows: [draft] }).rows[0] : undefined
  const amount = calculated?.lineTotalCents
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!error) onSave(unitPrice)
  }
  return (
    <Dialog title="Editar precio" onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <p className="field-help">{row.concept.trim() || 'Concepto pendiente'}</p>
        <label>Precio unitario · {row.currency}<input ref={input} inputMode="decimal" value={unitPrice} maxLength={30} placeholder="Sin precio asignado" aria-invalid={Boolean(error)} aria-describedby={`${helpId}${error ? ` ${errorId}` : ''}`} onChange={(event) => setUnitPrice(event.target.value)} onFocus={(event) => event.currentTarget.select()} /></label>
        <p id={helpId} className="field-help">Usá coma para decimales: 1.234,56. Cero es válido. Dejá el campo vacío para guardar el precio pendiente. La moneda se conserva.</p>
        <p className="field-help">La plantilla muestra cantidad × precio unitario. Cantidad: {row.quantity.trim() || 'pendiente'}. Importe de la fila: {amount === undefined || amount === null ? 'Pendiente' : draft?.priceState === 'included' ? 'Incluido' : formatMoney(amount, row.currency)}.</p>
        {calculated && calculated.errors.length > 0 && <ul className="field-errors">{calculated.errors.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
        {row.priceState === 'included' && <p className="field-help">Este concepto está incluido sin cargo. Un importe mayor que cero lo cambia a con precio; cero conserva «Incluido sin cargo».</p>}
        {error && <p id={errorId} className="field-errors" role="alert">{error}</p>}
        <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={Boolean(error)}>Guardar precio</button></div>
      </form>
    </Dialog>
  )
}
