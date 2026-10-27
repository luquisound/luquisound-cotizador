import { useId, useState, type FormEvent } from 'react'
import { calculateQuotation, formatMoney, type CalculatedRow } from './calculation'
import { isDiscountEligibleItem, isDiscountSuggestedItem, parseDiscountPercentage } from './discounts'
import { isFactoryRow } from './factory-mode'
import { Dialog } from './QuotationDialog'
import type { Quotation, QuotationDiscount } from './model'

interface DiscountEditorProps {
  quotation: Quotation
  onSave: (discount: QuotationDiscount | undefined) => void
  onClose: () => void
}

function itemDescription(item: CalculatedRow): string {
  if (isFactoryRow(item.row)) return 'De fábrica: sin cargo.'
  if (item.row.priceState === 'included') return 'Incluido sin cargo.'
  if (item.row.priceState === 'pending') return 'Precio pendiente.'
  if (item.errors.length || item.lineTotalCents === null) return 'Revisá el concepto, la cantidad y el precio.'
  if (item.lineTotalCents === 0) return 'Sin importe para descontar.'
  return `${formatMoney(item.lineTotalCents, item.row.currency)} · Cantidad: ${item.row.quantity}`
}

export function DiscountEditor({ quotation, onSave, onClose }: DiscountEditorProps) {
  const items = calculateQuotation(quotation).rows.filter(({ row }) => row.section === 'equipment')
  const [percentage, setPercentage] = useState(quotation.discount?.percentage ?? '')
  const [rowIds, setRowIds] = useState<string[]>(() => {
    const selected = quotation.discount ? new Set(quotation.discount.rowIds) : null
    return items.filter((item) => selected ? selected.has(item.row.id) && isDiscountEligibleItem(item)
      : isDiscountSuggestedItem(item)).map(({ row }) => row.id)
  })
  const [percentageTouched, setPercentageTouched] = useState(false)
  const percentageHelpId = useId()
  const percentageErrorId = useId()
  const parsedPercentage = parseDiscountPercentage(percentage)
  const showPercentageError = !parsedPercentage.ok && (percentageTouched || percentage.trim().length > 0)
  const previewQuotation = { ...quotation }
  delete previewQuotation.discount
  if (parsedPercentage.ok && rowIds.length > 0) {
    previewQuotation.discount = { percentage: parsedPercentage.normalized, rowIds }
  }
  const preview = calculateQuotation(previewQuotation)
  const discount = preview.discount
  const canApply = parsedPercentage.ok && rowIds.length > 0 && discount !== null && discount.errors.length === 0
  const removedSelection = quotation.discount?.rowIds.some((id) => !items.some((item) => item.row.id === id && isDiscountEligibleItem(item)))

  function changeSelection(rowId: string, selected: boolean) {
    setRowIds((previous) => selected ? [...previous, rowId] : previous.filter((id) => id !== rowId))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPercentageTouched(true)
    if (canApply && parsedPercentage.ok) onSave({ percentage: parsedPercentage.normalized, rowIds })
  }

  return (
    <Dialog title="Descuento en equipos" className="discount-editor-dialog" onClose={onClose}>
      <form className="form-stack discount-editor-form" onSubmit={submit}>
        <div className="form-stack discount-editor-content">
          <p className="field-help">Elegí los equipos y el porcentaje para este presupuesto. Instalación y accesorios conservan sus importes.</p>
          <label>Porcentaje de descuento
            <input autoFocus data-editor-autofocus="true" inputMode="decimal" value={percentage} placeholder="Ingresar porcentaje" aria-invalid={showPercentageError} aria-describedby={`${percentageHelpId}${showPercentageError ? ` ${percentageErrorId}` : ''}`} onChange={(event) => setPercentage(event.target.value)} onBlur={() => setPercentageTouched(true)} />
          </label>
          <p id={percentageHelpId} className="field-help">Mayor que 0 y hasta 100 %, con hasta 2 decimales. Los precios originales se conservan.</p>
          {showPercentageError && !parsedPercentage.ok && <p id={percentageErrorId} className="field-errors" role="alert">{parsedPercentage.reason}</p>}
          <fieldset className="discount-equipment-list">
            <legend>Equipos incluidos en el descuento</legend>
            {items.length === 0 ? <p className="field-help">Agregá un equipo con precio confirmado para aplicar un descuento.</p> : items.map((item) => (
              <label key={item.row.id} className="discount-equipment-choice">
                <input type="checkbox" checked={rowIds.includes(item.row.id)} disabled={!isDiscountEligibleItem(item)} onChange={(event) => changeSelection(item.row.id, event.target.checked)} />
                <span className="discount-equipment-description">
                  <span className="discount-equipment-name">{item.row.concept.trim() || 'Concepto pendiente'}</span>
                  <span className="field-help">{itemDescription(item)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {removedSelection && <p className="field-help">Revisá la selección: algunos conceptos anteriores ya no están disponibles para descuento. Los cambios se aplican al guardar.</p>}
          {items.length > 0 && rowIds.length === 0 && <p className="field-help">Seleccioná al menos un equipo con precio válido y mayor que cero.</p>}
          {discount && <section className="form-stack discount-preview" aria-label="Vista previa del descuento" aria-live="polite">
            <h3>Vista previa</h3>
            {(['ARS', 'USD'] as const).filter((currency) => discount.eligibleTotals[currency] > 0).map((currency) => (
              <dl className="discount-preview-amounts" key={currency}>
                <div><dt>Base seleccionada</dt><dd>{formatMoney(discount.eligibleTotals[currency], currency)}</dd></div>
                <div><dt>Descuento · {discount.percentage} %</dt><dd>−{formatMoney(discount.amounts[currency], currency)}</dd></div>
                <div><dt>Equipos con descuento</dt><dd>{formatMoney(discount.eligibleTotals[currency] - discount.amounts[currency], currency)}</dd></div>
              </dl>
            ))}
            {discount.errors.map((error) => <p key={error} className="field-errors" role="alert">{error}</p>)}
            <dl className="discount-preview-amounts discount-preview-total">
              {(['ARS', 'USD'] as const).map((currency) => (
                <div key={currency}><dt>Total del presupuesto · {currency === 'ARS' ? '$' : 'usd'}</dt><dd>{preview.totals[currency] === null ? 'Pendiente' : formatMoney(preview.totals[currency], currency)}</dd></div>
              ))}
            </dl>
          </section>}
        </div>
        <div className="dialog-actions discount-editor-actions">
          {quotation.discount && <button className="button danger" type="button" onClick={() => onSave(undefined)}>Quitar descuento</button>}
          <button className="button secondary" type="button" onClick={onClose}>Cancelar</button>
          <button className="button primary" type="submit" disabled={!canApply}>Aplicar descuento</button>
        </div>
      </form>
    </Dialog>
  )
}
