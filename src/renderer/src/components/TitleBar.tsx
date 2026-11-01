import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ipc } from '../ipc'
import { usePanelStore } from '../panelStore'
import { executeCommand } from '../commands/registry'

interface Item {
  label?: string
  sep?: boolean
  run?: () => void
}

const cmd = (id: string) => (): void => executeCommand(id)
const act = (a: string) => (): void => void ipc.windowAction(a)

const MENUS: { id: string; label: string; items: Item[] }[] = [
  {
    id: 'file',
    label: 'File',
    items: [
      { label: 'Open Folder…', run: cmd('workspace.openFolder') },
      { sep: true },
      { label: 'Save', run: cmd('file.save') },
      { label: 'Save As…', run: cmd('file.saveAs') },
      { label: 'Close Tab', run: cmd('file.closeTab') }
    ]
  },
  {
    id: 'edit',
    label: 'Edit',
    items: [
      { label: 'Undo', run: act('undo') },
      { label: 'Redo', run: act('redo') },
      { sep: true },
      { label: 'Cut', run: act('cut') },
      { label: 'Copy', run: act('copy') },
      { label: 'Paste', run: act('paste') },
      { label: 'Select All', run: act('selectAll') }
    ]
  },
  {
    id: 'view',
    label: 'View',
    items: [
      { label: 'Toggle Sidebar', run: cmd('view.toggleSidebar') },
      { label: 'Settings', run: cmd('view.showSettings') },
      { sep: true },
      { label: 'Reload', run: act('reload') },
      { label: 'Toggle DevTools', run: act('toggleDevTools') },
      { sep: true },
      { label: 'Reset Zoom', run: act('zoomReset') },
      { label: 'Zoom In', run: act('zoomIn') },
      { label: 'Zoom Out', run: act('zoomOut') }
    ]
  }
]

export function TitleBar(): JSX.Element {
  const [open, setOpen] = useState<{ id: string; left: number; top: number } | null>(null)
  const [maximized, setMaximized] = useState(false)
  const panelOpen = usePanelStore((s) => s.open)
  const togglePanel = usePanelStore((s) => s.toggle)

  useEffect(() => {
    void ipc.windowIsMaximized().then(setMaximized)
    return window.api.on('window:maximizeChanged', (m) => setMaximized(m))
  }, [])

  const openAt = (id: string, el: HTMLElement): void => {
    const r = el.getBoundingClientRect()
    setOpen({ id, left: r.left, top: r.bottom })
  }

  const items = MENUS.find((m) => m.id === open?.id)?.items ?? []

  return (
    <div className="titlebar">
      <div className="titlebar-logo" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 16 16">
          <rect x="1" y="1" width="14" height="14" rx="3.5" fill="#0e639c" />
          <path d="M5 5l-2 3 2 3M11 5l2 3-2 3" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div className="menubar">
        {MENUS.map((m) => (
          <button
            key={m.id}
            className={`menubar-btn${open?.id === m.id ? ' active' : ''}`}
            onMouseDown={(e) => {
              e.stopPropagation()
              if (open?.id === m.id) setOpen(null)
              else openAt(m.id, e.currentTarget)
            }}
            onMouseEnter={(e) => {
              if (open && open.id !== m.id) openAt(m.id, e.currentTarget)
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="titlebar-drag" />

      <div className="titlebar-actions">
        <button
          className={`titlebar-toggle${panelOpen ? ' active' : ''}`}
          aria-label="Toggle panel"
          title="Toggle panel (Ctrl+`)"
          onClick={togglePanel}
        >
          <svg width="14" height="14" viewBox="0 0 16 16">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M4 6l2 2-2 2M8 10h4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="window-controls">
        <button className="win-btn" aria-label="Minimize" onClick={() => void ipc.windowAction('minimize')}>
          <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" /></svg>
        </button>
        <button className="win-btn" aria-label="Maximize" onClick={() => void ipc.windowAction('maximize')}>
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="1" y="2.5" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
              <path d="M3 2.5V1h6v6H7.5" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
          )}
        </button>
        <button className="win-btn close" aria-label="Close" onClick={() => void ipc.windowAction('close')}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1" /></svg>
        </button>
      </div>

      {open &&
        createPortal(
          <>
            <div className="menubar-backdrop" onMouseDown={() => setOpen(null)} />
            <div className="menubar-dropdown" style={{ left: open.left, top: open.top }}>
              {items.map((it, i) =>
                it.sep ? (
                  <div key={i} className="context-sep" />
                ) : (
                  <div
                    key={i}
                    className="context-item"
                    onClick={() => {
                      it.run?.()
                      setOpen(null)
                    }}
                  >
                    {it.label}
                  </div>
                )
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  )
}
