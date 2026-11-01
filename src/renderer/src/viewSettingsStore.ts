import { create } from 'zustand'

/**
 * Backs the per-view settings menus (the hamburger popovers). Values are keyed
 * by a namespaced id like "templates.dummy" so the same ids can later surface in
 * the Settings view under their view's section.
 */
interface ViewSettingsState {
  values: Record<string, boolean>
  toggle: (id: string) => void
  set: (id: string, value: boolean) => void
}

export const useViewSettingsStore = create<ViewSettingsState>((set, get) => ({
  values: {},
  toggle: (id) => set({ values: { ...get().values, [id]: !get().values[id] } }),
  set: (id, value) => set({ values: { ...get().values, [id]: value } })
}))
