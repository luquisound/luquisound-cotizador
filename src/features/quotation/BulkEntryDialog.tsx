import { useMemo, useState, type FormEvent } from 'react'
import {
  applyBulkEntry, buildBulkEntryPreview, createBulkEntryDecisions, findBulkEntryDuplicates,
  BULK_ENTRY_MAX_CHARACTERS, BULK_ENTRY_MAX_LINES,
  type BulkEntryDecision, type BulkEntryLine, type BulkEntryPreview,
} from './bulk-entry.ts'
import { resolveCatalogQuery, type CatalogSelectionPredicate } from './catalog-search.ts'
import { CatalogAvailability } from './CatalogAvailability.tsx'
import { getCatalogQuotationTitle } from './catalog-title.ts'
import type { CatalogItem, Currency, QuotationRow, RowSection } from './model.ts'
import { Dialog } from './QuotationDialog.tsx'
import { getCatalogSelectionPrice } from './row-provenance.ts'
import { useCatalogClock } from './useCatalogClock.ts'

export interface BulkEntryDialogProps {
  catalog: readonly CatalogItem[]
  canSelect: CatalogSelectionPredicate
  defaultCurrency: Currency
  existingRowCount: number
  defaultSection?: RowSection
  onApply: (rows: QuotationRow[]) => boolean
  onClose: () => void
}

const CANDIDATE_LIMIT = 20

function candidateLabel(item: CatalogItem): string {
  return [getCatalogQuotationTitle(item), item.sku, item.supplier].filter(Boolean).join(' · ')
}

function resolutionLabel(line: BulkEntryLine): string {
  if (line.resolution.status === 'matched') return line.resolution.matchKind === 'sku' ? 'Código exacto' : 'Nombre exacto'
  if (line.resolution.status === 'blocked') return 'Producto no disponible para seleccionar'
  if (line.resolution.status === 'unmatched') return 'Sin coincidencias: podés crear un concepto manual'
  return 'Revisá y elegí una coincidencia'
}

function priceLabel(item: CatalogItem, defaultCurrency: Currency): string {
  try {
    const price = getCatalogSelectionPrice(item, defaultCurrency)
    if (price.priceBasis === 'pending') return 'Precio pendiente: completalo en el presupuesto.'
    const source = price.priceBasis === 'provisional-list' ? 'Lista histórica provisional'
      : price.priceBasis === 'list' ? 'Precio de lista' : 'Precio del catálogo'
    return `${source}: ${price.currency} ${price.unitPrice}. El importe sigue editable en el presupuesto.`
  } catch {
    return 'El precio del producto requiere revisión antes de agregarlo.'
  }
}

