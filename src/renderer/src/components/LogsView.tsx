import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { usePanelStore, APP_LOG_ID } from '../panelStore'
import { useLogStore, filterEntries, LOG_LEVELS, LOG_COLOR } from '../logStore'
import { useTerminalStore, terminalOwner } from '../terminalStore'
import { AppLogConsole } from './AppLogConsole'
import { TerminalSlot } from './TerminalSlot'
import { ViewSettingsMenu } from './ViewSettingsMenu'

/** Small floating popover anchored under a trigger, clamped inside the window. */
function Popover({
  anchor,
  onClose,
  children
}: {
  anchor: DOMRect
  onClose: () => void
  children: React.ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: anchor.bottom + 4, left: anchor.left })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const m = 8
    let left = anchor.left
    if (left + r.width > window.innerWidth - m) {
      // Prefer right-aligning to the trigger; never overflow the left edge.
      left = Math.max(m, Math.min(anchor.right - r.width, window.innerWidth - m - r.width))
    }
    let top = anchor.bottom + 4
    if (top + r.height > window.innerHeight - m) {
      top = Math.max(m, anchor.top - r.height - 4)
    }
    setPos({ top, left })
  }, [anchor])

  return createPortal(
    <div className="popover-backdrop" onMouseDown={onClose}>
      <div
        ref={ref}
        className="popover-menu"
        style={{ top: pos.top, left: pos.left }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

export function LogsView(): JSX.Element {
  const activeView = useStore((s) => s.activeView)
  const panelOpen = usePanelStore((s) => s.open)
  const activeId = usePanelStore((s) => s.activeTerminalId)
  const selectTerminal = usePanelStore((s) => s.selectTerminal)

  const entries = useLogStore((s) => s.entries)
  const search = useLogStore((s) => s.search)
  const setSearch = useLogStore((s) => s.setSearch)
  const filters = useLogStore((s) => s.filters)
  const toggleFilter = useLogStore((s) => s.toggleFilter)

  const profiles = useTerminalStore((s) => s.profiles)
  const terminals = useTerminalStore((s) => s.terminals)
  const createTerm = useTerminalStore((s) => s.create)
  const killTerm = useTerminalStore((s) => s.kill)
  const loadProfiles = useTerminalStore((s) => s.loadProfiles)

  const [filterMenu, setFilterMenu] = useState<DOMRect | null>(null)
  const [addMenu, setAddMenu] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (profiles.length === 0) void loadProfiles()
  }, [profiles.length, loadProfiles])

  const isLog = activeId === APP_LOG_ID
  const slotActive = terminalOwner(activeView, panelOpen) === 'logs'
  const shownLog = filterEntries(entries, search, filters)

  return (
    <div className="view view-logs">
      <div className="template-header">
        <div className="header-left">
          <span className="template-label">Logs</span>
          <ViewSettingsMenu sectionId="logs" label="Logs view settings" />
        </div>
        <div className="header-right logs-header-right">
          <div className="logs-search">
            <input
              className="logs-search-input"
              placeholder="search in window..."
              value={search}
              disabled={!isLog}
              onChange={(e) => setSearch(e.target.value)}
            />
            <svg className="logs-search-icon" width="13" height="13" viewBox="0 0 16 16">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </div>
          <button
            className="icon-btn logs-filter-btn"
            aria-label="Filter"
            disabled={!isLog}
            onClick={(e) => setFilterMenu(e.currentTarget.getBoundingClientRect())}
          >
            <svg width="15" height="15" viewBox="0 0 16 16">
              <path d="M2 4h8M2 8h6M2 12h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="12.5" cy="4" r="1.4" fill="currentColor" />
              <circle cx="10.5" cy="8" r="1.4" fill="currentColor" />
              <circle cx="8.5" cy="12" r="1.4" fill="currentColor" />
            </svg>
          </button>
          <div className="logs-header-spacer" />
          <button
            className="btn btn-sm"
            onClick={(e) => setAddMenu(e.currentTarget.getBoundingClientRect())}
          >
            + terminal
          </button>
        </div>
      </div>

      <div className="logs-body">
        <aside className="logs-list">
          <button
            className={`terminal-list-item pinned${isLog ? ' active' : ''}`}
            onClick={() => selectTerminal(APP_LOG_ID)}
          >
            <span className="terminal-pin">📜</span>
            <span className="terminal-list-label">App log</span>
          </button>
          {terminals.map((t) => (
            <div
              key={t.id}
              className={`terminal-list-row${activeId === t.id ? ' active' : ''}${
                t.exited ? ' exited' : ''
              }`}
            >
              <button className="terminal-list-item" onClick={() => selectTerminal(t.id)}>
                <span className="terminal-list-label">
                  {t.title}
                  {t.exited ? ' (exited)' : ''}
                </span>
              </button>
              <button
                className="terminal-kill"
                aria-label="Close terminal"
                onClick={() => void killTerm(t.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </aside>

        <div className="logs-window">
          {isLog ? (
            <AppLogConsole entries={shownLog} />
          ) : (
            <TerminalSlot id={activeId} active={slotActive} />
          )}
        </div>
      </div>

      {filterMenu && (
        <Popover anchor={filterMenu} onClose={() => setFilterMenu(null)}>
          {LOG_LEVELS.map((level) => (
            <label key={level} className="filter-option">
              <input type="checkbox" checked={filters[level]} onChange={() => toggleFilter(level)} />
              <span className="filter-dot" style={{ background: LOG_COLOR[level] }} />
              <span className="filter-label">{level}</span>
            </label>
          ))}
        </Popover>
      )}

      {addMenu && (
        <Popover anchor={addMenu} onClose={() => setAddMenu(null)}>
          {profiles.length === 0 ? (
            <div className="popover-empty">No system shells detected</div>
          ) : (
            <>
              {profiles.some((p) => p.kind !== 'agent') && (
                <div className="popover-heading">Shells</div>
              )}
              {profiles
                .filter((p) => p.kind !== 'agent')
                .map((p) => (
                  <button
                    key={p.id}
                    className="popover-item"
                    onClick={() => {
                      void createTerm(p.id)
                      setAddMenu(null)
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              {profiles.some((p) => p.kind === 'agent') && (
                <div className="popover-heading">Agents</div>
              )}
              {profiles
                .filter((p) => p.kind === 'agent')
                .map((p) => (
                  <button
                    key={p.id}
                    className="popover-item"
                    onClick={() => {
                      void createTerm(p.id)
                      setAddMenu(null)
                    }}
                  >
                    {p.label}
                  </button>
                ))}
            </>
          )}
        </Popover>
      )}
    </div>
  )
}
