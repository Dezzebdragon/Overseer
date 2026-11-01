import * as monaco from 'monaco-editor'
import { create } from 'zustand'
import type { AppSettings } from '@shared/ipc'
import type {
  DirEntry,
  FsChangeBatch,
  GitGraphData,
  GitMergeState,
  TrackerInstance,
  WorkspaceInfo,
  WorkspaceState
} from '@shared/types'
import { ipc } from './ipc'
import { useNotifications } from './notificationStore'
import { modelManager } from './monaco/modelManager'
import { highlight } from './highlight'

// De-dupes concurrent graph loads across the many readers (Git view, tabs, status bar).
let graphInflight: Promise<void> | null = null
let graphInflightRoot: string | null = null
let graphInflightToken = 0

export interface TreeNode {
  id: string // absolute path; stable arborist id
  name: string
  isDir: boolean
  loaded: boolean
  children?: TreeNode[]
  deleted?: boolean
}

export interface Tab {
  path: string
  name: string
}

/** Top-level UI modes. Adding a view = extend this union + a render branch. */
export type ViewId =
  | 'overview'
  | 'explorer'
  | 'hub'
  | 'git'
  | 'pipeline'
  | 'template'
  | 'logs'
  | 'tools'
  | 'account'
  | 'settings'

interface AppState {
  root: string | null
  workspaceName: string | null
  tree: TreeNode[]
  expandedDirs: Set<string>
  tabs: Tab[]
  activePath: string | null
  dirty: Record<string, boolean>
  externallyChanged: Record<string, boolean>
  /** Last mtime we read or wrote per file; used to ignore our own watcher echoes. */
  savedMtime: Record<string, number>
  sidebarVisible: boolean
  settings: AppSettings
  activeView: ViewId
  recentProjects: string[]
  trackers: TrackerInstance[]
  hubSelectedRel: string | null
  hubDrawerOpen: boolean
  /** Selected commit per open file: abs path -> 'working' | <sha>. */
  fileCommits: Record<string, string>
  /** Last-known caret position (1-based) for the status bar. */
  caret: { line: number; col: number }
  /** Commit selected in the Git view (drives the left-pane commit info). */
  gitSelectedSha: string | null
  /** Shared, cached commit graph (loaded once per project; reload on change). */
  gitGraph: GitGraphData | null
  gitGraphRoot: string | null
  gitGraphLoading: boolean
  gitMergeState: GitMergeState | null

  init: () => Promise<void>
  openWorkspace: () => Promise<void>
  openProjectPath: (path: string) => Promise<void>
  closeProject: () => Promise<void>
  addProjectFolder: () => Promise<void>
  forgetProject: (path: string) => Promise<void>
  scaffoldProject: (path: string) => Promise<import('@shared/types').ProjectStatus>
  loadRecent: () => Promise<void>
  removeRecent: (path: string) => Promise<void>
  loadChildren: (path: string) => Promise<void>
  toggleExpanded: (path: string, open: boolean) => void
  openFile: (path: string, activate?: boolean) => Promise<void>
  closeTab: (path: string, force?: boolean) => void
  setActive: (path: string) => void
  saveActive: () => Promise<void>
  recomputeDirty: (path: string) => void
  applyFsChanges: (batch: FsChangeBatch) => Promise<void>
  createEntry: (parentDir: string, name: string, isDir: boolean) => Promise<void>
  renamePath: (oldPath: string, newName: string) => Promise<void>
  deletePath: (path: string) => Promise<void>
  setTheme: (theme: AppSettings['theme']) => Promise<void>
  toggleTheme: () => Promise<void>
  setAppSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
  toggleSidebar: () => void
  setView: (view: ViewId) => void
  addTracker: (
    definitionId: string,
    origin: { view: string | null; anchor: string | null },
    params?: Record<string, string>
  ) => void
  removeTracker: (instanceId: string) => void
  setTrackerColor: (instanceId: string, color: string) => void
  setTrackerTitle: (instanceId: string, title: string) => void
  setTrackerDescription: (instanceId: string, description: string) => void
  setDefaultTrackerColor: (definitionId: string, color: string) => Promise<void>
  setHubSelected: (rel: string | null) => void
  setHubDrawerOpen: (open: boolean) => void
  setFileCommit: (path: string, commit: string) => void
  setCaret: (line: number, col: number) => void
  openFileAtCommit: (relPath: string, commit: string) => void
  setGitSelectedSha: (sha: string | null) => void
  focusCommitInGit: (sha: string) => void
  loadGitGraph: (force?: boolean) => Promise<void>
}

