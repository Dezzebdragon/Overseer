import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LogEntry } from '@shared/types'
import { useStore } from '../store'
import { LOG_COLOR } from '../logStore'

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * Read-only, monospace, auto-scrolling view of app-log entries. Dumb: the caller
 * passes already-filtered entries. Auto-scroll pauses when the user scrolls up.
 */
export function AppLogConsole({ entries }: { entries: LogEntry[] }): JSX.Element {
  const autoScroll = useStore((s) => s.settings.logsAutoScroll ?? true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    setPinned(atBottom)
  }

  useLayoutEffect(() => {
    if (autoScroll && pinned && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries, pinned, autoScroll])

  // Re-pin on mount so switching to the console lands at the newest line.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  return (
    <div className="log-console" ref={scrollRef} onScroll={onScroll}>
      {entries.length === 0 ? (
        <div className="log-empty">No log entries yet.</div>
      ) : (
        entries.map((e) => (
          <div className="log-line" key={e.id}>
            <span className="log-time">{fmtTime(e.ts)}</span>
            <span className="log-level" style={{ color: LOG_COLOR[e.level] }}>
              {e.level}
            </span>
            <span className="log-source">{e.source}</span>
            <span className="log-msg">{e.message}</span>
          </div>
        ))
      )}
      {!pinned && (
        <button
          className="log-jump"
          onClick={() => {
            const el = scrollRef.current
            if (el) el.scrollTop = el.scrollHeight
            setPinned(true)
          }}
        >
          ↓ Jump to latest
        </button>
      )}
    </div>
  )
}
