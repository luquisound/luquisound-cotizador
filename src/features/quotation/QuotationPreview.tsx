import type { CSSProperties, ReactNode } from 'react'
import {
  calculateQuotation,
  formatMoney,
  parseQuantity,
} from './calculation.ts'
import type { CalculatedRow } from './calculation.ts'
import { getAudioCategories, hasRepeatCategoryAction, readAudioCategory } from './audio-categories.ts'
import type { AudioCategory } from './audio-categories.ts'
import type { Quotation, QuotationRow, RowSection } from './model.ts'
import { exchangeRateDescription } from './exchange-quote'
import { QUOTATION_GRAPHIC } from './graphic.ts'
import { adapterVariantAmount, adapterVariantDescription, buildQuotationPresentation } from './presentation.ts'
import type { AdapterPresentationBlock, QuotationPresentationItem } from './presentation.ts'
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
  notices: ReactNode
  exchangeDetails: ReactNode
}

interface PreviewRowProps {
  row: QuotationRow
  calculated: CalculatedRow | undefined
  onEdit: () => void
  onEditPrice: () => void
}

const sections: { section: RowSection; label: string; accessibleLabel: string }[] = [
  { section: 'equipment', label: 'EQUIPAMIENTO', accessibleLabel: 'equipamiento' },
  { section: 'extras', label: 'INSTALACIÓN Y ACCESORIOS', accessibleLabel: 'instalación y accesorios' },
]

function PreviewRow({ row, calculated, onEdit, onEditPrice }: PreviewRowProps) {
  const quantity = parseQuantity(row.quantity)
  const quantityLabel = quantity.ok && quantity.thousandths === 1000
    ? ''
    : `Cantidad: ${row.quantity.trim() || 'pendiente'}`
  const hasErrors = !calculated || calculated.errors.length > 0
  const amount = hasErrors || calculated.lineTotalCents === null
    ? 'Pendiente'
    : row.priceState === 'included'
      ? 'Incluido'
      : formatMoney(calculated.lineTotalCents, row.currency)
  const concept = row.concept.trim() || 'Concepto pendiente'

  return (
    <div
      className={`quotation-row${hasErrors ? ' quotation-row-pending' : ''}`}
    >
      <button type="button" className="quotation-row-description" data-row-id={row.id} onClick={onEdit} aria-label={`Editar ${concept}. ${amount}`} title="Tocá para editar el concepto, la cantidad y sus datos">
        <span className="quotation-row-concept">{concept}</span>
        {row.detail.trim() && <span className="quotation-row-detail">{row.detail.trim()}</span>}
        {quantityLabel && <span className="quotation-row-quantity">{quantityLabel}</span>}
      </button>
      <button type="button" className={`quotation-row-price${hasErrors ? ' quotation-price-pending' : ''}`} data-row-price-id={row.id} onClick={onEditPrice} aria-label={`Editar precio unitario de ${concept}. Importe de la fila: ${amount}`} title="Tocá para editar sólo el precio unitario">
        {amount}
      </button>
    </div>
  )
}

function PreviewAdapterGroup({
  block, onEditRow, onEditPrice,
}: {
  block: AdapterPresentationBlock
  onEditRow: (rowId: string) => void
  onEditPrice: (rowId: string) => void
}) {
  return (
    <div className="quotation-adapter-group">
      <div className="quotation-adapter-heading">
        <h3 className="quotation-row-concept">{block.title}</h3>
        <span className={`quotation-row-price${block.pending ? ' quotation-price-pending' : ''}`}>
          {block.amounts.map((amount) => <span key={amount}>{amount}</span>)}
        </span>
      </div>
      <ul className="quotation-rows quotation-adapter-variants">
        {block.items.map((item, index) => (
          <li key={item.row.id} className="quotation-adapter-variant-row">
            <button
              type="button"
              className="quotation-adapter-variant"
              data-row-id={item.row.id}
              onClick={() => onEditRow(item.row.id)}
              aria-label={`Editar aros adaptadores: ${block.details[index]}`}
              title="Tocá para editar esta variante"
            >
              {adapterVariantDescription(item)}
            </button>
            <button
              type="button"
              className={`quotation-row-price quotation-adapter-price${item.errors.length ? ' quotation-price-pending' : ''}`}
              data-row-price-id={item.row.id}
              onClick={() => onEditPrice(item.row.id)}
              aria-label={`Editar precio unitario de aros adaptadores: ${block.details[index]}`}
              title="Tocá para editar sólo el precio unitario de esta variante"
            >
              {adapterVariantAmount(item)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PreviewItems({
  items, onEditRow, onEditPrice,
}: {
  items: QuotationPresentationItem[]
  onEditRow: (rowId: string) => void
  onEditPrice: (rowId: string) => void
}) {
  return (
    <ul className="quotation-rows">
      {items.map((item) => (
        <li key={item.kind === 'row' ? item.item.row.id : item.items[0].row.id}>
          {item.kind === 'adapters' ? (
            <PreviewAdapterGroup block={item} onEditRow={onEditRow} onEditPrice={onEditPrice} />
          ) : (
            <PreviewRow
              row={item.item.row}
              calculated={item.item}
              onEdit={() => onEditRow(item.item.row.id)}
              onEditPrice={() => onEditPrice(item.item.row.id)}
            />
          )}
        </li>
      ))}
    </ul>
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
  notices,
  exchangeDetails,
}: QuotationPreviewProps) {
  const calculation = calculateQuotation(quotation)

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
            const freeRows = sectionRows.filter(({ row }) => !readAudioCategory(row.audioCategory, section))
            return (
              <section className="quotation-section" key={section} aria-label={label}>
                <h2 className="quotation-section-title">{label}</h2>
                {getAudioCategories(section).map((category) => {
                  const categoryRows = sectionRows.filter(({ row }) => row.audioCategory === category.id)
                  const items = buildQuotationPresentation(categoryRows)
                  return (
                    <div className="quotation-audio-category" key={category.id} data-audio-category={category.id}>
                      {categoryRows.length === 0 ? (
                        <button
                          type="button"
                          className="quotation-empty-row"
                          data-audio-category={category.id}
                          onClick={() => onAddRow(section, category.id)}
                          aria-label={`Agregar ${category.label}`}
                        >
                          <span aria-hidden="true">+</span> {category.label}
                        </button>
                      ) : (
                        <>
                          {section === 'equipment' && (
                            <h3 className="quotation-category-label">{category.label}</h3>
                          )}
                          <PreviewItems items={items} onEditRow={onEditRow} onEditPrice={onEditPrice} />
                          {hasRepeatCategoryAction(category.id) && (
                            <button
                              type="button"
                              className="quotation-category-add"
                              data-audio-category={category.id}
                              onClick={() => onAddRow(section, category.id)}
                              aria-label={`Agregar ${category.label}`}
                            >
                              <span aria-hidden="true">+</span> {category.label}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
                {freeRows.length > 0 && (
                  <PreviewItems items={buildQuotationPresentation(freeRows)} onEditRow={onEditRow} onEditPrice={onEditPrice} />
                )}
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
          <span className="quotation-total-label">TOTAL</span>
          {(['ARS', 'USD'] as const).map((currency) => {
            const cents = calculation.totals[currency]
            return (
              <div className="quotation-converted-total" key={currency}>
                <span className="quotation-total-currency">{currency}</span>
                <span className={cents === null ? 'quotation-total-pending' : 'quotation-total-amount'}>
                  {cents === null ? 'Pendiente' : formatMoney(cents, currency).slice(currency.length + 1)}
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