// ---- pure path/tree helpers -------------------------------------------

function pathBaseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

function dirName(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut > 0 ? trimmed.slice(0, cut) : trimmed
}

function joinPath(parent: string, name: string): string {
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/'
  return parent.endsWith(sep) ? parent + name : parent + sep + name
}

function isDescendant(childPath: string, ancestorId: string): boolean {
  return (
    childPath === ancestorId ||
    childPath.startsWith(ancestorId + '/') ||
    childPath.startsWith(ancestorId + '\\')
  )
}

function toNode(entry: DirEntry): TreeNode {
  return {
    id: entry.path,
    name: entry.name,
    isDir: entry.isDir,
    loaded: false,
    children: entry.isDir ? [] : undefined
  }
}

function mergeChildren(
  old: TreeNode[] | undefined,
  entries: DirEntry[]
): TreeNode[] {
  const byId = new Map((old ?? []).map((n) => [n.id, n]))
  return entries.map((e) => {
    const prev = byId.get(e.path)
    if (prev && prev.isDir === e.isDir) return prev // preserve loaded subtree
    return toNode(e)
  })
}

function setChildrenAt(
  nodes: TreeNode[],
  parentPath: string,
  entries: DirEntry[]
): TreeNode[] {
  return nodes.map((n) => {
    if (n.id === parentPath) {
      return { ...n, loaded: true, children: mergeChildren(n.children, entries) }
    }
    if (n.isDir && n.children && isDescendant(parentPath, n.id)) {
      return { ...n, children: setChildrenAt(n.children, parentPath, entries) }
    }
    return n
  })
}

function findNode(nodes: TreeNode[], path: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.id === path) return n
    if (n.isDir && n.children && isDescendant(path, n.id)) {
      const found = findNode(n.children, path)
      if (found) return found
    }
  }
  return undefined
}

function applyTheme(theme: AppSettings['theme']): void {
  document.documentElement.dataset.theme = theme
  monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs')
}

// ---- store -------------------------------------------------------------

