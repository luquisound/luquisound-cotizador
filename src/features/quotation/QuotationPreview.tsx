import type { CSSProperties, ReactNode } from 'react'
import {
  calculateQuotation,
  calculateRow,
  formatMoney,
  formatMoneyAmount,
  isEmptyRow,
  parseQuantity,
} from './calculation.ts'
import type { CalculatedRow } from './calculation.ts'
import { getAudioCategories, hasRepeatCategoryAction } from './audio-categories.ts'
import type { AudioCategory } from './audio-categories.ts'
import type { Quotation, QuotationRow, RowSection } from './model.ts'
import { exchangeRateDescription } from './exchange-quote'
import { getCurrencyLabel } from './currency-display.ts'
import { QUOTATION_GRAPHIC } from './graphic.ts'
import { presentQuotationRow } from './presentation.ts'
import { HARNESS_PRESET_CONCEPT, isHarnessPresetRow } from './harness-preset.ts'
import { SortableList } from './SortableList.tsx'
import './preview.css'
import './exchange-ui.css'

const graphicStyle = {
  '--quotation-yellow': QUOTATION_GRAPHIC.yellow,
  '--quotation-black': QUOTATION_GRAPHIC.black,
} as CSSProperties

export interface QuotationPreviewProps {
  quotation: Quotation
  onEditHeader: () => void
  onEditRow: (rowId: string) => void
  onEditPrice: (rowId: string) => void
  onAddRow: (section: RowSection, audioCategory?: AudioCategory) => void
  onEditHarnessPreset: () => void
  onEditDiscount: () => void
  onMoveRow: (activeId: string, overId: string) => void
  notices: ReactNode
  exchangeDetails: ReactNode
}

interface PreviewRowProps {
  row: QuotationRow
  calculated: CalculatedRow
  onEdit: () => void
  onEditPrice: () => void
}

const sections: { section: RowSection; label: string; accessibleLabel: string }[] = [
  { section: 'equipment', label: 'EQUIPAMIENTO', accessibleLabel: 'equipamiento' },
  { section: 'extras', label: 'INSTALACIÓN Y ACCESORIOS', accessibleLabel: 'instalación y accesorios' },
]

function PreviewRow({ row, calculated, onEdit, onEditPrice }: PreviewRowProps) {
  const presentation = presentQuotationRow(calculated)
  const hasErrors = calculated.errors.length > 0
  const amount = hasErrors || calculated.lineTotalCents === null
    ? 'Pendiente'
    : row.priceState === 'included'
      ? 'Incluido'
      : formatMoney(calculated.lineTotalCents, row.currency)
  const concept = presentation.concept
  const accessibleConcept = [concept, presentation.quantity].filter(Boolean).join(' · ')

  return (
    <div
      className={`quotation-row${hasErrors ? ' quotation-row-pending' : ''}`}
    >
      <button type="button" className="quotation-row-description" data-row-id={row.id} onClick={onEdit} aria-label={`Editar ${accessibleConcept}. ${amount}`} title="Tocá para editar el concepto, la cantidad y sus datos">
        <span className="quotation-row-concept">{concept}</span>
        {presentation.detail && <span className="quotation-row-detail">{presentation.detail}</span>}
        {presentation.quantity && <span className="quotation-row-quantity">{presentation.quantity}</span>}
      </button>
      <button type="button" className={`quotation-row-price${hasErrors ? ' quotation-price-pending' : ''}`} data-row-price-id={row.id} onClick={onEditPrice} aria-label={`Editar precio unitario de ${accessibleConcept}. Importe de la fila: ${amount}`} title="Tocá para editar sólo el precio unitario">
        {amount}
      </button>
    </div>
  )
}

