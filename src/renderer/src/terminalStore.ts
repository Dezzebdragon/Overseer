import { create } from 'zustand'
import type { ShellProfile, TerminalInfo } from '@shared/types'
import { ipc } from './ipc'
import { useStore } from './store'
import { usePanelStore, APP_LOG_ID } from './panelStore'
import { useNotifications } from './notificationStore'
import { dispose as disposeXterm } from './xtermManager'

/** Where the single live terminal mount lives, given app state. */
export function terminalOwner(activeView: string, panelOpen: boolean): 'logs' | 'panel' | 'none' {
  if (activeView === 'logs') return 'logs'
  if (panelOpen) return 'panel'
  return 'none'
}

interface TerminalStore {
  profiles: ShellProfile[]
  terminals: TerminalInfo[]
  ready: boolean

  init: () => () => void
  loadProfiles: () => Promise<void>
  create: (profileId: string) => Promise<void>
  kill: (id: string) => Promise<void>
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  profiles: [],
  terminals: [],
  ready: false,

  init: () => {
    void ipc.termProfiles().then((profiles) => set({ profiles }))
    void ipc.termList().then((terminals) => set({ terminals, ready: true }))
    return window.api.on('term:exit', ({ id, exitCode }) => {
      set((s) => ({
        terminals: s.terminals.map((t) =>
          t.id === id ? { ...t, exited: true, exitCode } : t
        )
      }))
    })
  },

  loadProfiles: async () => {
    const profiles = await ipc.termProfiles()
    set({ profiles })
  },

  create: async (profileId) => {
    const info = await ipc.termCreate(profileId, useStore.getState().root)
    set((s) => ({ terminals: [...s.terminals, info] }))
    usePanelStore.getState().selectTerminal(info.id)
    useNotifications.getState().toast({ title: `Opened ${info.title}`, color: '#3fb950' })
  },

  kill: async (id) => {
    const title = get().terminals.find((t) => t.id === id)?.title ?? 'terminal'
    await ipc.termKill(id)
    disposeXterm(id)
    set((s) => ({ terminals: s.terminals.filter((t) => t.id !== id) }))
    // If the killed terminal was selected, fall back to the app log.
    if (usePanelStore.getState().activeTerminalId === id) {
      usePanelStore.getState().selectTerminal(APP_LOG_ID)
    }
    useNotifications.getState().toast({ title: `Closed ${title}`, color: '#8b92a5' })
  }
}))
