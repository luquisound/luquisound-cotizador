import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { DragDropProvider, DragOverlay, useDragDropManager } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { Accessibility, KeyboardSensor, PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom'
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/dom'
import './sortable.css'

export interface SortableListItem {
  id: string
  label: string
  content: ReactNode
  disabled?: boolean
}

export interface SortableListProps {
  items: SortableListItem[]
  onMove: (activeId: string, overId: string) => void
  label: string
  className?: string
  disabled?: boolean
}

const sensors = [
  PointerSensor.configure({
    preventActivation(event, source) {
      const target = event.target
      return event.button !== 0 || !(target instanceof Element)
        || target.closest('[data-sortable-surface]') !== source.element
        || target.closest('.quotation-category-add, .quotation-add-row, .quotation-empty-row, .quotation-sortable-steps, input, select, textarea, a, [contenteditable="true"]') !== null
    },
    activationConstraints(event) {
      return event.pointerType === 'touch'
        ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
        : [new PointerActivationConstraints.Distance({ value: 5 })]
    },
  }),
  KeyboardSensor,
]

const accessibility = Accessibility.configure({
  screenReaderInstructions: {
    draggable: 'Para mover, presioná espacio o Enter, usá las flechas y confirmá con espacio o Enter. Escape cancela. Shift más F10 muestra Subir y Bajar. Con el dedo, mantené presionado y arrastrá; soltá sin mover para ver las opciones.',
  },
  announcements: {
    dragstart({ operation }: DragStartEvent) {
      const label = operation.source?.data.label
      return `Moviendo ${typeof label === 'string' ? label : 'elemento'}.`
    },
    dragover({ operation }: DragOverEvent) {
      const source = operation.source
      return isSortable(source) ? `Posición ${source.index + 1}.` : undefined
    },
    dragend({ canceled, operation }: DragEndEvent) {
      if (canceled || !operation.target) return 'Movimiento cancelado. Se conserva el orden anterior.'
      const source = operation.source
      return isSortable(source) ? `Elemento en la posición ${source.index + 1}.` : 'Movimiento finalizado.'
    },
  },
})

function CancelOnInterruption() {
  const manager = useDragDropManager()
  useEffect(() => {
    if (!manager) return
    const cancel = () => {
      if (manager.dragOperation.status.dragging) manager.actions.stop({ canceled: true })
    }
    const onVisibilityChange = () => {
      if (document.hidden) cancel()
    }
    window.addEventListener('blur', cancel)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('blur', cancel)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [manager])
  return null
}

function SortableItem({
  item, index, group, helpId, disabled, expanded, onOpen, onClose, onStep, onClickCapture, hasPrevious, hasNext,
}: {
  item: SortableListItem
  index: number
  group: string
  helpId: string
  disabled: boolean
  expanded: boolean
  onOpen: () => void
  onClose: () => void
  onStep: (direction: -1 | 1) => void
  onClickCapture: (event: MouseEvent<HTMLLIElement>) => void
  hasPrevious: boolean
  hasNext: boolean
}) {
  const element = useRef<HTMLLIElement | null>(null)
  const { ref, isDragSource, isDropTarget } = useSortable({
    id: item.id, index, group, type: group, accept: group,
    data: { label: item.label }, disabled, transition: null,
  })
  const setElement = useCallback((node: HTMLLIElement | null) => {
    element.current = node
    ref(node)
  }, [ref])

  function step(direction: -1 | 1) {
    onStep(direction)
    window.requestAnimationFrame(() => element.current?.focus({ preventScroll: true }))
  }

  useEffect(() => {
    if (expanded) element.current?.querySelector<HTMLButtonElement>('.quotation-sortable-steps button:not(:disabled)')?.focus()
  }, [expanded])

  return (
    <li
      ref={setElement}
      className={`quotation-sortable-item${isDragSource ? ' is-drag-source' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
      data-sortable-id={item.id}
      data-sortable-surface={disabled ? undefined : group}
      tabIndex={disabled ? undefined : 0}
      aria-label={disabled ? undefined : `Mover ${item.label}`}
      aria-describedby={disabled ? undefined : helpId}
      onClickCapture={onClickCapture}
      onContextMenu={(event) => {
        if (disabled || (event.target as Element).closest('[data-sortable-surface]') !== event.currentTarget
          || (event.target as Element).closest('.quotation-category-add, .quotation-add-row, .quotation-empty-row')) return
        event.preventDefault()
        event.stopPropagation()
        onOpen()
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onClose()
      }}
      onKeyDown={(event) => {
        if (disabled || (event.target as Element).closest('[data-sortable-surface]') !== event.currentTarget) return
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault()
          event.stopPropagation()
          onOpen()
        } else if (event.key === 'Escape' && expanded) {
          event.stopPropagation()
          onClose()
          element.current?.focus({ preventScroll: true })
        }
      }}
    >
      <div className="quotation-sortable-content">{item.content}</div>
      {expanded && !disabled && (
        <div className="quotation-sortable-steps" role="group" aria-label={`Cambiar posición de ${item.label}`}>
          <button type="button" disabled={!hasPrevious} onClick={() => step(-1)} aria-label={`Subir ${item.label}`}>↑ Subir</button>
          <button type="button" disabled={!hasNext} onClick={() => step(1)} aria-label={`Bajar ${item.label}`}>↓ Bajar</button>
        </div>
      )}
    </li>
  )
}

export function SortableList({ items, onMove, label, className = '', disabled = false }: SortableListProps) {
  const group = useId()
  const helpId = `${group}-help`
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const snapshot = useRef<string[]>([])
  const suppressClickUntil = useRef(0)
  const dragSourceId = useRef<string | null>(null)
  const canSort = !disabled && items.filter((item) => !item.disabled).length > 1

  function neighbor(index: number, direction: -1 | 1): SortableListItem | undefined {
    for (let position = index + direction; position >= 0 && position < items.length; position += direction) {
      if (!items[position].disabled) return items[position]
    }
    return undefined
  }

  if (!canSort) {
    return (
      <ul className={`quotation-sortable-list ${className}`} aria-label={label}>
        {items.map((item) => <li key={item.id} data-sortable-id={item.id}>{item.content}</li>)}
      </ul>
    )
  }

  return (
    <DragDropProvider
      sensors={sensors}
      plugins={(defaults) => [...defaults.filter((plugin) => plugin !== Accessibility), accessibility]}
      onDragStart={({ operation }) => {
        snapshot.current = items.map((item) => item.id)
        dragSourceId.current = operation.source ? String(operation.source.id) : null
        suppressClickUntil.current = Infinity
        setExpandedId(null)
      }}
      onDragEnd={(event) => {
        suppressClickUntil.current = Date.now() + 350
        const { source, target } = event.operation
        if (isSortable(source) && source.group === group) {
          const sourceElement = source.element
          // Feedback restores the source asynchronously; focus it after cleanup.
          window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
            if (sourceElement instanceof HTMLElement && sourceElement.isConnected) {
              sourceElement.focus({ preventScroll: true })
            }
          }))
        }
        if (event.canceled || !target || !isSortable(source) || source.group !== group) return
        const unchangedItems = snapshot.current.length === items.length
          && snapshot.current.every((id, index) => id === items[index].id)
        if (!unchangedItems) return
        if (source.initialIndex === source.index) {
          const activator = event.operation.activatorEvent
          if (target.id === source.id && activator instanceof PointerEvent && activator.pointerType === 'touch') {
            setExpandedId(String(source.id))
          }
          return
        }
        const destination = items[source.index]
        if (destination && !destination.disabled && destination.id !== source.id) {
          onMove(String(source.id), destination.id)
        }
      }}
    >
      <CancelOnInterruption />
      <p id={helpId} className="sr-only">Arrastrá directamente el ítem. En móvil, mantené presionado antes de mover; un toque breve edita. Clic derecho, Shift más F10 o mantener y soltar sin mover muestra Subir y Bajar. Espacio o Enter inicia y confirma, las flechas mueven y Escape cancela.</p>
      <ul className={`quotation-sortable-list ${className}`} aria-label={label}>
        {items.map((item, index) => (
          <SortableItem
            key={item.id}
            item={item}
            index={index}
            group={group}
            helpId={helpId}
            disabled={item.disabled === true}
            expanded={expandedId === item.id}
            onOpen={() => setExpandedId(item.id)}
            onClickCapture={(event) => {
              const target = event.target
              if (event.detail > 0 && Date.now() < suppressClickUntil.current
                && item.id === dragSourceId.current && target instanceof Element
                && target.closest('[data-sortable-surface]') === event.currentTarget
                && !target.closest('.quotation-sortable-steps')) {
                event.preventDefault()
                event.stopPropagation()
              }
            }}
            onClose={() => setExpandedId((current) => current === item.id ? null : current)}
            hasPrevious={neighbor(index, -1) !== undefined}
            hasNext={neighbor(index, 1) !== undefined}
            onStep={(direction) => {
              const destination = neighbor(index, direction)
              if (!destination) return
              onMove(item.id, destination.id)
              setExpandedId(null)
              setMessage(`${item.label}: posición ${items.indexOf(destination) + 1} de ${items.length}.`)
            }}
          />
        ))}
      </ul>
      {/* Keep the registered overlay mounted until the feedback plugin restores the source DOM. */}
      <DragOverlay className="quotation-sortable-overlay" dropAnimation={null}>
        {(source) => <span>{typeof source.data.label === 'string' ? source.data.label : 'Mover elemento'}</span>}
      </DragOverlay>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{message}</p>
    </DragDropProvider>
  )
}
