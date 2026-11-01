import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { usePanelStore, APP_LOG_ID } from '../panelStore'
import { useLogStore, filterEntries } from '../logStore'
import { useTerminalStore, terminalOwner } from '../terminalStore'
import { AppLogConsole } from './AppLogConsole'
import { TerminalSlot } from './TerminalSlot'

/**
 * The global bottom panel (VS-Code-style). Rendered once at the App level inside
 * the view column; it floats over the view and never reflows it. When the user is
 * in the Logs view, that view owns the live terminal and the panel shows a disabled
 * placeholder (see terminalOwner).
 */
export function BottomPanel(): JSX.Element | null {
  const activeView = useStore((s) => s.activeView)
  const open = usePanelStore((s) => s.open)
  const height = usePanelStore((s) => s.height)
  const setHeight = usePanelStore((s) => s.setHeight)
  const setOpen = usePanelStore((s) => s.setOpen)
  const activeId = usePanelStore((s) => s.activeTerminalId)
  const selectTerminal = usePanelStore((s) => s.selectTerminal)

  const entries = useLogStore((s) => s.entries)
  const search = useLogStore((s) => s.search)
  const filters = useLogStore((s) => s.filters)
  const terminals = useTerminalStore((s) => s.terminals)

  const dragRef = useRef<{ startY: number; startH: number } | null>(null)
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!dragRef.current) return
      setHeight(dragRef.current.startH + (dragRef.current.startY - e.clientY))
    }
    const onUp = (): void => {
      dragRef.current = null
      document.body.classList.remove('resizing-v')
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [setHeight])

  if (!open) return null

  const owner = terminalOwner(activeView, open)
  const shownLog = filterEntries(entries, search, filters)

  return (
    <div className="bottom-panel" style={{ height }}>
      <div
        className="bottom-panel-resize"
        onMouseDown={(e) => {
          dragRef.current = { startY: e.clientY, startH: height }
          document.body.classList.add('resizing-v')
        }}
      />
      <div className="bottom-panel-head">
        <div className="bottom-panel-tabs">
          <button className="panel-tab active">Terminal</button>
        </div>
        <button className="panel-close" aria-label="Close panel" onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>

      <div className="bottom-panel-body">
        <aside className="terminal-list">
          <button
            className={`terminal-list-item pinned${activeId === APP_LOG_ID ? ' active' : ''}`}
            onClick={() => selectTerminal(APP_LOG_ID)}
          >
            <span className="terminal-pin">📜</span>
            <span className="terminal-list-label">App log</span>
          </button>
          {terminals.map((t) => (
            <button
              key={t.id}
              className={`terminal-list-item${activeId === t.id ? ' active' : ''}${
                t.exited ? ' exited' : ''
              }`}
              onClick={() => selectTerminal(t.id)}
            >
              <span className="terminal-list-label">{t.title}</span>
            </button>
          ))}
        </aside>

        <div className="terminal-window">
          {owner === 'logs' ? (
            <div className="terminal-disabled">Active in the Logs view</div>
          ) : activeId === APP_LOG_ID ? (
            <AppLogConsole entries={shownLog} />
          ) : (
            <TerminalSlot id={activeId} active={owner === 'panel'} />
          )}
        </div>
      </div>
    </div>
  )
}
