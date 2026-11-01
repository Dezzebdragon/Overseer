import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ProjectStatus } from '@shared/types'
import { useStore } from '../store'
import { useAccountStore } from '../accountStore'
import { useNotifications } from '../notificationStore'
import { useHint } from '../hint'
import { ipc } from '../ipc'
import { CloneModal } from './CloneModal'

function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

function InitializeControl({
  status,
  busy,
  onInitialize
}: {
  status?: ProjectStatus
  busy: boolean
  onInitialize: () => void
}): JSX.Element {
  const hint = useHint('Scaffolds project files based on the current template')

  if (busy) {
    return <span className="init-badge">Initializing…</span>
  }
  if (status?.initialized) {
    return <span className="init-badge ok">Initialized ✓</span>
  }
  if (status?.damaged) {
    return (
      <button className="init-badge warn" onClick={onInitialize} {...hint}>
        Initialized ⚠
      </button>
    )
  }
  return (
    <button className="btn btn-sm init-btn" onClick={onInitialize} {...hint}>
      Initialize
    </button>
  )
}

function ProjectRow({
  path,
  isCurrent,
  status,
  busy,
  onSelect,
  onInitialize,
  onForget
}: {
  path: string
  isCurrent: boolean
  status?: ProjectStatus
  busy: boolean
  onSelect: () => void
  onInitialize: () => void
  onForget: () => void
}): JSX.Element {
  const rowHint = useHint(isCurrent ? `Current project · ${path}` : path)
  const revealHint = useHint('Open in File Explorer')
  const forgetHint = useHint('Forget this project (removes app data; keeps your files)')

  return (
    <div className={`project-row${isCurrent ? ' current' : ''}`}>
      {isCurrent && <span className="project-current-bar" />}
      <button className="project-main" onClick={onSelect} {...rowHint}>
        <span className="project-name">
          {baseName(path)}
          {isCurrent && <span className="project-current-tag">current</span>}
        </span>
        <span className="project-path">{path}</span>
      </button>
      <div className="project-actions">
        <InitializeControl status={status} busy={busy} onInitialize={onInitialize} />
        <button className="icon-btn" onClick={() => void ipc.revealInOS(path)} {...revealHint}>
          ⤢
        </button>
        <button className="icon-btn" onClick={onForget} {...forgetHint}>
          ✕
        </button>
      </div>
    </div>
  )
}

export function ChangeProjectModal({ onClose }: { onClose: () => void }): JSX.Element {
  const root = useStore((s) => s.root)
  const recentProjects = useStore((s) => s.recentProjects)
  const openProjectPath = useStore((s) => s.openProjectPath)
  const addProjectFolder = useStore((s) => s.addProjectFolder)
  const forgetProject = useStore((s) => s.forgetProject)
  const scaffoldProject = useStore((s) => s.scaffoldProject)
  const loadRecent = useStore((s) => s.loadRecent)
  const setView = useStore((s) => s.setView)

  const [statuses, setStatuses] = useState<Record<string, ProjectStatus>>({})
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [showClone, setShowClone] = useState(false)
  const connected = useAccountStore((s) => s.connected)
  const isConnected = Boolean(connected)

  useEffect(() => {
    void loadRecent()
  }, [loadRecent])

  useEffect(() => {
    if (recentProjects.length === 0) {
      setStatuses({})
      return
    }
    let cancelled = false
    void ipc.projectStatuses(recentProjects).then((s) => {
      if (!cancelled) setStatuses(s)
    })
    return () => {
      cancelled = true
    }
  }, [recentProjects])

  const chooseHint = useHint('Pick a folder and add it to the list (does not open it)')
  const cloneHint = useHint(
    isConnected ? 'Clone a repository into a new folder' : 'Connect a GitHub account to clone'
  )

  const ordered = [...recentProjects].sort(
    (a, b) => (a === root ? -1 : 0) - (b === root ? -1 : 0)
  )

  const onInitialize = async (path: string): Promise<void> => {
    setBusyPath(path)
    try {
      const status = await scaffoldProject(path)
      setStatuses((prev) => ({ ...prev, [path]: status }))
    } finally {
      setBusyPath(null)
    }
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Projects</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-top-actions">
            <button className="btn" onClick={() => void addProjectFolder()} {...chooseHint}>
              Choose Project Folder
            </button>
            <button
              className="btn btn-ghost"
              disabled={!isConnected}
              onClick={() => setShowClone(true)}
              {...cloneHint}
            >
              Clone Project Folder
            </button>
          </div>

          <div className="modal-section">
            <div className="modal-section-title">Recent projects</div>
            {ordered.length === 0 ? (
              <div className="modal-empty">
                No projects yet. Use “Choose Project Folder” to add one.
              </div>
            ) : (
              <div className="project-list">
                {ordered.map((path) => (
                  <ProjectRow
                    key={path}
                    path={path}
                    isCurrent={path === root}
                    status={statuses[path]}
                    busy={busyPath === path}
                    onSelect={() => {
                      void openProjectPath(path)
                      onClose()
                    }}
                    onInitialize={() => void onInitialize(path)}
                    onForget={() => void forgetProject(path)}
                  />
                ))}
              </div>
            )}
          </div>

          {!isConnected && (
            <div className="modal-gate">
              <p>Connect a GitHub account to clone your repositories.</p>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setView('account')
                  onClose()
                }}
              >
                Go to Account
              </button>
            </div>
          )}
        </div>
      </div>
      {showClone && (
        <CloneModal
          onClose={() => setShowClone(false)}
          onCloned={(path) => {
            setShowClone(false)
            useNotifications.getState().notify({
              type: 'info',
              description: `Cloned ${path.split(/[\\/]/).pop() ?? 'repository'}`,
              target: { view: 'explorer', anchor: null }
            })
            void loadRecent()
            void openProjectPath(path)
            onClose()
          }}
        />
      )}
    </div>,
    document.body
  )
}
