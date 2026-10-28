import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
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
    draggable: 'Para mover, presioná espacio o Enter, usá las flechas y confirmá con espacio o Enter. Escape cancela. También podés tocar el control para subir o bajar.',
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
  item, index, group, helpId, disabled, expanded, onToggle, onClose, onStep, hasPrevious, hasNext,
}: {
  item: SortableListItem
  index: number
  group: string
  helpId: string
  disabled: boolean
  expanded: boolean
  onToggle: () => void
  onClose: () => void
  onStep: (direction: -1 | 1) => void
  hasPrevious: boolean
  hasNext: boolean
}) {
  const handleButton = useRef<HTMLButtonElement | null>(null)
  const { ref, handleRef, isDragSource, isDropTarget } = useSortable({
    id: item.id, index, group, type: group, accept: group,
    data: { label: item.label }, disabled, transition: null,
  })

  function step(direction: -1 | 1) {
    onStep(direction)
    window.requestAnimationFrame(() => handleButton.current?.focus({ preventScroll: true }))
  }

  return (
    <li
      ref={ref}
      className={`quotation-sortable-item${isDragSource ? ' is-drag-source' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
      data-sortable-id={item.id}
    >
      {!disabled && (
        <div
          className="quotation-sortable-controls"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) onClose()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && expanded) {
              event.stopPropagation()
              onClose()
            }
          }}
        >
          <button
            type="button"
            ref={(element) => {
              handleButton.current = element
              handleRef(element)
            }}
            className="quotation-sortable-handle"
            data-sortable-handle={item.id}
            aria-label={`Mover ${item.label}`}
            aria-describedby={helpId}
            aria-expanded={expanded}
            onClick={onToggle}
            title="Mantené presionado y arrastrá, o tocá para subir o bajar"
          >
            <svg viewBox="0 0 20 24" width="16" height="22" fill="currentColor" aria-hidden="true">
              {[5, 12, 19].flatMap((cy) => [6, 14].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" />))}
            </svg>
          </button>
          {expanded && (
            <div className="quotation-sortable-steps" role="group" aria-label={`Cambiar posición de ${item.label}`}>
              <button type="button" disabled={!hasPrevious} onClick={() => step(-1)} aria-label={`Subir ${item.label}`}>↑ Subir</button>
              <button type="button" disabled={!hasNext} onClick={() => step(1)} aria-label={`Bajar ${item.label}`}>↓ Bajar</button>
            </div>
          )}
        </div>
      )}
      <div className="quotation-sortable-content">{item.content}</div>
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
      onDragStart={() => {
        snapshot.current = items.map((item) => item.id)
        suppressClickUntil.current = Infinity
        setExpandedId(null)
      }}
      onDragEnd={(event) => {
        suppressClickUntil.current = Date.now() + 350
        const { source, target } = event.operation
        if (isSortable(source) && source.group === group) {
          const sourceHandle = source.handle
          // Feedback restores the source asynchronously; focus its actual handle after cleanup.
          window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
            if (sourceHandle instanceof HTMLElement && sourceHandle.isConnected) {
              sourceHandle.focus({ preventScroll: true })
            }
          }))
        }
        if (event.canceled || !target || !isSortable(source) || source.group !== group) return
        const unchangedItems = snapshot.current.length === items.length
          && snapshot.current.every((id, index) => id === items[index].id)
        if (!unchangedItems || source.initialIndex === source.index) return
        const destination = items[source.index]
        if (destination && !destination.disabled && destination.id !== source.id) {
          onMove(String(source.id), destination.id)
        }
      }}
    >
      <CancelOnInterruption />
      <p id={helpId} className="sr-only">Mantené presionado el agarre para arrastrar. Tocá para mostrar Subir y Bajar. Con teclado, espacio o Enter inicia y confirma, las flechas mueven y Escape cancela.</p>
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
            onToggle={() => {
              if (Date.now() >= suppressClickUntil.current) setExpandedId(expandedId === item.id ? null : item.id)
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
