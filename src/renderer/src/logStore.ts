import { create } from 'zustand'
import type { LogEntry, LogLevel } from '@shared/types'
import { ipc } from './ipc'

export const LOG_LEVELS: LogLevel[] = ['info', 'warning', 'error', 'test']

export const LOG_COLOR: Record<LogLevel, string> = {
  info: '#3b82f6',
  warning: '#f5a623',
  error: '#e5484d',
  test: '#a855f7'
}

const CAP = 2000

interface LogStore {
  entries: LogEntry[]
  /** Reactive search text (session-lived; cleared on reload). */
  search: string
  /** Which levels are visible. */
  filters: Record<LogLevel, boolean>
  ready: boolean

  init: () => () => void
  append: (e: LogEntry) => void
  setSearch: (s: string) => void
  toggleFilter: (level: LogLevel) => void
  clear: () => void
}

export const useLogStore = create<LogStore>((set, get) => ({
  entries: [],
  search: '',
  filters: { info: true, warning: true, error: true, test: true },
  ready: false,

  init: () => {
    void ipc.logHistory().then((history) => {
      set({ entries: history.slice(-CAP), ready: true })
    })
    return window.api.on('log:entry', (e) => get().append(e))
  },

  append: (e) =>
    set((s) => {
      const next = [...s.entries, e]
      if (next.length > CAP) next.splice(0, next.length - CAP)
      return { entries: next }
    }),

  setSearch: (search) => set({ search }),

  toggleFilter: (level) =>
    set((s) => ({ filters: { ...s.filters, [level]: !s.filters[level] } })),

  clear: () => {
    void ipc.logClear()
    set({ entries: [] })
  }
}))

/** Filter entries by active levels + a case-insensitive search over message/source. */
export function filterEntries(
  entries: LogEntry[],
  search: string,
  filters: Record<LogLevel, boolean>
): LogEntry[] {
  const q = search.trim().toLowerCase()
  return entries.filter((e) => {
    if (!filters[e.level]) return false
    if (!q) return true
    return e.message.toLowerCase().includes(q) || e.source.toLowerCase().includes(q)
  })
}
