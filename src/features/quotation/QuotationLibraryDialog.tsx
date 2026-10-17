import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { hasQuotationContent, type Quotation } from './model.ts'
import { Dialog } from './QuotationDialog.tsx'
import {
  hasArchivableQuotationContent, previewQuotationLibraryBackup, quotationLibraryNameKey, QUOTATION_LIBRARY_MAX_BYTES,
  type QuotationLibrary,
} from './quotation-library.ts'

export interface QuotationLibraryDialogProps {
  quotation: Quotation
  library: QuotationLibrary
  storageError?: string | null
  savingPaused?: boolean
  onSaveCurrent: (name: string, replaceEntryId?: string) => boolean | Promise<boolean>
  onOpen: (entryId: string) => void
  onDuplicate: (entryId: string) => void
  onExport: () => void
  onImport: (library: QuotationLibrary) => boolean | Promise<boolean>
  onResumeSaving?: () => void
  onClose: () => void
}

function savedDate(value: string): string {
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function QuotationLibraryDialog({
  quotation, library, storageError, savingPaused = false, onSaveCurrent,
  onOpen, onDuplicate, onExport, onImport, onResumeSaving, onClose,
}: QuotationLibraryDialogProps) {
  const [name, setName] = useState(quotation.title === 'PRESUPUESTO' ? '' : quotation.title.slice(0, 200))
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<ReturnType<typeof previewQuotationLibraryBackup> | null>(null)
  const importAttempt = useRef(0)
  useEffect(() => () => { importAttempt.current += 1 }, [])

  async function saveCurrent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || savingPaused) return
    const trimmed = name.trim()
    if (!trimmed) { setMessage('Escribí un nombre para identificar el presupuesto.'); return }
    const existing = library.entries.find((entry) => quotationLibraryNameKey(entry.name) === quotationLibraryNameKey(trimmed))
    if (existing && !window.confirm(`Ya existe «${existing.name}», guardado el ${savedDate(existing.savedAt)}. ¿Reemplazar ese presupuesto? El anterior dejará de estar en el historial.`)) return
    setBusy(true)
    try {
      const saved = await onSaveCurrent(trimmed, existing?.id)
      setMessage(saved ? 'Presupuesto guardado en este navegador.' : 'No se guardó el presupuesto. Conservá un respaldo y revisá el aviso del historial.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar el presupuesto.') }
    finally { setBusy(false) }
  }

  function replaceCurrent(entryId: string, duplicate: boolean) {
    if (busy) return
    if (hasQuotationContent(quotation) && !window.confirm('Esto reemplaza el presupuesto en curso. Si querés conservarlo, cancelá y guardalo primero en el historial. ¿Continuar?')) return
    if (duplicate) onDuplicate(entryId)
    else onOpen(entryId)
  }

  async function readImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy) return
    const attempt = ++importAttempt.current
    setPreview(null)
    setMessage('')
    if (file.size > QUOTATION_LIBRARY_MAX_BYTES) { setMessage('El respaldo supera el límite de 5 MiB.'); return }
    setBusy(true)
    try {
      const text = await file.text()
      const next = previewQuotationLibraryBackup(text)
      if (attempt === importAttempt.current) setPreview(next)
    } catch (error) {
      if (attempt === importAttempt.current) setMessage(error instanceof Error ? error.message : 'No se pudo leer el respaldo. El historial actual se conserva.')
    } finally { if (attempt === importAttempt.current) setBusy(false) }
  }

  async function confirmImport() {
    if (!preview || busy) return
    if (!window.confirm(`Se reemplazará el historial de este navegador (${library.entries.length} presupuestos) por los ${preview.library.entries.length} del respaldo. El presupuesto en curso y el catálogo se conservan. ¿Confirmar importación?`)) return
    setBusy(true)
    try {
      const imported = await onImport(preview.library)
      if (imported) { setPreview(null); setMessage('Historial importado en este navegador.') }
      else setMessage('No se importó el respaldo. El historial anterior se conserva.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo importar el respaldo. El historial anterior se conserva.') }
    finally { setBusy(false) }
  }

  return (
    <Dialog title="Presupuestos guardados" onClose={onClose}>
      <div className="form-stack quotation-library">
        <p className="field-help">Se guardan sólo en este navegador. Los importes y el dólar se abren tal como estaban al guardarlos; actualizar el dólar requiere tu acción.</p>
        {storageError && <p className="notice error" role="alert">{storageError}</p>}
        {savingPaused && <div className="notice pending"><p>El guardado del historial está pausado. Conservá un respaldo antes de continuar.</p>{onResumeSaving && <button type="button" className="button secondary" disabled={busy} onClick={() => {
          if (window.confirm('Se guardará el historial que ves en esta pestaña y se reemplazará la versión anterior de este navegador. Descargá antes un respaldo si querés conservar ambas versiones. ¿Habilitar guardado?')) onResumeSaving()
        }}>Habilitar guardado del historial</button>}</div>}
        <form className="form-stack" onSubmit={(event) => { void saveCurrent(event) }}>
          <label>Nombre para guardar<input autoFocus value={name} maxLength={200} onChange={(event) => setName(event.target.value)} placeholder="Vehículo, cliente o trabajo" /></label>
          <button className="button primary" type="submit" disabled={busy || savingPaused || !hasArchivableQuotationContent(quotation)}>Guardar presupuesto en curso</button>
          {!hasArchivableQuotationContent(quotation) && <p className="field-help">Agregá un concepto, un detalle o un precio antes de guardar el presupuesto.</p>}
        </form>
        <section aria-label="Historial local" className="form-stack">
          <h3>Guardados ({library.entries.length}/100)</h3>
          {library.entries.length === 0 ? <p>Todavía no guardaste presupuestos.</p> : <ul className="catalog-reference-list">
            {library.entries.map((entry) => <li key={entry.id} className="catalog-reference">
              <strong className="catalog-reference-heading">{entry.name}</strong>
              <span className="field-help">Guardado el {savedDate(entry.savedAt)} · {entry.quotation.rows.filter((row) => row.concept.trim()).length} conceptos</span>
              <div className="dialog-actions"><button type="button" className="button secondary" aria-label={`Abrir ${entry.name}`} disabled={busy} onClick={() => replaceCurrent(entry.id, false)}>Abrir</button><button type="button" className="button secondary" aria-label={`Duplicar ${entry.name}`} disabled={busy} onClick={() => replaceCurrent(entry.id, true)}>Duplicar</button></div>
            </li>)}
          </ul>}
        </section>
        <section className="form-stack" aria-label="Respaldo del historial">
          <h3>Respaldo privado</h3>
          <p className="field-help">El JSON contiene los presupuestos guardados y sus precios. Guardalo en un lugar privado. No incluye el catálogo.</p>
          <div className="dialog-actions"><button type="button" className="button secondary" onClick={onExport} disabled={busy}>Descargar respaldo del historial</button><label className="button secondary">Revisar respaldo para importar<input className="sr-only" type="file" accept="application/json,.json" disabled={busy} onChange={(event) => { void readImport(event) }} /></label></div>
          {preview && <div className="notice pending form-stack">
            <p>{preview.fromLegacy ? 'Respaldo anterior: se recuperan sólo sus presupuestos; el catálogo no se importa.' : 'Respaldo de historial verificado.'} Contiene {preview.library.entries.length} presupuestos y reemplazará los {library.entries.length} actuales.</p>
            <ul>{preview.library.entries.map((entry) => <li key={entry.id}>{entry.name} · {savedDate(entry.savedAt)}</li>)}</ul>
            <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setPreview(null)}>Cancelar importación</button><button type="button" className="button primary" disabled={busy} onClick={() => { void confirmImport() }}>Confirmar importación del historial</button></div>
          </div>}
        </section>
        <p role="status" aria-live="polite">{busy ? 'Procesando…' : message}</p>
      </div>
    </Dialog>
  )
}