function PreviewHarnessPreset({
  row, onEditPrice,
}: {
  row: QuotationRow | undefined
  onEditPrice: () => void
}) {
  if (!row || row.harnessSelection?.enabled === false) {
    return (
      <button
        type="button"
        className="quotation-empty-row"
        data-audio-category="harness"
        data-row-price-id={row?.id}
        onClick={onEditPrice}
        aria-label={`Agregar ${HARNESS_PRESET_CONCEPT}`}
      >
        <span aria-hidden="true">+</span> {HARNESS_PRESET_CONCEPT}
      </button>
    )
  }
  const concept = row.concept.trim() || HARNESS_PRESET_CONCEPT
  const calculated = calculateRow(row)
  const amount = calculated.lineTotalCents === null || calculated.errors.length ? 'Pendiente'
    : row.priceState === 'included' ? 'Incluido' : formatMoney(calculated.lineTotalCents, row.currency)
  const quantity = parseQuantity(row.quantity)
  const quantityLabel = !quantity.ok || quantity.thousandths !== 1000
    ? `Cantidad: ${row.quantity.trim() || 'pendiente'}` : ''
  return (
    <div className="quotation-row quotation-harness-preset">
      <div className="quotation-harness-description">
        <button type="button" className="quotation-harness-open" onClick={onEditPrice} aria-label={`Editar ${concept}`}>
          <span className="quotation-row-concept">{concept}</span>
        </button>
        {row.detail.trim() && <span className="quotation-row-detail">{row.detail.trim()}</span>}
        {quantityLabel && <span className="quotation-row-quantity">{quantityLabel}</span>}
        {row.priceState === 'included' && <span className="quotation-row-quantity">Incluido sin cargo</span>}
      </div>
      <button type="button" className={`quotation-row-price${amount === 'Pendiente' ? ' quotation-price-pending' : ''}`} data-row-price-id={row.id} onClick={onEditPrice} aria-label={`Editar precio unitario de ${concept}. Importe de la fila: ${amount}`} title="Editar el precio y la selección de la ficha">
        {amount}
      </button>
    </div>
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
  onEditPrice,
  onAddRow,
  onEditHarnessPreset,
  onEditDiscount,
  onMoveRow,
  notices,
  exchangeDetails,
}: QuotationPreviewProps) {
  const calculation = calculateQuotation(quotation)
  const discount = calculation.discount
  const harnessRows = quotation.rows.filter((row) => row.section === 'extras' && row.audioCategory === 'harness')
  const harnessPreset = harnessRows.find(isHarnessPresetRow) ?? harnessRows.find((row) => !isEmptyRow(row))

  return (
    <div className="quotation-preview" style={graphicStyle}>
      <article
        className="quotation-sheet"
        aria-label="Vista previa editable del presupuesto"
      >
        <header className="quotation-header">
          <div className="quotation-brand-line">
            <img
              className="quotation-logo"
              src={QUOTATION_GRAPHIC.logoUrl}
              width="670"
              height="76"
              alt="Luquisound"
            />
            <p className="quotation-document-label">PRESUPUESTO<br />DE AUDIO</p>
          </div>
          <h1 className="quotation-heading">
            <button
              type="button"
              className="quotation-heading-edit"
              onClick={onEditHeader}
              aria-label="Editar título y subtítulo del presupuesto"
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
          </h1>
        </header>

        <div className="quotation-content">
          {notices}
          {sections.map(({ section, label, accessibleLabel }) => {
            const sectionRows = calculation.rows.filter(({ row }) => row.section === section)
            const occupiedCategories = new Set(sectionRows.map(({ row }) => row.audioCategory))
            return (
              <section className="quotation-section" key={section} aria-label={label}>
                <h2 className="quotation-section-title">{label}</h2>
                <SortableList
                  label={`Orden de los ítems en ${accessibleLabel}`}
                  className="quotation-sortable-rows"
                  onMove={onMoveRow}
                  items={sectionRows.map((item) => {
                    const presentation = presentQuotationRow(item)
                    return {
                      id: item.row.id,
                      label: [presentation.concept, presentation.quantity].filter(Boolean).join(' · '),
                      content: item.row.id === harnessPreset?.id ? (
                        <PreviewHarnessPreset row={item.row} onEditPrice={onEditHarnessPreset} />
                      ) : (
                        <PreviewRow
                          row={item.row}
                          calculated={item}
                          onEdit={() => onEditRow(item.row.id)}
                          onEditPrice={() => onEditPrice(item.row.id)}
                        />
                      ),
                    }
                  })}
                />
                {getAudioCategories(section).filter((category) => (
                  !occupiedCategories.has(category.id)
                  || hasRepeatCategoryAction(category.id)
                  || (category.id === 'harness' && harnessPreset?.harnessSelection?.enabled === false)
                )).map((category) => category.id === 'harness' ? (
                  <PreviewHarnessPreset key={category.id} row={harnessPreset} onEditPrice={onEditHarnessPreset} />
                ) : (
                  <button
                    key={category.id}
                    type="button"
                    className={occupiedCategories.has(category.id) ? 'quotation-category-add' : 'quotation-empty-row'}
                    data-audio-category={category.id}
                    onClick={() => onAddRow(section, category.id)}
                    aria-label={`Agregar ${category.label}`}
                  >
                    <span aria-hidden="true">+</span> {category.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="quotation-add-row"
                  onClick={() => onAddRow(section)}
                  aria-label={`Agregar otro concepto en ${accessibleLabel}`}
                >
                  <span aria-hidden="true">+</span> {section === 'extras' ? 'Agregar otro concepto' : 'Agregar otro'}
                </button>
              </section>
            )
          })}
          {quotation.notes.trim() && (
            <div className="quotation-notes">
              <span className="quotation-notes-label">OBSERVACIONES</span>
              <span>{quotation.notes.trim()}</span>
            </div>
          )}
        </div>

        <div className="quotation-total quotation-total-dual" aria-live="polite" aria-atomic="true">
          {discount && (
            <div className="quotation-discount-summary">
              <span>Descuento en equipos · {discount.percentage} %</span>
              {(['ARS', 'USD'] as const).filter((currency) => discount.eligibleTotals[currency] > 0).map((currency) => (
                <span className="quotation-discount-amount" key={currency}>− {formatMoney(discount.amounts[currency], currency)}</span>
              ))}
              {discount.errors.length > 0 && <ul className="quotation-discount-errors" role="alert">{discount.errors.map((error) => <li key={error}>{error}</li>)}</ul>}
            </div>
          )}
          <div className="quotation-total-heading">
            <span className="quotation-total-label">TOTAL</span>
            <button className="quotation-discount-action" type="button" onClick={onEditDiscount}>{quotation.discount ? 'Editar descuento' : 'Agregar descuento'}</button>
          </div>
          {(['ARS', 'USD'] as const).map((currency) => {
            const cents = calculation.totals[currency]
            return (
              <div className="quotation-converted-total" key={currency}>
                <span className="quotation-total-currency">{getCurrencyLabel(currency)}</span>
                <span className={cents === null ? 'quotation-total-pending' : 'quotation-total-amount'}>
                  {cents === null ? 'Pendiente' : formatMoneyAmount(cents)}
                </span>
              </div>
            )
          })}
          {exchangeDetails}
          <p className="quotation-rate-source">{exchangeRateDescription(quotation)}</p>
        </div>

        <footer className="quotation-footer">
          <span className="quotation-contact"><WhatsAppIcon />11 7358-1958</span>
          <span className="quotation-contact"><InstagramIcon />@luquisound.ok</span>
        </footer>
      </article>
    </div>
  )
}
