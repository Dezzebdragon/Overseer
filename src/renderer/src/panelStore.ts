import { create } from 'zustand'

export type PanelTab = 'terminal'

/** The app log is always present as terminal instance #0. */
export const APP_LOG_ID = 'app-log'

export const MIN_PANEL_HEIGHT = 120
export const MAX_PANEL_HEIGHT = 800
const DEFAULT_HEIGHT = 260

const SS_KEY = 'panel.state.v1'

interface Persisted {
  open: boolean
  height: number
}

function loadPersisted(): Persisted {
  try {
    const raw = sessionStorage.getItem(SS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>
      return {
        open: Boolean(p.open),
        height: clampHeight(typeof p.height === 'number' ? p.height : DEFAULT_HEIGHT)
      }
    }
  } catch {
    /* ignore malformed session state */
  }
  return { open: false, height: DEFAULT_HEIGHT }
}

function clampHeight(h: number): number {
  return Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, Math.round(h)))
}

function persist(open: boolean, height: number): void {
  try {
    sessionStorage.setItem(SS_KEY, JSON.stringify({ open, height }))
  } catch {
    /* session storage unavailable — non-fatal */
  }
}

interface PanelStore {
  open: boolean
  height: number
  tab: PanelTab
  /** Which terminal instance is shown (app log, or later a shell id). */
  activeTerminalId: string

  toggle: () => void
  setOpen: (open: boolean) => void
  setHeight: (height: number) => void
  setTab: (tab: PanelTab) => void
  selectTerminal: (id: string) => void
}

const initial = loadPersisted()

export const usePanelStore = create<PanelStore>((set, get) => ({
  open: initial.open,
  height: initial.height,
  tab: 'terminal',
  activeTerminalId: APP_LOG_ID,

  toggle: () => {
    const open = !get().open
    persist(open, get().height)
    set({ open })
  },
  setOpen: (open) => {
    persist(open, get().height)
    set({ open })
  },
  setHeight: (height) => {
    const h = clampHeight(height)
    persist(get().open, h)
    set({ height: h })
  },
  setTab: (tab) => set({ tab }),
  selectTerminal: (activeTerminalId) => set({ activeTerminalId })
}))
