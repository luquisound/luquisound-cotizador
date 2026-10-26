import { useEffect, useRef, type ReactNode } from 'react'

interface DialogProps { title: string; onClose: () => void; children: ReactNode; className?: string }

export function Dialog({ title, onClose, children, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const style = dialog.style
    const viewport = window.visualViewport
    function updateViewport() {
      if (!viewport) return
      const layoutHeight = document.documentElement.clientHeight
      // Track the keyboard's visible area without resizing the form on pinch zoom.
      const height = viewport.scale === 1 ? viewport.height : layoutHeight
      const top = viewport.scale === 1 ? viewport.offsetTop : 0
      style.setProperty('--dialog-viewport-height', `${height}px`)
      style.setProperty('--dialog-viewport-top', `${top}px`)
      style.setProperty('--dialog-viewport-bottom', `${Math.max(0, layoutHeight - height - top)}px`)
    }
    const resizeViewport = () => {
      updateViewport()
      const active = document.activeElement
      if (dialog.open && viewport?.scale === 1 && active instanceof HTMLElement && dialog.contains(active)) {
        active.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    }
    updateViewport()
    viewport?.addEventListener('resize', resizeViewport)
    viewport?.addEventListener('scroll', updateViewport)
    window.addEventListener('resize', resizeViewport)
    dialog.showModal()
    // A control can only receive focus after the native dialog becomes visible.
    dialog.querySelector<HTMLElement>('[data-editor-autofocus="true"]')?.focus()
    return () => {
      viewport?.removeEventListener('resize', resizeViewport)
      viewport?.removeEventListener('scroll', updateViewport)
      window.removeEventListener('resize', resizeViewport)
    }
  }, [])
  return (
    <dialog ref={ref} className={`editor-dialog${className ? ` ${className}` : ''}`} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose() }}>
      <div className="dialog-heading"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}>×</button></div>
      {children}
    </dialog>
  )
}
