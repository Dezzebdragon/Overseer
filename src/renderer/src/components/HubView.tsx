import { useCallback, useEffect, useState } from 'react'
import type { HubFile, RepairFile, RepairInfo } from '@shared/types'
import { useStore } from '../store'
import { useNotifications } from '../notificationStore'
import { getTrackable } from '../trackables'
import { ipc } from '../ipc'
import { useHint } from '../hint'
import { languageForPath } from '../monaco/languages'
import { FileList, type FileListItem } from './FileList'
import { EditorPane } from './EditorPane'
import { ViewSettingsMenu } from './ViewSettingsMenu'
import { ContextMenu, type CtxItem } from './ContextMenu'

function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

function Header(): JSX.Element {
  return (
    <div className="template-header">
      <div className="header-left">
        <span className="template-label">Hub</span>
        <ViewSettingsMenu sectionId="hub" label="Hub view settings" />
      </div>
      <div className="header-right" />
    </div>
  )
}

function FileCheck({
  name,
  checked,
  note,
  hint,
  onToggle
}: {
  name: string
  checked: boolean
  note?: string
  hint: string
  onToggle: () => void
}): JSX.Element {
  const h = useHint(hint)
  return (
    <label className="repair-row" {...h}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="repair-name">{name}</span>
      {note && <span className="repair-note">{note}</span>}
    </label>
  )
}

function RepairDock({
  root,
  repair,
  reload
}: {
  root: string
  repair: RepairInfo | null
  reload: () => Promise<void>
}): JSX.Element {
  const [showRequired, setShowRequired] = useState(false)
  const [requiredChecks, setRequiredChecks] = useState<Record<string, boolean>>({})
  const [missingChecks, setMissingChecks] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [dockMenu, setDockMenu] = useState<{ x: number; y: number } | null>(null)
  const toast = useNotifications((s) => s.toast)
  const notify = useNotifications((s) => s.notify)
  const addTracker = useStore((s) => s.addTracker)
  const trackers = useStore((s) => s.trackers)

  const trackDef = (id: string): void => {
    const d = getTrackable(id)
    if (d) addTracker(id, { view: d.origin?.view ?? null, anchor: d.origin?.anchor ?? null })
  }
  const isTracked = (id: string): boolean =>
    trackers.some((t) => t.definitionId === id && !t.params)
  const dockItems: CtxItem[] = [
    isTracked('project.missingCount')
      ? { label: 'Tracking missing files', disabled: true, hint: 'Already tracked' }
      : { label: 'Track missing files', onClick: () => trackDef('project.missingCount') },
    isTracked('project.requiredCount')
      ? { label: 'Tracking required files', disabled: true, hint: 'Already tracked' }
      : { label: 'Track required files', onClick: () => trackDef('project.requiredCount') }
  ]

  useEffect(() => {
    if (!repair) return
    const req: Record<string, boolean> = {}
    const miss: Record<string, boolean> = {}
    for (const f of repair.files) {
      if (f.builtin || (f.required && !f.generated)) req[f.name] = f.required
      if (f.required) miss[f.name] = !f.present
    }
    setRequiredChecks(req)
    setMissingChecks(miss)
  }, [repair])

  const requiredBtnHint = useHint('Choose which files this project requires (edits big-mcp.config.json)')
  const applyHint = useHint('Re-add the checked files from the current template')
  const addHint = useHint('Add a required file — copied into the project')
  const saveHint = useHint('Save required files to big-mcp.config.json')

  if (!repair) return <div className="repair-empty">Initialize the project to manage files.</div>

  const requiredFiles = repair.files.filter((f) => f.builtin || (f.required && !f.generated))
  const missingFiles = repair.files.filter((f) => f.required)

  const saveRequired = async (): Promise<void> => {
    setBusy(true)
    try {
      const names = requiredFiles.filter((f) => requiredChecks[f.name]).map((f) => f.name)
      await ipc.hubSetRequiredDocs(root, names)
      toast({ title: 'Required docs saved', color: '#3fb950' })
      await reload()
    } catch {
      toast({ title: 'Save failed', color: '#e5484d' })
    } finally {
      setBusy(false)
    }
  }

  const addRequired = async (): Promise<void> => {
    const src = await ipc.pickFile()
    if (!src) return
    setBusy(true)
    try {
      await ipc.hubAddRequiredFile(root, src)
      toast({ title: `Added ${baseName(src)}`, color: '#3fb950' })
      await reload()
    } catch {
      toast({ title: 'Could not add file', color: '#e5484d' })
    } finally {
      setBusy(false)
    }
  }

  const applyRepair = async (): Promise<void> => {
    const names = missingFiles.filter((f) => missingChecks[f.name]).map((f) => f.name)
    if (names.length === 0) return
    if (!window.confirm(`Apply from template "${repair.template}"?\n\nFiles: ${names.join(', ')}`)) {
      return
    }
    setBusy(true)
    try {
      const res = await ipc.hubApplyRepair(root, names)
      if (!res.ok) {
        toast({ title: 'Repair failed', color: '#e5484d' })
        notify({
          type: 'error',
          description: `"${res.template}" does not contain ${res.missingFromTemplate.join(', ')}`,
          target: { view: 'hub', anchor: null }
        })
        return
      }
      const n = res.applied.length + res.regenerated.length
      toast({ title: `Repaired ${n} file${n === 1 ? '' : 's'}`, color: '#3fb950' })
      await reload()
    } catch {
      toast({ title: 'Repair failed', color: '#e5484d' })
    } finally {
      setBusy(false)
    }
  }

  const fileNote = (f: RepairFile): string | undefined => (f.present ? undefined : 'missing')

  return (
    <div
      className="hub-drawer-body"
      onContextMenu={(e) => {
        e.preventDefault()
        setDockMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {/* actions at the top */}
      <div className="repair-actions repair-actions-top">
        <button className="btn btn-sm" onClick={() => setShowRequired((v) => !v)} {...requiredBtnHint}>
          Required docs
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => void applyRepair()} disabled={busy} {...applyHint}>
          Apply template
        </button>
      </div>

      {/* required section (hidden until Required docs is clicked) */}
      {showRequired && (
        <div className="repair-section">
          <div className="repair-section-title">Required files</div>
          <div className="repair-list">
            {requiredFiles.map((f) => (
              <FileCheck
                key={f.name}
                name={f.name}
                checked={requiredChecks[f.name] ?? false}
                hint={`${f.builtin ? 'Default app file' : 'Project file'} — required when checked`}
                onToggle={() => setRequiredChecks((r) => ({ ...r, [f.name]: !r[f.name] }))}
              />
            ))}
          </div>
          <div className="repair-actions">
            <button className="btn btn-sm" onClick={() => void addRequired()} disabled={busy} {...addHint}>
              Add required file
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => void saveRequired()} disabled={busy} {...saveHint}>
              Save
            </button>
          </div>
        </div>
      )}

      {/* coordination files (missing list) */}
      <div className="repair-section">
        <div className="repair-section-title">Coordination files</div>
        <div className="repair-list">
          {missingFiles.map((f) => (
            <FileCheck
              key={f.name}
              name={f.name}
              checked={missingChecks[f.name] ?? false}
              note={fileNote(f)}
              hint={
                f.present
                  ? `${f.name} is present — check to re-apply from the template`
                  : `${f.name} is missing — will be re-added on apply`
              }
              onToggle={() => setMissingChecks((m) => ({ ...m, [f.name]: !m[f.name] }))}
            />
          ))}
        </div>
      </div>

      {dockMenu && (
        <ContextMenu x={dockMenu.x} y={dockMenu.y} items={dockItems} onClose={() => setDockMenu(null)} />
      )}
    </div>
  )
}

