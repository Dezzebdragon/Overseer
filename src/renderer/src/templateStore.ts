import { create } from 'zustand'
import type { TemplateInfo } from '@shared/types'
import { invoke } from './ipc'

function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

interface TemplateState {
  templates: TemplateInfo[]
  activeName: string
  selectedName: string
  selectedFile: string | null
  fileContent: string
  openMode: 'edit' | 'preview' | null
  loading: boolean

  load: () => Promise<void>
  setActive: (name: string) => Promise<void>
  openFile: (relPath: string, mode?: 'edit' | 'preview') => Promise<void>
  saveFile: (content: string) => Promise<void>
  createTemplate: (name: string) => Promise<void>
  duplicateTemplate: (newName: string) => Promise<void>
  deleteActiveTemplate: () => Promise<void>
  addFile: (relPath: string) => Promise<void>
  deleteFile: (relPath: string) => Promise<void>
  toggleFile: (relPath: string, required: boolean) => Promise<void>
}

export const useTemplateStore = create<TemplateState>((set, get) => ({
  templates: [],
  activeName: 'default',
  selectedName: 'default',
  selectedFile: null,
  fileContent: '',
  openMode: null,
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      const [templates, selected] = await Promise.all([
        invoke('templates:list'),
        invoke('templates:getSelected')
      ])
      const has = (name: string): boolean => templates.some((t) => t.name === name)
      const activeName = has(selected)
        ? selected
        : has(get().activeName)
          ? get().activeName
          : templates[0]?.name ?? 'default'
      set({ templates, selectedName: selected, activeName })
    } catch (error) {
      window.alert(messageOf(error))
    } finally {
      set({ loading: false })
    }
  },

  setActive: async (name) => {
    if (name === get().activeName) return
    set({
      activeName: name,
      selectedName: name,
      selectedFile: null,
      fileContent: '',
      openMode: null
    })
    // Selecting a template makes it the current (persisted) scaffold source.
    await invoke('templates:setSelected', name)
  },

  openFile: async (relPath, mode) => {
    try {
      const content = await invoke('templates:readFile', get().activeName, relPath)
      set({ selectedFile: relPath, fileContent: content, openMode: mode ?? null })
    } catch (error) {
      window.alert(messageOf(error))
    }
  },

  saveFile: async (content) => {
    const { activeName, selectedFile } = get()
    if (!selectedFile) return
    try {
      await invoke('templates:writeFile', activeName, selectedFile, content)
      set({ fileContent: content })
      await get().load() // sizes changed
    } catch (error) {
      window.alert(messageOf(error))
      throw error
    }
  },

  createTemplate: async (name) => {
    try {
      const created = await invoke('templates:create', name)
      await get().load()
      await get().setActive(created.name)
    } catch (error) {
      window.alert(messageOf(error))
    }
  },

  duplicateTemplate: async (newName) => {
    try {
      const created = await invoke('templates:duplicate', get().activeName, newName)
      await get().load()
      await get().setActive(created.name)
    } catch (error) {
      window.alert(messageOf(error))
    }
  },

  deleteActiveTemplate: async () => {
    const name = get().activeName
    try {
      await invoke('templates:delete', name)
      set({ activeName: 'default', selectedFile: null, fileContent: '' })
      await get().load()
    } catch (error) {
      window.alert(messageOf(error))
    }
  },

  addFile: async (relPath) => {
    try {
      await invoke('templates:addFile', get().activeName, relPath)
      await get().load()
      await get().openFile(relPath, 'edit')
    } catch (error) {
      window.alert(messageOf(error))
    }
  },

  deleteFile: async (relPath) => {
    try {
      await invoke('templates:deleteFile', get().activeName, relPath)
      if (get().selectedFile === relPath) {
        set({ selectedFile: null, fileContent: '' })
      }
      await get().load()
    } catch (error) {
      window.alert(messageOf(error))
    }
  },

  toggleFile: async (relPath, required) => {
    try {
      const templates = await invoke('templates:setFileRequired', get().activeName, relPath, required)
      set({ templates })
    } catch (error) {
      window.alert(messageOf(error))
    }
  }
}))
