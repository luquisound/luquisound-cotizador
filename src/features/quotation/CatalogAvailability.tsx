import { describeCatalogAvailability } from './quotation-availability.ts'
import type { CatalogItem } from './model.ts'

interface CatalogAvailabilityProps {
  item: CatalogItem
  now: number
}

export function CatalogAvailability({ item, now }: CatalogAvailabilityProps) {
  const description = describeCatalogAvailability(item, now)
  return <span className={`catalog-availability field-help${description.blocked ? ' danger' : ''}`}>
    <span>{description.quantityLabel} · {description.ageLabel} · {description.selectionLabel}</span>
    {description.provisional && <span> · Fuente histórica provisional</span>}
    {(item.source || item.stock) && <span> · {description.sourceDateLabel}</span>}
  </span>
}
