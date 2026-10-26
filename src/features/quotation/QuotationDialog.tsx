import { useEffect, useRef, type ReactNode } from 'react'

interface DialogProps { title: string; onClose: () => void; children: ReactNode; className?: string }

export function Dialog({ title, onClose, children, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    // A control can only receive focus after the native dialog becomes visible.
    ref.current?.querySelector<HTMLElement>('[data-editor-autofocus="true"]')?.focus()
  }, [])
  return (
    <dialog ref={ref} className={`editor-dialog${className ? ` ${className}` : ''}`} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose() }}>
      <div className="dialog-heading"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}>×</button></div>
      {children}
    </dialog>
  )
}