function HubDrawer({
  repair,
  root,
  open,
  onToggle,
  reload
}: {
  repair: RepairInfo | null
  root: string
  open: boolean
  onToggle: () => void
  reload: () => Promise<void>
}): JSX.Element {
  const railHint = useHint('Repair and set required files for this project')
  const required = repair?.files.filter((f) => f.required) ?? []
  const missing = required.filter((f) => !f.present).length
  const good = missing === 0
  const statusHint = useHint(`${required.length - missing} present, ${missing} missing`)

  return (
    <div className={`hub-drawer${open ? ' open' : ''}`}>
      <button className="hub-drawer-rail" onClick={onToggle} {...railHint}>
        <span className="hub-drawer-caret">{open ? '▲' : '▼'}</span>
        <span className="hub-drawer-title">Collaboration docs</span>
        <span className={`hub-status ${good ? 'good' : 'warn'}`} {...statusHint}>
          {good ? '✓' : '⚠'}
        </span>
      </button>
      {open && <RepairDock root={root} repair={repair} reload={reload} />}
    </div>
  )
}

export function HubView(): JSX.Element {
  const root = useStore((s) => s.root)
  const hubRequirement = useStore((s) => s.settings.hubRequirement)
  const selectedRel = useStore((s) => s.hubSelectedRel)
  const setHubSelected = useStore((s) => s.setHubSelected)
  const drawerOpen = useStore((s) => s.hubDrawerOpen)
  const setHubDrawerOpen = useStore((s) => s.setHubDrawerOpen)
  const notify = useNotifications((s) => s.notify)
  const resolve = useNotifications((s) => s.resolve)

  const [files, setFiles] = useState<HubFile[]>([])
  const [repair, setRepair] = useState<RepairInfo | null>(null)
  const [search, setSearch] = useState('')
  const [content, setContent] = useState('')
  const [eol, setEol] = useState<'lf' | 'crlf'>('lf')
  const [busy, setBusy] = useState(false)
  // The editor's pane header is portaled into this top-bar slot (see EditorPane).
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null)

  const readInto = useCallback(async (list: HubFile[], rel: string | null) => {
    const f = rel ? list.find((x) => x.relPath === rel) : null
    if (!f) {
      setContent('')
      return
    }
    const res = await ipc.readFile(f.absPath)
    if (!res.refused) {
      setContent(res.content)
      setEol(res.eol)
    }
  }, [])

  const loadFiles = useCallback(async () => {
    if (!root) {
      setFiles([])
      return
    }
    const list = await ipc.hubFiles(root)
    setFiles(list)
    await readInto(list, useStore.getState().hubSelectedRel)
  }, [root, readInto])

  const loadRepair = useCallback(async () => {
    if (!root) {
      setRepair(null)
      return
    }
    const info = await ipc.hubRepairInfo(root)
    setRepair(info)
    const missing = info.files.filter((f) => f.required && !f.present)
    const key = `repair:${root}`
    if (missing.length > 0) {
      notify({
        type: 'warning',
        description: `${missing.length} required file${missing.length === 1 ? '' : 's'} missing`,
        target: { view: 'hub', anchor: null },
        sticky: true,
        stickyHint: 'Re-add the missing files (Apply template) before dismissing',
        resolveKey: key
      })
    } else {
      resolve(key)
    }
  }, [root, notify, resolve])

  const reload = useCallback(async () => {
    await loadFiles()
    await loadRepair()
  }, [loadFiles, loadRepair])

  useEffect(() => {
    void reload()
  }, [reload, hubRequirement])

  const selectedFile = files.find((f) => f.relPath === selectedRel) ?? null

  const openFile = async (rel: string): Promise<void> => {
    setHubSelected(rel)
    await readInto(files, rel)
  }

  const saveFile = async (value: string): Promise<void> => {
    if (!selectedFile) return
    setBusy(true)
    try {
      await ipc.writeFile({ path: selectedFile.absPath, content: value, eol })
      setContent(value)
      await loadFiles()
    } finally {
      setBusy(false)
    }
  }

  if (!root) {
    return (
      <div className="view view-hub">
        <Header />
        <div className="hub-empty">Open a project to use the Hub.</div>
      </div>
    )
  }

  const items: FileListItem[] = files
    .filter((f) => f.relPath.toLowerCase().includes(search.toLowerCase()))
    .map((f) => ({ id: f.relPath, name: baseName(f.relPath), relPath: f.relPath, sizeBytes: f.sizeBytes }))

  const isMarkdown = selectedRel?.toLowerCase().endsWith('.md') ?? false

  return (
    <div className="view view-hub">
      <div className="template-header">
        <div className="header-left">
          <span className="template-label">Hub</span>
          <ViewSettingsMenu sectionId="hub" label="Hub view settings" />
        </div>
        <div className="header-right" ref={setHeaderSlot} />
      </div>
      <div className="template-body">
        <aside className="template-files">
          <div className="hub-search">
            <input
              className="hub-search-input"
              placeholder="Search files…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <HubDrawer
            root={root}
            repair={repair}
            open={drawerOpen}
            onToggle={() => setHubDrawerOpen(!drawerOpen)}
            reload={reload}
          />

          <FileList
            items={items}
            selectedId={selectedRel}
            onSelect={(id) => void openFile(id)}
            onReveal={(item) => {
              const f = files.find((x) => x.relPath === item.relPath)
              if (f) void ipc.revealInOS(f.absPath)
            }}
            emptyMessage={
              search ? 'No files match your search.' : 'No managed files — initialize the project first.'
            }
          />
        </aside>

        <main className="template-editor">
          <EditorPane
            headerContainer={headerSlot}
            hasFile={!!selectedRel}
            title={selectedRel}
            content={content}
            sourceKey={`${root}:${selectedRel ?? ''}`}
            language={selectedRel ? languageForPath(selectedRel) : 'plaintext'}
            canPreview={isMarkdown}
            highlightGenerated={isMarkdown}
            busy={busy}
            emptyMessage="Choose a file to view or edit."
            onSave={saveFile}
            headerExtras={
              selectedFile ? (
                <button
                  className="btn btn-ghost"
                  onClick={() => void ipc.revealInOS(selectedFile.absPath)}
                >
                  Reveal
                </button>
              ) : null
            }
          />
        </main>
      </div>
    </div>
  )
}
