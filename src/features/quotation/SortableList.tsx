import { useEffect, useId, useRef } from 'react'
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
        || target.closest('.quotation-category-add, .quotation-add-row, .quotation-empty-row, input, select, textarea, a, [contenteditable="true"]') !== null
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
    draggable: 'Para mover, presioná espacio o Enter, usá las flechas y confirmá con espacio o Enter. Escape cancela. Con el dedo, mantené presionado y arrastrá.',
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
  item, index, group, helpId, disabled, onClickCapture,
}: {
  item: SortableListItem
  index: number
  group: string
  helpId: string
  disabled: boolean
  onClickCapture: (event: MouseEvent<HTMLLIElement>) => void
}) {
  const { ref, isDragSource, isDropTarget } = useSortable({
    id: item.id, index, group, type: group, accept: group,
    data: { label: item.label }, disabled, transition: null,
  })

  return (
    <li
      ref={ref}
      className={`quotation-sortable-item${isDragSource ? ' is-drag-source' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
      data-sortable-id={item.id}
      data-sortable-surface={disabled ? undefined : group}
      tabIndex={disabled ? undefined : 0}
      aria-label={disabled ? undefined : `Mover ${item.label}`}
      aria-describedby={disabled ? undefined : helpId}
      onClickCapture={onClickCapture}
    >
      <div className="quotation-sortable-content">{item.content}</div>
    </li>
  )
}

export function SortableList({ items, onMove, label, className = '', disabled = false }: SortableListProps) {
  const group = useId()
  const helpId = `${group}-help`
  const snapshot = useRef<string[]>([])
  const suppressClickUntil = useRef(0)
  const dragSourceId = useRef<string | null>(null)
  const canSort = !disabled && items.filter((item) => !item.disabled).length > 1

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
        if (!unchangedItems || source.initialIndex === source.index) return
        const destination = items[source.index]
        if (destination && !destination.disabled && destination.id !== source.id) {
          onMove(String(source.id), destination.id)
        }
      }}
    >
      <CancelOnInterruption />
      <p id={helpId} className="sr-only">Arrastrá directamente el ítem. En móvil, mantené presionado antes de mover; un toque breve edita. Espacio o Enter inicia y confirma, las flechas mueven y Escape cancela.</p>
      <ul className={`quotation-sortable-list ${className}`} aria-label={label}>
        {items.map((item, index) => (
          <SortableItem
            key={item.id}
            item={item}
            index={index}
            group={group}
            helpId={helpId}
            disabled={item.disabled === true}
            onClickCapture={(event) => {
              const target = event.target
              if (event.detail > 0 && Date.now() < suppressClickUntil.current
                && item.id === dragSourceId.current && target instanceof Element
                && target.closest('[data-sortable-surface]') === event.currentTarget) {
                event.preventDefault()
                event.stopPropagation()
              }
            }}
          />
        ))}
      </ul>
      {/* Keep the registered overlay mounted until the feedback plugin restores the source DOM. */}
      <DragOverlay className="quotation-sortable-overlay" dropAnimation={null}>
        {(source) => <span>{typeof source.data.label === 'string' ? source.data.label : 'Mover elemento'}</span>}
      </DragOverlay>
    </DragDropProvider>
  )
}
