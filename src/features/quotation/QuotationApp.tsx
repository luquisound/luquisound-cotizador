import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { calculateQuotation } from './calculation'
import { createQuotation, createRow, createWorkspace, duplicateQuotation, type Quotation, type RowSection, type Workspace } from './model'
import { loadWorkspace, parseWorkspace, saveWorkspace, serializeWorkspace, STORAGE_KEY } from './persistence'
import { createQuotationFile, downloadQuotationFile, shareQuotationFile } from './export'
import { QuotationPreview } from './QuotationPreview'
import { CatalogEditor, HeaderEditor, RowEditor } from './QuotationDialogs'

function initialWorkspace(): { workspace: Workspace; error: string | null } {
  try { return loadWorkspace(window.localStorage) }
  catch { return { workspace: createWorkspace(), error: 'El almacenamiento de este navegador no está disponible. Podés trabajar y descargar un respaldo.' } }
}

export default function QuotationApp() {
  const [initial] = useState(initialWorkspace)
  const [workspace, setWorkspace] = useState(initial.workspace)
  const [storageEnabled, setStorageEnabled] = useState(!initial.error)
  const [storageError, setStorageError] = useState(initial.error)
  const [savedWorkspace, setSavedWorkspace] = useState<Workspace | null>(null)
  const [dialog, setDialog] = useState<'header' | 'catalog' | null>(null)
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [prepared, setPrepared] = useState<{ file: File; quotation: Quotation } | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const pausedByAnotherTab = useRef(false)
  const quotation = workspace.quotations.find((entry) => entry.id === workspace.activeQuotationId) ?? workspace.quotations[0]!
  const preparedFile = prepared?.quotation === quotation ? prepared.file : null
  const saveStatus = !storageEnabled ? 'Guardado local desactivado' : storageError ? 'No se pudo guardar' : savedWorkspace === workspace ? 'Guardado en este navegador' : 'Guardando…'
  const calculation = calculateQuotation(quotation)
  const editingRow = quotation.rows.find((row) => row.id === editingRowId)

  useEffect(() => {
    generation.current += 1
  }, [quotation])

  useEffect(() => {
    if (!storageEnabled) return
    const timer = window.setTimeout(() => {
      if (pausedByAnotherTab.current) return
      try {
        const result = saveWorkspace(window.localStorage, workspace)
        if (result.ok) { setStorageError(null); setSavedWorkspace(workspace) }
        else setStorageError(result.error)
      } catch { setStorageError('No se pudo acceder al almacenamiento. Descargá un respaldo para conservar tu trabajo.') }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [workspace, storageEnabled])

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== STORAGE_KEY && event.key !== null) return
      pausedByAnotherTab.current = true
      setStorageEnabled(false)
      setStorageError('Otra pestaña cambió los datos guardados. El guardado se pausó para evitar sobrescribirlos. Descargá un respaldo de esta pestaña y recargá para recuperar la versión guardada.')
    }
    function flush() {
      if (!storageEnabled || pausedByAnotherTab.current) return
      try { saveWorkspace(window.localStorage, workspace) } catch { /* The visible save status remains authoritative. */ }
    }
    window.addEventListener('storage', handleStorage)
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('storage', handleStorage); window.removeEventListener('pagehide', flush) }
  }, [workspace, storageEnabled])

  function commitWorkspace(next: Workspace): boolean {
    try { serializeWorkspace(next) }
    catch {
      window.alert('No se aplicaron estos cambios porque superarían el límite de guardado y respaldo. Descargá un respaldo y eliminá borradores que ya no necesitás antes de continuar. Tus datos actuales se conservan.')
      return false
    }
    setWorkspace(next)
    return true
  }
  function updateQuotation(next: Quotation): boolean {
    setMessage('')
    return commitWorkspace({ ...workspace, quotations: workspace.quotations.map((entry) => entry.id === next.id ? { ...next, updatedAt: new Date().toISOString() } : entry) })
  }
  function addQuotation(duplicate = false) {
    if (workspace.quotations.length >= 500) { setMessage('Llegaste al máximo de 500 borradores. Descargá un respaldo y eliminá los que ya no necesitás.'); return }
    setMessage('')
    const next = duplicate ? duplicateQuotation(quotation) : createQuotation()
    commitWorkspace({ ...workspace, activeQuotationId: next.id, quotations: [...workspace.quotations, next] })
  }
  function addRow(section: RowSection) {
    if (quotation.rows.length >= 1000) { setMessage('Llegaste al máximo de 1000 conceptos en este presupuesto.'); return }
    const row = createRow(section)
    if (updateQuotation({ ...quotation, rows: [...quotation.rows, row] })) setEditingRowId(row.id)
  }
  function removeQuotation() {
    if (!window.confirm('¿Eliminar este borrador? Descargá un respaldo antes si querés conservarlo.')) return
    const remaining = workspace.quotations.filter((entry) => entry.id !== quotation.id)
    const next = remaining.length ? remaining : [createQuotation()]
    setWorkspace({ ...workspace, quotations: next, activeQuotationId: next[0]!.id })
  }
  function exportBackup() {
    try {
      const file = new File([serializeWorkspace(workspace)], `luquisound-respaldo-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' })
      downloadQuotationFile(file); setMessage('Respaldo descargado. Puede contener información de tus presupuestos: guardalo en un lugar privado.')
    } catch { setMessage('No se pudo crear el respaldo: los datos superan el tamaño permitido de 5 MB. Reducí la cantidad de borradores o el contenido antes de reintentar.') }
  }
  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file) return
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('El respaldo supera el máximo de 5 MB.')
      const next = parseWorkspace(await file.text())
      if (!window.confirm('Importar reemplaza los borradores y el catálogo de este navegador. ¿Continuar?')) return
      pausedByAnotherTab.current = false
      setWorkspace(next); setStorageEnabled(true); setMessage('Respaldo importado.'); setStorageError(null)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo importar el respaldo.') }
  }
  async function prepareImage() {
    if (!calculation.canExport) { setMessage('Completá los conceptos y precios pendientes antes de preparar la imagen.'); return }
    const request = ++generation.current
    setPreparing(true); setMessage('Preparando imagen…')
    try {
      const file = await createQuotationFile(quotation)
      if (request === generation.current) { setPrepared({ file, quotation }); setMessage('Imagen lista. Podés descargarla o abrir el menú para compartir.') }
    } catch (error) { if (request === generation.current) setMessage(error instanceof Error ? error.message : 'No se pudo preparar la imagen. Intentá otra vez.') }
    finally { setPreparing(false) }
  }
  async function shareImage() {
    if (!preparedFile || sharing) return
    setSharing(true)
    try {
      const result = await shareQuotationFile(preparedFile, navigator)
      if (result === 'unsupported') { downloadQuotationFile(preparedFile); setMessage('Este navegador no permite compartir archivos. Se descargó la imagen para compartirla manualmente.') }
      else if (result === 'cancelled') setMessage('Compartir cancelado. La imagen sigue disponible.')
      else setMessage('Menú de compartir cerrado. El envío se confirma en la aplicación que elijas.')
    } catch { setMessage('No se pudo abrir el menú para compartir. Podés descargar la imagen e intentarlo desde tu galería.') }
    finally { setSharing(false) }
  }

  return (
    <div className="quotation-workspace">
      <a className="skip-link" href="#quotation">Ir al presupuesto</a>
      <header className="workspace-header"><div className="workspace-brand"><img src="/brand/luquisound-horizontal.svg" alt="Luquisound" width="176" height="20" /><div><h1>Cotizador Luquisound</h1><p>Tu plantilla. Cada proyecto.</p></div></div><button className="button primary" type="button" onClick={() => addQuotation()}>+ Nuevo</button></header>
      <main className="workspace-main">
        <div className="workspace-toolbar"><label className="draft-selector">Borrador<select aria-label="Elegir borrador" value={quotation.id} onChange={(event) => setWorkspace({ ...workspace, activeQuotationId: event.target.value })}>{workspace.quotations.map((entry) => <option key={entry.id} value={entry.id}>{entry.title || 'Sin título'}{entry.subtitle ? ` · ${entry.subtitle}` : ''}</option>)}</select></label><div className="toolbar-actions"><button className="button secondary" onClick={() => addQuotation(true)}>Duplicar</button><button className="button secondary" onClick={() => setDialog('catalog')}>Mi catálogo</button><details className="workspace-menu"><summary>Más opciones</summary><div><button type="button" onClick={exportBackup}>Descargar respaldo</button><button type="button" onClick={() => importInput.current?.click()}>Importar respaldo</button><button type="button" className="danger" onClick={removeQuotation}>Eliminar borrador</button></div></details></div></div>
        <div className="workspace-status"><span role="status">{saveStatus}</span><span>Datos en este navegador · Sin sincronización</span></div>
        {storageError && <div className="notice error" role="alert"><p>{storageError}</p><button className="button secondary" onClick={exportBackup}>Descargar respaldo</button>{!storageEnabled && <button className="button secondary" onClick={() => { if (window.confirm('Habilitar el guardado puede reemplazar datos locales que no pudieron recuperarse. ¿Continuar?')) { pausedByAnotherTab.current = false; setStorageEnabled(true) } }}>Habilitar guardado</button>}</div>}
        <p className="editing-hint">Tocá el título o un concepto para editarlo. Podés escribir libremente, elegir del catálogo o dejar un campo vacío.</p>
        <div id="quotation"><QuotationPreview quotation={quotation} onEditHeader={() => setDialog('header')} onEditRow={setEditingRowId} onAddRow={addRow} /></div>
        {!calculation.canExport && <div className="notice pending"><strong>El presupuesto todavía tiene datos pendientes.</strong><ul>{calculation.issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul><p>Podés seguir editándolo; la imagen final se habilita cuando esté completo.</p></div>}
        <div className="local-data-note"><strong>Tu información se guarda en este navegador.</strong> No se envían presupuestos ni catálogo a un servidor. Borrar los datos del navegador puede eliminar tus borradores. Usá respaldos para conservarlos o llevarlos a otro dispositivo.</div>
        <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={(event) => { void importBackup(event) }} />
      </main>
      <footer className="export-bar"><div><strong>{preparedFile ? 'Imagen lista para compartir' : 'Compartí tu presupuesto'}</strong><p role="status" aria-live="polite">{message || 'La imagen incluye solo la plantilla, sin controles.'}</p></div><div className="export-actions">{preparedFile ? <><button className="button secondary" type="button" onClick={() => downloadQuotationFile(preparedFile)}>Descargar PNG</button><button className="button primary" disabled={sharing} type="button" onClick={() => { void shareImage() }}>{sharing ? 'Abriendo…' : 'Compartir imagen'}</button></> : <button className="button primary" disabled={preparing || !calculation.canExport} type="button" onClick={() => { void prepareImage() }}>{preparing ? 'Preparando…' : 'Preparar imagen'}</button>}</div></footer>
      {dialog === 'header' && <HeaderEditor quotation={quotation} onClose={() => setDialog(null)} onSave={(next) => { if (updateQuotation(next)) setDialog(null) }} />}
      {dialog === 'catalog' && <CatalogEditor catalog={workspace.catalog} onClose={() => setDialog(null)} onSave={(catalog) => commitWorkspace({ ...workspace, catalog })} />}
      {editingRow && <RowEditor key={editingRow.id} row={editingRow} quotation={quotation} catalog={workspace.catalog} onClose={() => setEditingRowId(null)} onSave={(row) => { if (updateQuotation({ ...quotation, rows: quotation.rows.map((entry) => entry.id === row.id ? row : entry) })) setEditingRowId(null) }} onRemove={() => { if (updateQuotation({ ...quotation, rows: quotation.rows.filter((entry) => entry.id !== editingRow.id) })) setEditingRowId(null) }} />}
    </div>
  )
}