export function BulkEntryDialog({
  catalog, canSelect, defaultCurrency, existingRowCount, defaultSection = 'equipment', onApply, onClose,
}: BulkEntryDialogProps) {
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState<BulkEntryPreview | null>(null)
  const [decisions, setDecisions] = useState<BulkEntryDecision[]>([])
  const [error, setError] = useState('')
  const now = useCatalogClock(catalog)
  const catalogSnapshot = useMemo(() => JSON.stringify(catalog), [catalog])
  const stale = preview !== null && preview.catalogSnapshot !== catalogSnapshot
  const duplicates = preview ? findBulkEntryDuplicates(preview, decisions, catalog) : new Map<number, number>()
  const selectedCount = decisions.filter((decision) => decision.action !== 'skip' && decision.action !== 'unresolved').length
  const availabilityChanged = preview !== null && decisions.some((decision) => {
    if (decision.action === 'catalog') {
      const item = catalog.find((candidate) => candidate.id === decision.itemId)
      return !item || !canSelect(item)
    }
    return decision.action === 'manual' && !resolveCatalogQuery(catalog, decision.concept, canSelect).manualAllowed
  })

  function review(): void {
    try {
      const next = buildBulkEntryPreview(input, catalog, canSelect)
      setPreview(next)
      setDecisions(createBulkEntryDecisions(next, defaultSection))
      setError('')
    } catch (cause: unknown) {
      setPreview(null)
      setDecisions([])
      setError(cause instanceof Error ? cause.message : 'No se pudo revisar la lista.')
    }
  }

  function changeDecision(lineNumber: number, changes: Partial<BulkEntryDecision>): void {
    setDecisions((current) => current.map((decision) => decision.lineNumber === lineNumber
      ? { ...decision, ...changes, confirmDuplicate: false } : decision))
    setError('')
  }

  function choose(line: BulkEntryLine, value: string): void {
    if (value === 'manual') {
      changeDecision(line.lineNumber, { action: 'manual', itemId: null })
    } else if (value === 'skip') {
      changeDecision(line.lineNumber, { action: 'skip', itemId: null })
    } else if (value.startsWith('catalog:')) {
      const item = line.resolution.candidates.find((candidate) => candidate.id === value.slice(8))
      if (item) changeDecision(line.lineNumber, { action: 'catalog', itemId: item.id, section: item.section })
    } else changeDecision(line.lineNumber, { action: 'unresolved', itemId: null })
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!preview) return
    try {
      const rows = applyBulkEntry(preview, decisions, catalog, { canSelect, defaultCurrency, existingRowCount })
      if (onApply(rows)) onClose()
      else setError('No se agregaron los conceptos. Revisá el presupuesto antes de volver a intentar.')
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'No se pudo agregar la lista. El presupuesto se conserva.')
    }
  }

  return (
    <Dialog title="Pegar códigos o nombres" onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <p className="field-help">Un código o nombre por línea, hasta {BULK_ENTRY_MAX_LINES}. Cada concepto empieza con cantidad 1; podés cambiarla en la revisión. Los precios siguen editables en el presupuesto.</p>
        <label>Lista de productos o trabajos
          <textarea autoFocus rows={6} maxLength={BULK_ENTRY_MAX_CHARACTERS} value={input} placeholder={'Código o nombre\nOtro producto\nMano de obra'} onChange={(event) => {
            setInput(event.target.value)
            setPreview(null)
            setDecisions([])
            setError('')
          }} />
        </label>
        <button type="button" className="button secondary" onClick={review}>Revisar lista</button>
        {stale && <p className="notice pending" role="status">El catálogo cambió. Volvé a revisar la lista para confirmar productos y precios.</p>}
        {availabilityChanged && <p className="notice pending" role="status">La disponibilidad de una selección cambió. Volvé a Revisar lista u omití esa línea antes de agregar. Las elecciones se conservan hasta que las revises.</p>}
        {preview && <section className="form-stack" aria-label="Revisión de conceptos">
          <p className="field-help">Elegí las coincidencias pendientes o marcá Omitir. Un concepto manual se agrega sin precio para completarlo después.</p>
          {preview.lines.map((line, index) => {
            const decision = decisions[index]
            if (!decision) return null
            const duplicate = duplicates.get(line.lineNumber)
            const active = decision.action === 'catalog' || decision.action === 'manual'
            const selectedItem = decision.action === 'catalog'
              ? line.resolution.candidates.find((candidate) => candidate.id === decision.itemId) : undefined
            const manualAllowed = line.resolution.manualAllowed && resolveCatalogQuery(catalog, line.query, canSelect).manualAllowed
            return (
              <fieldset className="form-stack" key={line.lineNumber} style={{ minWidth: 0 }}>
                <legend>Línea {line.lineNumber}</legend>
                <p className="field-help" style={{ overflowWrap: 'anywhere' }}>{line.query}</p>
                <p className="field-help">{resolutionLabel(line)}</p>
                {line.resolution.blockedCandidates.length > 0 && <p className="field-help" style={{ overflowWrap: 'anywhere' }}>No disponibles para seleccionar: {line.resolution.blockedCandidates.slice(0, CANDIDATE_LIMIT).map(candidateLabel).join('; ')}{line.resolution.blockedCandidates.length > CANDIDATE_LIMIT ? ` y ${line.resolution.blockedCandidates.length - CANDIDATE_LIMIT} opciones más` : ''}. Podés omitir esta línea; para un trabajo independiente, usá otra línea.</p>}
                <label>Qué agregar
                  <select value={decision.action === 'catalog' ? `catalog:${decision.itemId}` : decision.action === 'unresolved' ? '' : decision.action} onChange={(event) => choose(line, event.target.value)}>
                    <option value="">Elegir una opción</option>
                    {line.resolution.candidates.slice(0, CANDIDATE_LIMIT).map((item) => <option key={item.id} disabled={!canSelect(item)} value={`catalog:${item.id}`}>{candidateLabel(item)}</option>)}
                    {manualAllowed && <option value="manual">Crear concepto manual</option>}
                    <option value="skip">Omitir esta línea</option>
                  </select>
                </label>
                {line.resolution.candidates.length > CANDIDATE_LIMIT && <p className="field-help">Se muestran {CANDIDATE_LIMIT} de {line.resolution.candidates.length} opciones. Afiná el código o agregá el proveedor en la lista y volvé a revisarla.</p>}
                {selectedItem && <>
                  <p className="field-help">{priceLabel(selectedItem, defaultCurrency)}</p>
                  <CatalogAvailability item={selectedItem} now={now} />
                  {!canSelect(selectedItem) && <p className="field-errors">Este producto ya no está habilitado. Volvé a Revisar lista u omití la línea.</p>}
                </>}
                {decision.action === 'manual' && <label>Concepto manual<input maxLength={500} value={decision.concept} onChange={(event) => changeDecision(line.lineNumber, { concept: event.target.value })} /></label>}
                {active && <div className="form-grid">
                  <label>Cantidad<input inputMode="decimal" maxLength={30} value={decision.quantity} onChange={(event) => changeDecision(line.lineNumber, { quantity: event.target.value })} /></label>
                  <label>Sección<select value={decision.section} onChange={(event) => changeDecision(line.lineNumber, { section: event.target.value as RowSection })}><option value="equipment">Equipamiento</option><option value="extras">Instalación y accesorios</option></select></label>
                </div>}
                {duplicate !== undefined && <label className="catalog-confirm-updates"><input type="checkbox" checked={decision.confirmDuplicate} onChange={(event) => {
                  setDecisions((current) => current.map((entry) => entry.lineNumber === line.lineNumber ? { ...entry, confirmDuplicate: event.target.checked } : entry))
                  setError('')
                }} /><span>Repetido respecto de la línea {duplicate}. Quiero agregarlo también; si fue un error, elegí Omitir.</span></label>}
                {line.duplicateOfLine !== null && duplicate === undefined && <p className="field-help">La consulta se repite respecto de la línea {line.duplicateOfLine}. Revisá qué conceptos querés agregar.</p>}
              </fieldset>
            )
          })}
          <p className="field-help" aria-live="polite">{selectedCount} conceptos elegidos. Los cambios se aplican juntos al confirmar.</p>
        </section>}
        {error && <p className="field-errors" role="alert">{error}</p>}
        <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button primary" disabled={!preview || stale || availabilityChanged}>Agregar al presupuesto</button></div>
      </form>
    </Dialog>
  )
}
