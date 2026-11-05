import type { CSSProperties } from 'react'
import { calculateQuotation, formatMoney } from '../quotation/calculation'
import { exchangeRateDescription } from '../quotation/exchange-quote'
import { QUOTATION_GRAPHIC } from '../quotation/graphic'
import type { Quotation, RowSection } from '../quotation/model'
import { presentQuotationRow } from '../quotation/presentation'
import './board-screen.css'

interface BoardQuotationThumbnailProps {
  quotation: Quotation
}

const sections: { id: RowSection; label: string }[] = [
  { id: 'equipment', label: 'EQUIPAMIENTO' },
  { id: 'extras', label: 'INSTALACIÓN Y ACCESORIOS' },
]

const graphicStyle = {
  '--board-yellow': QUOTATION_GRAPHIC.yellow,
  '--board-black': QUOTATION_GRAPHIC.black,
} as CSSProperties

export function BoardQuotationThumbnail({ quotation }: BoardQuotationThumbnailProps) {
  const calculation = calculateQuotation(quotation)
  const discount = calculation.discount

  return (
    <article className="board-thumbnail" style={graphicStyle} aria-label={`Vista previa de ${quotation.title.trim() || 'presupuesto sin título'}`}>
      <header className="board-thumbnail-header">
        <div className="board-thumbnail-brand">
          <img src={QUOTATION_GRAPHIC.logoUrl} width="670" height="76" alt="Luquisound" />
          <span>PRESUPUESTO<br />DE AUDIO</span>
        </div>
        <h3>{quotation.title.trim() || 'TÍTULO PENDIENTE'}</h3>
        {quotation.subtitle.trim() && <p>{quotation.subtitle.trim()}</p>}
      </header>
      <div className="board-thumbnail-content">
        {sections.map((section) => {
          const rows = calculation.rows.filter(({ row }) => row.section === section.id)
          if (rows.length === 0) return null
          return (
            <section className="board-thumbnail-section" key={section.id}>
              <h4>{section.label}</h4>
              <dl className="board-thumbnail-rows">
                {rows.map((item) => {
                  const presentation = presentQuotationRow(item)
                  const amount = item.errors.length > 0 || item.lineTotalCents === null
                    ? 'Pendiente'
                    : item.row.priceState === 'included'
                      ? 'Incluido'
                      : formatMoney(item.lineTotalCents, item.row.currency)
                  return (
                    <div className="board-thumbnail-row" key={item.row.id}>
                      <dt>
                        <span>{presentation.concept}</span>
                        {presentation.detail && <span className="board-thumbnail-detail">{presentation.detail}</span>}
                        {presentation.quantity && <span className="board-thumbnail-detail">{presentation.quantity}</span>}
                      </dt>
                      <dd>{amount}</dd>
                    </div>
                  )
                })}
              </dl>
            </section>
          )
        })}
        {calculation.rows.length === 0 && <p className="board-thumbnail-empty">Sin conceptos todavía</p>}
        {quotation.notes.trim() && <p className="board-thumbnail-notes">{quotation.notes.trim()}</p>}
      </div>
      <div className="board-thumbnail-totals">
        {discount && (
          <div className="board-thumbnail-discount">
            <span>Descuento en equipos · {discount.percentage} %</span>
            {(['ARS', 'USD'] as const).filter((currency) => discount.eligibleTotals[currency] > 0).map((currency) => (
              <span key={currency}>− {formatMoney(discount.amounts[currency], currency)}</span>
            ))}
          </div>
        )}
        <span className="board-thumbnail-total-label">TOTAL</span>
        {(['ARS', 'USD'] as const).map((currency) => {
          const amount = calculation.totals[currency]
          return <p className="board-thumbnail-total" key={currency}>{amount === null ? `${currency === 'ARS' ? '$' : 'usd'} Pendiente` : formatMoney(amount, currency)}</p>
        })}
        <p className="board-thumbnail-rate">{exchangeRateDescription(quotation)}</p>
      </div>
      <footer className="board-thumbnail-footer"><span>11 7358-1958</span><span>@luquisound.ok</span></footer>
    </article>
  )
}
