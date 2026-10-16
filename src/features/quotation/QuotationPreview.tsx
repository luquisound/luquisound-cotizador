import { useId } from 'react'
import {
  calculateQuotation,
  formatMoney,
  isEmptyRow,
  parseQuantity,
} from './calculation.ts'
import type { CalculatedRow } from './calculation.ts'
import type { Currency, Quotation, QuotationRow, RowSection } from './model.ts'
import './preview.css'

export interface QuotationPreviewProps {
  quotation: Quotation
  onEditHeader: () => void
  onEditRow: (rowId: string) => void
  onAddRow: (section: RowSection) => void
}

interface PreviewRowProps {
  row: QuotationRow
  calculated: CalculatedRow | undefined
  currency: Currency
  onEdit: () => void
}

const sections: { section: RowSection; label: string; addLabel: string }[] = [
  { section: 'equipment', label: 'EQUIPAMIENTO', addLabel: 'Agregar concepto' },
  { section: 'extras', label: 'INSTALACIÓN Y ACCESORIOS', addLabel: 'Agregar extra' },
]

function PreviewRow({ row, calculated, currency, onEdit }: PreviewRowProps) {
  if (isEmptyRow(row)) {
    return (
      <button
        type="button"
        className="quotation-empty-row"
        onClick={onEdit}
        aria-label={row.section === 'equipment' ? 'Completar concepto vacío' : 'Completar extra vacío'}
      >
        <span aria-hidden="true">+</span>
        {row.section === 'equipment' ? 'Completar concepto' : 'Completar extra'}
      </button>
    )
  }

  const quantity = parseQuantity(row.quantity)
  const quantityLabel = quantity.ok && quantity.thousandths === 1000
    ? ''
    : `Cantidad: ${row.quantity.trim() || 'pendiente'}`
  const hasErrors = !calculated || calculated.errors.length > 0
  const amount = hasErrors || calculated.lineTotalCents === null
    ? 'Pendiente'
    : row.priceState === 'included'
      ? 'Incluido'
      : formatMoney(calculated.lineTotalCents, currency)
  const concept = row.concept.trim() || 'Concepto pendiente'

  return (
    <button
      type="button"
      className={`quotation-row${hasErrors ? ' quotation-row-pending' : ''}`}
      onClick={onEdit}
      aria-label={`Editar ${concept}. ${amount}`}
      title="Tocá para editar el concepto, la cantidad y el precio"
    >
      <span className="quotation-row-description">
        <span className="quotation-row-concept">{concept}</span>
        {row.detail.trim() && <span className="quotation-row-detail">{row.detail.trim()}</span>}
        {quantityLabel && <span className="quotation-row-quantity">{quantityLabel}</span>}
      </span>
      <span className={`quotation-row-price${hasErrors ? ' quotation-price-pending' : ''}`}>
        {amount}
      </span>
    </button>
  )
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M20.4 11.7a8.4 8.4 0 0 1-12.5 7.4L3 20.5l1.4-4.7a8.4 8.4 0 1 1 16-4.1Z" />
      <path d="m8.3 7.2 1.5 2.3-.9 1.2a8.9 8.9 0 0 0 3.9 3.9l1.2-.9 2.3 1.5c-.3 1.4-1.2 2-2.4 1.8-3.6-.6-7.6-4.6-8.2-8.2-.2-1.2.4-2.1 1.8-2.4Z" strokeLinejoin="round" transform="translate(1 0) scale(.9)" />
    </svg>
  )
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x="3.3" y="3.3" width="17.4" height="17.4" rx="5" />
      <circle cx="12" cy="12" r="4.1" />
      <circle cx="17.4" cy="6.7" r=".8" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function QuotationPreview({
  quotation,
  onEditHeader,
  onEditRow,
  onAddRow,
}: QuotationPreviewProps) {
  const hintId = useId()
  const calculation = calculateQuotation(quotation)
  const calculatedById = new Map(calculation.rows.map((row) => [row.row.id, row]))

  return (
    <div className="quotation-preview">
      <p className="quotation-edit-hint" id={hintId}>
        Tocá el título o un concepto para editar la plantilla.
      </p>
      <article
        className="quotation-sheet"
        aria-label="Vista previa editable del presupuesto"
        aria-describedby={hintId}
      >
        <header className="quotation-header">
          <div className="quotation-brand-line">
            <img
              className="quotation-logo"
              src="/brand/luquisound-horizontal.svg"
              width="670"
              height="76"
              alt="Luquisound"
            />
            <p className="quotation-document-label">PRESUPUESTO<br />DE AUDIO</p>
          </div>
          <h2 className="quotation-heading">
            <button
              type="button"
              className="quotation-heading-edit"
              onClick={onEditHeader}
              aria-label="Editar título, subtítulo y observaciones del presupuesto"
              title="Tocá para editar el encabezado"
            >
              <span className="quotation-title">
                <span className={quotation.title.trim() ? undefined : 'quotation-title-placeholder'}>
                  {quotation.title.trim() || 'AGREGAR TÍTULO'}
                </span>
              </span>
              {quotation.subtitle.trim() && (
                <span className="quotation-subtitle">{quotation.subtitle.trim()}</span>
              )}
            </button>
          </h2>
        </header>

        <div className="quotation-content">
          {sections.map(({ section, label, addLabel }) => (
            <section className="quotation-section" key={section} aria-label={label}>
              <h3 className="quotation-section-title">{label}</h3>
              <ul className="quotation-rows">
                {quotation.rows.filter((row) => row.section === section).map((row) => (
                  <li key={row.id}>
                    <PreviewRow
                      row={row}
                      calculated={calculatedById.get(row.id)}
                      currency={quotation.currency}
                      onEdit={() => onEditRow(row.id)}
                    />
                  </li>
                ))}
              </ul>
              <button type="button" className="quotation-add-row" onClick={() => onAddRow(section)}>
                <span aria-hidden="true">+</span> {addLabel}
              </button>
            </section>
          ))}
          {quotation.notes.trim() && (
            <button
              type="button"
              className="quotation-notes"
              onClick={onEditHeader}
              aria-label="Editar observaciones del presupuesto"
            >
              <span className="quotation-notes-label">OBSERVACIONES</span>
              <span>{quotation.notes.trim()}</span>
            </button>
          )}
        </div>

        <div className="quotation-total" aria-live="polite" aria-atomic="true">
          <div className="quotation-total-description">
            <span className="quotation-total-label">TOTAL</span>
            <span className="quotation-total-currency">{quotation.currency}</span>
          </div>
          <div className="quotation-total-value">
            <span className={calculation.canExport ? 'quotation-total-amount' : 'quotation-total-pending'}>
              {calculation.canExport
                ? formatMoney(calculation.totalCents, quotation.currency).slice(quotation.currency.length + 1)
                : 'Pendiente'}
            </span>
            {!calculation.canExport && (
              <span className="quotation-total-hint">
                {calculation.rows.length ? 'Completá los datos pendientes.' : 'Agregá un concepto para calcular el total.'}
              </span>
            )}
          </div>
        </div>

        <footer className="quotation-footer">
          <span className="quotation-contact"><WhatsAppIcon />11 7358-1958</span>
          <span className="quotation-contact"><InstagramIcon />@luquisound.ok</span>
        </footer>
      </article>
    </div>
  )
}