export const useStore = create<AppState>((set, get) => {
  let saveStateTimer: ReturnType<typeof setTimeout> | null = null
  const persistState = (): void => {
    if (saveStateTimer) clearTimeout(saveStateTimer)
    saveStateTimer = setTimeout(() => {
      const s = get()
      if (!s.root) return
      const state: WorkspaceState = {
        openTabs: s.tabs.map((t) => ({ path: t.path })),
        activePath: s.activePath,
        expandedDirs: [...s.expandedDirs],
        trackers: s.trackers,
        hub: { selectedRel: s.hubSelectedRel, drawerOpen: s.hubDrawerOpen },
        fileCommits: s.fileCommits
      }
      void ipc.saveState(state)
    }, 300)
  }

  /** Reload a directory into the tree (root and nested handled correctly). */
  const refreshDir = async (dir: string): Promise<void> => {
    const entries = await ipc.readDir(dir).catch(() => null)
    if (!entries) return
    if (dir === get().root) {
      set({ tree: mergeChildren(get().tree, entries) })
    } else {
      set({ tree: setChildrenAt(get().tree, dir, entries) })
    }
  }

  /** Apply an opened workspace: reset editor state, restore tabs + expansion. */
  const applyWorkspace = async (info: WorkspaceInfo): Promise<void> => {
    set({
      root: info.root,
      workspaceName: info.name,
      tree: info.entries.map(toNode),
      expandedDirs: new Set<string>(),
      tabs: [],
      activePath: null,
      dirty: {},
      externallyChanged: {},
      savedMtime: {},
      activeView: 'explorer',
      trackers: info.state.trackers ?? [],
      hubSelectedRel: info.state.hub?.selectedRel ?? null,
      hubDrawerOpen: info.state.hub?.drawerOpen ?? false,
      fileCommits: info.state.fileCommits ?? {},
      gitGraph: null,
      gitGraphRoot: null,
      gitMergeState: null,
      gitSelectedSha: null
    })

    const dirs = [...info.state.expandedDirs].sort((a, b) => a.length - b.length)
    for (const d of dirs) {
      try {
        await get().loadChildren(d)
        get().expandedDirs.add(d)
      } catch {
        /* directory no longer exists */
      }
    }
    set({ expandedDirs: new Set(get().expandedDirs) })

    for (const tab of info.state.openTabs) {
      try {
        await get().openFile(tab.path, false)
      } catch {
        /* file no longer exists */
      }
    }
    const active = info.state.activePath ?? info.state.openTabs.at(-1)?.path
    if (active && get().tabs.some((t) => t.path === active)) {
      get().setActive(active)
    }
  }

  return {
    root: null,
    workspaceName: null,
    tree: [],
    expandedDirs: new Set<string>(),
    tabs: [],
    activePath: null,
    dirty: {},
    externallyChanged: {},
    savedMtime: {},
    sidebarVisible: true,
    settings: { theme: 'dark' },
    activeView: 'explorer',
    recentProjects: [],
    trackers: [],
    hubSelectedRel: null,
    hubDrawerOpen: false,
    fileCommits: {},
    caret: { line: 1, col: 1 },
    gitSelectedSha: null,
    gitGraph: null,
    gitGraphRoot: null,
    gitGraphLoading: false,
    gitMergeState: null,

    init: async () => {
      const settings = await ipc.getSettings()
      set({ settings })
      applyTheme(settings.theme)
      await get().loadRecent()
      // Reopen the last project from the previous session, if it still exists.
      const last = await ipc.lastProject()
      if (last) {
        try {
          const info = await ipc.openProjectPath(last)
          if (info) {
            await applyWorkspace(info)
            await get().loadRecent()
          }
        } catch {
          /* folder gone — ignore */
        }
      }
    },

    openWorkspace: async () => {
      const info = await ipc.openWorkspace()
      if (!info) return
      await applyWorkspace(info)
      await get().loadRecent()
    },

    openProjectPath: async (path) => {
      try {
        const info = await ipc.openProjectPath(path)
        if (!info) return
        await applyWorkspace(info)
        await get().loadRecent()
      } catch {
        window.alert('That project folder could not be opened and was removed from recent projects.')
        await get().removeRecent(path)
      }
    },

    closeProject: async () => {
      for (const tab of get().tabs) modelManager.dispose(tab.path)
      await ipc.closeWorkspace()
      set({
        root: null,
        workspaceName: null,
        tree: [],
        expandedDirs: new Set<string>(),
        tabs: [],
        activePath: null,
        dirty: {},
        externallyChanged: {},
        savedMtime: {},
        trackers: []
      })
    },

    addProjectFolder: async () => {
      set({ recentProjects: await ipc.pickAndAddProject() })
    },

    forgetProject: async (path) => {
      const list = await ipc.forgetProject(path)
      if (get().root === path) await get().closeProject()
      set({ recentProjects: list })
    },

    scaffoldProject: (path) => ipc.scaffoldProject(path),

    loadRecent: async () => {
      set({ recentProjects: await ipc.recentProjects() })
    },

    removeRecent: async (path) => {
      set({ recentProjects: await ipc.removeRecentProject(path) })
    },

    loadChildren: async (path) => {
      const node = findNode(get().tree, path)
      if (node && node.loaded && (node.children?.length ?? 0) > 0) return
      const entries = await ipc.readDir(path)
      set({ tree: setChildrenAt(get().tree, path, entries) })
    },

    toggleExpanded: (path, open) => {
      const next = new Set(get().expandedDirs)
      if (open) next.add(path)
      else next.delete(path)
      set({ expandedDirs: next })
      persistState()
    },

    openFile: async (path, activate = true) => {
      if (!modelManager.has(path)) {
        const file = await ipc.readFile(path)
        if (file.refused) {
          window.alert(
            file.refused === 'too-large'
              ? 'File is too large to open in the editor.'
              : 'Binary files cannot be opened in the editor.'
          )
          return
        }
        modelManager.getOrCreate(path, file.content, file.eol)
        set({ savedMtime: { ...get().savedMtime, [path]: file.mtimeMs } })
      }
      if (!get().tabs.some((t) => t.path === path)) {
        set({ tabs: [...get().tabs, { path, name: pathBaseName(path) }] })
      }
      if (activate) get().setActive(path)
      persistState()
    },

    setActive: (path) => {
      set({ activePath: path, activeView: 'explorer' })
      persistState()
    },

    closeTab: (path, force = false) => {
      if (!force && get().dirty[path]) {
        const discard = window.confirm(
          `${pathBaseName(path)} has unsaved changes. Close without saving?`
        )
        if (!discard) return
      }
      const tabs = get().tabs
      const idx = tabs.findIndex((t) => t.path === path)
      const nextTabs = tabs.filter((t) => t.path !== path)

      let active = get().activePath
      if (active === path) {
        const neighbor = nextTabs[idx] ?? nextTabs[idx - 1] ?? null
        active = neighbor ? neighbor.path : null
      }

      modelManager.dispose(path)
      const dirty = { ...get().dirty }
      delete dirty[path]
      const ext = { ...get().externallyChanged }
      delete ext[path]
      const mtimes = { ...get().savedMtime }
      delete mtimes[path]

      set({
        tabs: nextTabs,
        activePath: active,
        dirty,
        externallyChanged: ext,
        savedMtime: mtimes
      })
      persistState()
    },

    saveActive: async () => {
      const path = get().activePath
      if (!path) return
      const model = modelManager.get(path)
      if (!model) return
      const eol = model.getEOL() === '\r\n' ? 'crlf' : 'lf'
      let result
      try {
        result = await ipc.writeFile({ path, content: model.getValue(), eol })
      } catch {
        useNotifications.getState().toast({ title: 'Save failed', color: '#e5484d' })
        return
      }
      useNotifications.getState().toast({ title: 'Saved!', color: '#3fb950' })
      modelManager.markSaved(path)
      const ext = { ...get().externallyChanged }
      delete ext[path]
      set({
        dirty: { ...get().dirty, [path]: false },
        externallyChanged: ext,
        // Record the mtime so the watcher echo for this write is ignored.
        savedMtime: { ...get().savedMtime, [path]: result.mtimeMs }
      })
    },

    recomputeDirty: (path) => {
      set({ dirty: { ...get().dirty, [path]: modelManager.isDirty(path) } })
    },

    applyFsChanges: async (batch) => {
      const affectedDirs = new Set<string>()
      for (const change of batch.changes) {
        const isOpen = get().tabs.some((t) => t.path === change.path)

        if (change.type === 'change' && isOpen && modelManager.has(change.path)) {
          const file = await ipc.readFile(change.path)
          if (!file.refused) {
            const known = get().savedMtime[change.path] ?? 0
            if (file.mtimeMs <= known) {
              // Our own save (or a stale event) — ignore, no reload.
            } else if (get().dirty[change.path]) {
              set({
                externallyChanged: {
                  ...get().externallyChanged,
                  [change.path]: true
                }
              })
            } else {
              modelManager.replaceContent(change.path, file.content, file.eol)
              set({
                savedMtime: { ...get().savedMtime, [change.path]: file.mtimeMs },
                // setValue fires a content-change event that can transiently
                // mark dirty; correct it here since we just synced from disk.
                dirty: { ...get().dirty, [change.path]: false }
              })
            }
          }
        } else if (change.type === 'unlink' && isOpen) {
          set({
            externallyChanged: {
              ...get().externallyChanged,
              [change.path]: true
            }
          })
        }

        affectedDirs.add(dirName(change.path))
      }

      for (const dir of affectedDirs) {
        if (dir === get().root || findNode(get().tree, dir)?.loaded) {
          await refreshDir(dir)
        }
      }
    },

    createEntry: async (parentDir, name, isDir) => {
      const target = joinPath(parentDir, name)
      await ipc.createEntry(target, isDir)
      await refreshDir(parentDir)
      if (!isDir) await get().openFile(target)
    },

    renamePath: async (oldPath, newName) => {
      if (get().dirty[oldPath]) {
        window.alert('Save the file before renaming it.')
        return
      }
      const parent = dirName(oldPath)
      const newPath = joinPath(parent, newName)
      const wasOpen = get().tabs.some((t) => t.path === oldPath)
      const wasActive = get().activePath === oldPath
      await ipc.rename(oldPath, newPath)
      if (wasOpen) get().closeTab(oldPath, true)
      await refreshDir(parent)
      if (wasOpen) await get().openFile(newPath, wasActive)
    },

    deletePath: async (path) => {
      await ipc.remove(path)
      if (get().tabs.some((t) => t.path === path)) get().closeTab(path, true)
      await refreshDir(dirName(path))
    },

    setTheme: async (theme) => {
      const settings = await ipc.setSettings({ theme })
      set({ settings })
      applyTheme(settings.theme)
    },

    toggleTheme: async () => {
      await get().setTheme(get().settings.theme === 'dark' ? 'light' : 'dark')
    },

    setAppSetting: async (key, value) => {
      const settings = await ipc.setSettings({ [key]: value })
      set({ settings })
    },

    toggleSidebar: () => set({ sidebarVisible: !get().sidebarVisible }),

    setView: (view) => set({ activeView: view }),

    addTracker: (definitionId, origin, params) => {
      const sig = (t: TrackerInstance): string =>
        `${t.definitionId}|${JSON.stringify(t.params ?? {})}`
      const newSig = `${definitionId}|${JSON.stringify(params ?? {})}`
      if (get().trackers.some((t) => sig(t) === newSig)) return
      const instance: TrackerInstance = {
        instanceId:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `t_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        definitionId,
        params,
        origin
      }
      set({ trackers: [...get().trackers, instance] })
      persistState()
    },

    removeTracker: (instanceId) => {
      set({ trackers: get().trackers.filter((t) => t.instanceId !== instanceId) })
      persistState()
    },

    setTrackerColor: (instanceId, color) => {
      set({
        trackers: get().trackers.map((t) =>
          t.instanceId === instanceId ? { ...t, color } : t
        )
      })
      persistState()
    },

    setTrackerTitle: (instanceId, title) => {
      set({
        trackers: get().trackers.map((t) =>
          t.instanceId === instanceId ? { ...t, title } : t
        )
      })
      persistState()
    },

    setTrackerDescription: (instanceId, description) => {
      set({
        trackers: get().trackers.map((t) =>
          t.instanceId === instanceId ? { ...t, description } : t
        )
      })
      persistState()
    },

    setDefaultTrackerColor: async (definitionId, color) => {
      const trackerColors = { ...(get().settings.trackerColors ?? {}), [definitionId]: color }
      const settings = await ipc.setSettings({ trackerColors })
      set({ settings })
    },

    setHubSelected: (rel) => {
      set({ hubSelectedRel: rel })
      persistState()
    },

    setHubDrawerOpen: (open) => {
      set({ hubDrawerOpen: open })
      persistState()
    },

    setFileCommit: (path, commit) => {
      set({ fileCommits: { ...get().fileCommits, [path]: commit } })
      persistState()
    },

    setCaret: (line, col) => {
      set({ caret: { line, col } })
    },

    openFileAtCommit: async (relPath, commit) => {
      const root = get().root
      if (!root) return
      const sep = root.includes('\\') ? '\\' : '/'
      const abs = `${root}${sep}${relPath.split('/').join(sep)}`
      if (!modelManager.has(abs)) {
        const file = await ipc.readFile(abs).catch(() => null)
        if (file && !file.refused) {
          modelManager.getOrCreate(abs, file.content, file.eol)
          set({ savedMtime: { ...get().savedMtime, [abs]: file.mtimeMs } })
        } else {
          modelManager.getOrCreate(abs, '', 'lf') // history-only (deleted) file
        }
      }
      if (!get().tabs.some((t) => t.path === abs)) {
        set({ tabs: [...get().tabs, { path: abs, name: pathBaseName(abs) }] })
      }
      set({
        fileCommits: { ...get().fileCommits, [abs]: commit },
        activePath: abs,
        activeView: 'explorer'
      })
      persistState()
    },

    setGitSelectedSha: (sha) => set({ gitSelectedSha: sha }),

    focusCommitInGit: (sha) => {
      set({ gitSelectedSha: sha, activeView: 'git' })
      // let the Git view mount, then scroll to and flash the commit row
      setTimeout(() => highlight(sha, 'git'), 60)
    },

    loadGitGraph: (force) => {
      const root = get().root
      if (!root) {
        set({ gitGraph: null, gitGraphRoot: null, gitMergeState: null })
        return Promise.resolve()
      }
      if (!force) {
        if (get().gitGraphRoot === root && get().gitGraph) return Promise.resolve()
        if (graphInflight && graphInflightRoot === root) return graphInflight
      }
      const token = ++graphInflightToken
      const p = (async (): Promise<void> => {
        set({ gitGraphLoading: true })
        try {
          const [graph, ms] = await Promise.all([ipc.gitGraph(root), ipc.gitMergeState(root)])
          if (get().root === root) {
            set({ gitGraph: graph, gitGraphRoot: root, gitMergeState: ms })
          }
        } finally {
          set({ gitGraphLoading: false })
          if (graphInflightToken === token) {
            graphInflight = null
            graphInflightRoot = null
          }
        }
      })()
      graphInflight = p
      graphInflightRoot = root
      return p
    }
  }
})
