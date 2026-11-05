import { useId, useRef, useState, type FormEvent } from 'react'
import { Dialog } from '../quotation/QuotationDialog'
import type { Quotation } from '../quotation/model'
import type { BoardCategory, BoardEntry, BoardSaveRequest } from './board-types'
import './save-quotation-dialog.css'

interface SaveQuotationDialogProps {
  quotation: Quotation
  categories: readonly BoardCategory[]
  source: Pick<BoardEntry, 'name' | 'categoryId'> | null
  onClose: () => void
  onSave: (request: BoardSaveRequest) => void
  error?: string
  saving?: boolean
  canReplace?: boolean
  pendingSave?: boolean
  initialDraft?: BoardSaveRequest
  onRetryPending?: () => void
}

interface FieldErrors {
  name?: string
  category?: string
  newCategory?: string
}

function normalizedCategoryName(value: string): string {
  return value.trim().normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('es-AR')
}

export function SaveQuotationDialog({
  quotation, categories, source, onClose, onSave, error, saving = false, canReplace = true,
  pendingSave = false, initialDraft, onRetryPending,
}: SaveQuotationDialogProps) {
  const [name, setName] = useState(() => initialDraft?.name ?? source?.name
    ?? (/^presupuesto$/i.test(quotation.title.trim()) ? '' : quotation.title.trim()))
  const [categoryId, setCategoryId] = useState<string | null>(initialDraft ? initialDraft.categoryId : source?.categoryId ?? null)
  const [creatingCategory, setCreatingCategory] = useState(initialDraft?.newCategoryName !== undefined)
  const [newCategoryName, setNewCategoryName] = useState(initialDraft?.newCategoryName ?? '')
  const [errors, setErrors] = useState<FieldErrors>({})
  const nameInput = useRef<HTMLInputElement>(null)
  const categorySelect = useRef<HTMLSelectElement>(null)
  const newCategoryInput = useRef<HTMLInputElement>(null)
  const nameHelpId = useId()
  const nameErrorId = useId()
  const categoryHelpId = useId()
  const categoryErrorId = useId()
  const newCategoryErrorId = useId()
  const selectedCategoryUnavailable = categoryId !== null && !categories.some((category) => category.id === categoryId)
  const categoryValue = creatingCategory ? 'new' : categoryId === null ? 'none' : `category:${categoryId}`

  function save(mode: BoardSaveRequest['mode']) {
    if (saving || pendingSave) return
    const nextErrors: FieldErrors = {}
    const savedName = name.trim()
    const categoryName = newCategoryName.trim()
    if (!savedName || savedName.length > 120) nextErrors.name = 'Ingresá un nombre de hasta 120 caracteres.'
    if (creatingCategory) {
      if (!categoryName || categoryName.length > 80) nextErrors.newCategory = 'Ingresá una categoría de hasta 80 caracteres.'
      else if (categories.some((category) => normalizedCategoryName(category.name) === normalizedCategoryName(categoryName))) {
        nextErrors.newCategory = 'Esa categoría ya existe. Seleccionala en la lista.'
      }
    } else if (selectedCategoryUnavailable) {
      nextErrors.category = 'Elegí una categoría disponible o Sin categoría.'
    }
    setErrors(nextErrors)
    if (nextErrors.name) nameInput.current?.focus()
    else if (nextErrors.newCategory) newCategoryInput.current?.focus()
    else if (nextErrors.category) categorySelect.current?.focus()
    if (Object.keys(nextErrors).length > 0) return
    onSave({
      mode,
      name: savedName,
      categoryId: creatingCategory ? null : categoryId,
      ...(creatingCategory ? { newCategoryName: categoryName } : {}),
    })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pendingSave) { if (!saving) onRetryPending?.(); return }
    save(source && canReplace ? 'replace' : 'new')
  }

  function changeCategory(value: string) {
    setCreatingCategory(value === 'new')
    if (value !== 'new') setCategoryId(value === 'none' ? null : value.slice('category:'.length))
    setErrors((previous) => ({ ...previous, category: undefined, newCategory: undefined }))
  }

  return (
    <Dialog title="Guardar en tablero" className="board-save-dialog" onClose={onClose}>
      <form className="form-stack board-save-form" noValidate aria-busy={saving} onSubmit={submit}>
        <div className="form-stack board-save-content">
          <p className="field-help">Podés guardar un presupuesto incompleto y seguir armándolo después.</p>
          <label>Nombre en el tablero
            <input
              ref={nameInput} data-editor-autofocus="true" value={name} required maxLength={120}
              disabled={saving || pendingSave} autoComplete="off" placeholder="Por ejemplo, Audio Auto básico"
              aria-invalid={Boolean(errors.name)} aria-describedby={`${nameHelpId}${errors.name ? ` ${nameErrorId}` : ''}`}
              onChange={(event) => {
                setName(event.target.value)
                setErrors((previous) => ({ ...previous, name: undefined }))
              }}
            />
          </label>
          <p id={nameHelpId} className="field-help">Este nombre identifica la ficha. El título del presupuesto para el cliente se conserva.</p>
          {errors.name && <p id={nameErrorId} className="field-errors" role="alert">{errors.name}</p>}
          <label>Categoría (opcional)
            <select
              ref={categorySelect} value={categoryValue} disabled={saving || pendingSave}
              aria-invalid={Boolean(errors.category)} aria-describedby={`${categoryHelpId}${errors.category ? ` ${categoryErrorId}` : ''}`}
              onChange={(event) => changeCategory(event.target.value)}
            >
              <option value="none">Sin categoría</option>
              {categories.map((category) => <option key={category.id} value={`category:${category.id}`}>{category.name}</option>)}
              {selectedCategoryUnavailable && <option value={`category:${categoryId}`} disabled>Categoría no disponible</option>}
              <option value="new">Crear nueva categoría…</option>
            </select>
          </label>
          <p id={categoryHelpId} className="field-help">Elegí dónde agruparlo. También podés dejarlo sin categoría.</p>
          {errors.category && <p id={categoryErrorId} className="field-errors" role="alert">{errors.category}</p>}
          {creatingCategory && <>
            <label>Nombre de la nueva categoría
              <input
                ref={newCategoryInput} value={newCategoryName} required maxLength={80} disabled={saving || pendingSave}
                autoComplete="off" placeholder="Por ejemplo, Pantallas" aria-invalid={Boolean(errors.newCategory)}
                aria-describedby={errors.newCategory ? newCategoryErrorId : undefined}
                onChange={(event) => {
                  setNewCategoryName(event.target.value)
                  setErrors((previous) => ({ ...previous, newCategory: undefined }))
                }}
              />
            </label>
            {errors.newCategory && <p id={newCategoryErrorId} className="field-errors" role="alert">{errors.newCategory}</p>}
          </>}
          {pendingSave && <p className="board-save-source-help">No se pudo confirmar el guardado anterior. Reintentá esa misma operación antes de guardar otra versión. Los cambios posteriores seguirán pendientes.</p>}
          {source && !pendingSave && <p className="board-save-source-help">{canReplace
            ? `Reemplazar actualiza «${source.name}». Guardar como nuevo conserva esa ficha y crea otra con el nombre y la categoría elegidos.`
            : `La ficha «${source.name}» cambió o ya no está disponible para reemplazarla desde esta versión. Podés conservar tu trabajo guardándolo como nuevo.`}</p>}
          {error && <p className="field-errors" role="alert">{error}</p>}
        </div>
        <div className="dialog-actions board-save-actions">
          <button className="button secondary" type="button" disabled={saving} onClick={onClose}>Cancelar</button>
          {source && canReplace && !pendingSave && <button className="button secondary" type="button" disabled={saving} onClick={() => save('new')}>Guardar como nuevo</button>}
          <button className="button primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : pendingSave ? 'Reintentar guardado' : source ? canReplace ? 'Reemplazar' : 'Guardar como nuevo' : 'Guardar en tablero'}</button>
        </div>
      </form>
    </Dialog>
  )
}
