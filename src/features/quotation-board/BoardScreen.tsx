import { useEffect, useId, useRef, useState } from 'react'
import { calculateQuotation } from '../quotation/calculation'
import { BoardQuotationThumbnail } from './BoardQuotationThumbnail'
import type { BoardCardEntry, BoardCategory } from './board-types'
import './board-screen.css'

interface BoardScreenProps {
  categories: readonly BoardCategory[]
  entries: readonly BoardCardEntry[]
  activeEntryId: string | null
  onOpen: (id: string) => void
  onBack: () => void
  onNew: () => void
  loading?: boolean
  error?: string | null
  openingEntryId?: string | null
  onRefresh?: () => void
  onLoadPreview?: (id: string) => Promise<unknown>
  previewErrors?: ReadonlySet<string>
}

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires',
})

function searchKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR').trim()
}

function updatedLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Fecha sin registrar' : `Actualizado el ${dateFormatter.format(date)}`
}

function EntryPreview({ entry, failed, onLoad }: {
  entry: BoardCardEntry
  failed: boolean
  onLoad?: (id: string) => Promise<unknown>
}) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (entry.quotation || failed || !onLoad || !container.current) return
    const observer = new IntersectionObserver((observations) => {
      if (!observations.some((observation) => observation.isIntersecting)) return
      observer.disconnect()
      void onLoad(entry.id).catch(() => undefined)
    }, { rootMargin: '160px' })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [entry.id, entry.quotation, failed, onLoad])
  return <div ref={container} className="board-entry-preview" aria-hidden="true">
    {entry.quotation ? <BoardQuotationThumbnail quotation={entry.quotation} />
      : <p className="board-preview-placeholder">{failed ? 'Abrí el presupuesto para cargar su vista previa.' : 'Cargando vista previa…'}</p>}
  </div>
}

export function BoardScreen({
  categories, entries, activeEntryId, onOpen, onBack, onNew, loading = false, error,
  openingEntryId, onRefresh, onLoadPreview, previewErrors,
}: BoardScreenProps) {
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const searchId = useId()
  const categoryId = useId()
  const headingId = useId()
  const categoryIds = new Set(categories.map((category) => category.id))
  const groups = [
    ...categories.toSorted((left, right) => left.name.localeCompare(right.name, 'es-AR')).map((category) => ({
      key: `category:${category.id}`,
      name: category.name,
      entries: entries.filter((entry) => entry.categoryId === category.id),
    })),
    {
      key: 'uncategorized',
      name: 'Sin categoría',
      entries: entries.filter((entry) => entry.categoryId === null || !categoryIds.has(entry.categoryId)),
    },
  ]
  const normalizedQuery = searchKey(query)
  const visibleGroups = groups.filter((group) => !categoryFilter || group.key === categoryFilter).map((group) => ({
    ...group,
    entries: group.entries.filter((entry) => searchKey(`${entry.name} ${entry.quotation?.title ?? entry.title ?? ''} ${entry.quotation?.subtitle ?? entry.subtitle ?? ''}`).includes(normalizedQuery))
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  })).filter((group) => group.entries.length > 0)
  const resultCount = visibleGroups.reduce((count, group) => count + group.entries.length, 0)

  function clearFilters() {
    setQuery('')
    setCategoryFilter('')
  }

  return (
    <main className="quotation-board" aria-labelledby={headingId}>
      <header className="board-heading">
        <div className="board-heading-copy">
          <p className="board-eyebrow">LUQUISOUND</p>
          <h1 id={headingId} tabIndex={-1}>Tablero de presupuestos</h1>
          <p>Plantillas y presupuestos para seguir editando.</p>
        </div>
        <div className="board-heading-actions">
          <button type="button" className="button secondary" onClick={onBack}>Volver al presupuesto</button>
          <button type="button" className="button primary" onClick={onNew}>Nuevo presupuesto</button>
        </div>
      </header>

      {loading && <p className="board-service-notice" role="status">Cargando tablero…</p>}
      {error && <div className="board-service-notice" role="alert"><p>{error}</p>{onRefresh && <button className="button secondary" type="button" onClick={onRefresh} disabled={loading}>Reintentar</button>}</div>}

      <div className="board-toolbar">
        <div className="board-search-field">
          <label htmlFor={searchId}>Buscar presupuesto</label>
          <input id={searchId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, título o vehículo" autoComplete="off" />
        </div>
        <div className="board-category-field">
          <label htmlFor={categoryId}>Categoría</label>
          <select id={categoryId} value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="">Todas ({entries.length})</option>
            {groups.map((group) => <option key={group.key} value={group.key}>{group.name} ({group.entries.length})</option>)}
          </select>
        </div>
      </div>
      <p className="board-result-count" role="status">{resultCount === 1 ? '1 presupuesto' : `${resultCount} presupuestos`}{normalizedQuery || categoryFilter ? resultCount === 1 ? ' encontrado' : ' encontrados' : ' en el tablero'}</p>

      <div className="board-sections">
        {visibleGroups.map((group) => (
          <section className="board-category-section" key={group.key} aria-label={group.name}>
            <div className="board-category-heading"><h2>{group.name}</h2><span>{group.entries.length}</span></div>
            <ul className="board-entry-grid">
              {group.entries.map((entry) => {
                const active = entry.id === activeEntryId
                const pending = entry.quotation ? !calculateQuotation(entry.quotation).canExport : entry.pending === true
                return (
                  <li className={`board-entry-card${active ? ' board-entry-active' : ''}`} key={entry.id}>
                    <EntryPreview entry={entry} failed={previewErrors?.has(entry.id) ?? false} onLoad={onLoadPreview} />
                    <div className="board-entry-caption">
                      <div className="board-entry-state">{pending && <span className="board-entry-pending">Por completar</span>}{active && <span className="board-entry-current">En edición</span>}</div>
                      <h3>{entry.name}</h3>
                      <p>{updatedLabel(entry.updatedAt)}</p>
                      <span className="board-entry-open-label">{openingEntryId === entry.id ? 'Abriendo…' : 'Abrir presupuesto'}</span>
                    </div>
                    <button type="button" className="board-entry-open" disabled={openingEntryId != null} onClick={() => onOpen(entry.id)} aria-label={`Abrir ${entry.name}${pending ? ', por completar' : ''}${active ? ', en edición' : ''}`} />
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      {resultCount === 0 && !loading && !error && (
        <div className="board-empty">
          <h2>{entries.length === 0 ? 'Tu tablero empieza acá' : 'No encontramos presupuestos'}</h2>
          <p>{entries.length === 0 ? 'Armá un presupuesto y guardalo para volver a usarlo, incluso si está incompleto.' : 'Probá con otro nombre o revisá la categoría seleccionada.'}</p>
          {entries.length === 0
            ? <button type="button" className="button primary" onClick={onNew}>Nuevo presupuesto</button>
            : <button type="button" className="button secondary" onClick={clearFilters}>Limpiar filtros</button>}
        </div>
      )}
    </main>
  )
}
