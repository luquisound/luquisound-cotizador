import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { calculateQuotation, formatMoney, parseMoney } from './calculation'
import { Dialog } from './QuotationDialog'
import { isFactoryEligibleRow, isFactoryRow, setRowFactoryMode } from './factory-mode'
import { isFixedServiceRow, prepareFixedServiceRow } from './fixed-services'
import { isInactiveHarnessRow, setHarnessPresetSelected } from './harness-preset'
import { getPriceInputLengthError } from './price-input'
import { updateRowUnitPrice } from './row-price'
import { changeRowCurrency } from './row-currency'
import type { Currency, Quotation, QuotationRow } from './model'

interface RowPriceEditorProps {
  row: QuotationRow
  quotation: Quotation
  onSave: (row: QuotationRow) => void
  onClose: () => void
}

export function RowPriceEditor({ row, quotation, onSave, onClose }: RowPriceEditorProps) {
  const [base, setBase] = useState(() => prepareFixedServiceRow(row))
  const [unitPrice, setUnitPrice] = useState(() => {
    const prepared = prepareFixedServiceRow(row)
    return prepared.priceState === 'included' ? '0' : prepared.unitPrice
  })
  const [rejectedPriceError, setRejectedPriceError] = useState<string | null>(null)
  const [currencyError, setCurrencyError] = useState<string | null>(null)
  const [priceEdited, setPriceEdited] = useState(false)
  const helpId = useId()
  const errorId = useId()
  const currencyErrorId = useId()
  const input = useRef<HTMLInputElement>(null)
  // Dialog opens in its own effect; focus the amount after showModal has run.
  useEffect(() => { input.current?.focus() }, [])
  const parsed = unitPrice.trim() ? parseMoney(unitPrice) : null
  const error = rejectedPriceError ?? getPriceInputLengthError(unitPrice) ?? (priceEdited && parsed && !parsed.ok ? parsed.reason : null)
  const factory = isFactoryRow(base)
  const fixedService = isFixedServiceRow(base)
  const harness = base.section === 'extras' && base.audioCategory === 'harness'
  const inactiveHarness = isInactiveHarnessRow(base)
  const draft = error ? null : factory || !priceEdited ? base : updateRowUnitPrice(base, unitPrice)
  const calculated = draft ? calculateQuotation({ ...quotation, rows: [draft] }).rows[0] : undefined
  const amount = calculated?.lineTotalCents
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft) onSave(draft)
  }
  function changePrice(value: string) {
    const lengthError = getPriceInputLengthError(value)
    setRejectedPriceError(lengthError)
    if (!lengthError) {
      setUnitPrice(value)
      setPriceEdited(true)
      setCurrencyError(null)
    }
  }
  function changeCurrency(currency: Currency) {
    if (currency === base.currency) return
    if (!draft) {
      setCurrencyError('Revis\u00e1 el precio antes de cambiar la moneda.')
      return
    }
    try {
      const next = changeRowCurrency(draft, currency, quotation.exchangeRate)
      setBase(next)
      setUnitPrice(next.priceState === 'included' ? '0' : next.unitPrice)
      setPriceEdited(false)
      setRejectedPriceError(null)
      setCurrencyError(null)
    } catch (cause: unknown) {
      setCurrencyError(cause instanceof Error ? cause.message : 'No se pudo convertir el precio. Revis\u00e1 el d\u00f3lar del presupuesto.')
    }
  }
  function changeFactory(enabled: boolean) {
    const current: QuotationRow = !priceEdited ? base : draft ?? { ...base, unitPrice, priceState: unitPrice.trim() ? 'priced' : 'pending' }
    const next = setRowFactoryMode(current, enabled)
    setBase(next)
    setUnitPrice(next.priceState === 'included' ? '0' : next.unitPrice)
    setRejectedPriceError(null)
    setCurrencyError(null)
    setPriceEdited(false)
  }
  function changeHarness(enabled: boolean) {
    setBase((current) => setHarnessPresetSelected(current, enabled))
  }
  return (
    <Dialog title="Editar precio" onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <p className="field-help row-price-concept">{base.concept.trim() || 'Concepto pendiente'}</p>
        {harness && <label className="row-harness-toggle"><input type="checkbox" checked={!inactiveHarness} onChange={(event) => changeHarness(event.target.checked)} /><span>Incluir en el presupuesto</span></label>}
        <div className="row-price-controls row-price-currency-controls">
          <label className="row-price-input-label">{fixedService ? 'Precio' : 'Precio unitario'} · {base.currency}<input ref={input} className="compact-price-input" inputMode="decimal" value={unitPrice} disabled={factory} placeholder="Sin precio" aria-invalid={Boolean(error)} aria-describedby={`${helpId}${error ? ` ${errorId}` : ''}`} onChange={(event) => changePrice(event.target.value)} onFocus={(event) => event.currentTarget.select()} /></label>
          <label className="row-price-currency-label">Moneda<select value={base.currency} aria-describedby={currencyError ? currencyErrorId : undefined} onChange={(event) => changeCurrency(event.target.value as Currency)}><option value="ARS">ARS</option><option value="USD">USD</option></select></label>
          {isFactoryEligibleRow(base) && <label className="row-factory-toggle"><input type="checkbox" checked={factory} onChange={(event) => changeFactory(event.target.checked)} /><span>De fábrica</span></label>}
        </div>
        <p id={helpId} className="field-help">{factory ? 'De fábrica: sin cargo.' : 'Usá coma para decimales: 1.234,56. Cero es válido.'}</p>
        {!inactiveHarness && <p className="field-help">{fixedService ? 'Precio total del concepto.' : `La plantilla muestra cantidad × precio unitario. Cantidad: ${base.quantity.trim() || 'pendiente'}.`} Importe de la fila: {amount === undefined || amount === null ? 'Pendiente' : draft?.priceState === 'included' ? 'Incluido' : formatMoney(amount, base.currency)}.</p>}
        {currencyError && <p id={currencyErrorId} className="field-errors" role="alert">{currencyError}</p>}
        {calculated && calculated.errors.length > 0 && <ul className="field-errors">{calculated.errors.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
        {!factory && base.priceState === 'included' && <p className="field-help">Este concepto está incluido sin cargo. Un importe mayor que cero lo cambia a con precio; cero conserva «Incluido sin cargo».</p>}
        {error && <p id={errorId} className="field-errors" role="alert">{error}</p>}
        <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={Boolean(error)}>Guardar precio</button></div>
      </form>
    </Dialog>
  )
}
