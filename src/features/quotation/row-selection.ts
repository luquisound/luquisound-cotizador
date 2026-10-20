import type { CatalogItem, Currency, QuotationRow } from './model.ts'
import { rowFromCatalog } from './row-provenance.ts'
import { isFixedServiceRow } from './fixed-services.ts'
import { isHarnessPresetRow } from './harness-preset.ts'

export function selectCatalogForRow(
  draft: QuotationRow, item: CatalogItem, defaultCurrency: Currency, now = Date.now(),
): QuotationRow {
  const selected = rowFromCatalog(item, draft.section, defaultCurrency, draft.audioCategory, now)
  return {
    ...selected, id: draft.id, quantity: isFixedServiceRow(draft) ? '1' : draft.quantity,
    ...(isHarnessPresetRow(draft) ? { harnessSelection: { ...draft.harnessSelection! } } : {}),
  }
}
