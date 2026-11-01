import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import type { RequestChannel, RequestMap } from '@shared/ipc'
import type { WorkspaceInfo, WorkspaceState } from '@shared/types'
import * as fsService from './fs-service'
import * as templates from './templates'
import { assertInsideTemplates } from './paths'
import {
  addRecentProject,
  getRecentProjects,
  getSelectedTemplate,
  getLastOpenedProject,
  removeRecentProject,
  setSelectedTemplate,
  setLastOpenedProject
} from './registry'
import { computeProjectStats } from './metrics'
import { scaffoldProject, projectStatuses } from './projects'
import { readState, writeState, readBigConfig, writeBigConfig } from './projectFiles'
import { hubFiles } from './hub'
import {
  accountGet,
  accountSetClientId,
  accountBeginConnect,
  accountCancelConnect,
  accountDisconnect,
  accountForget,
  githubListRepos,
  githubClone
} from './github'
import {
  hubRepairInfo,
  hubSetRequiredDocs,
  hubAddRequiredFile,
  hubApplyRepair
} from './repair'
import { agentsList, setAgentWatchRoot, startAgentWatch } from './agents'
import {
  detectAgents,
  planRegister,
  registerAgent,
  unregisterAgent,
  openBackup
} from './agents-write'
import { initAppLog, appLog, getLogHistory, clearLog } from './app-log'
import {
  initTerminals,
  detectProfiles,
  listTerminals,
  createTerminal,
  writeTerminal,
  resizeTerminal,
  killTerminal
} from './terminals'
import {
  gitGraph,
  gitCommitMetrics,
  fileAtCommit,
  fileHistory,
  commitFiles,
  deletedPaths,
  treeAtCommit,
  lastFileCommit,
  commitBody,
  gitCommit,
  gitCreateBranch,
  gitCheckout,
  gitMerge,
  gitBranches,
  gitMergeState,
  gitConflictVersions,
  gitStageResolved,
  gitCompleteMerge,
  gitAbortMerge
} from './git'
import {
  loadSettings,
  loadWorkspaceState,
  saveSettings,
  saveWorkspaceState,
  deleteWorkspaceState
} from './workspace-state'
import { WorkspaceWatcher } from './watcher'

type Handler<C extends RequestChannel> = (
  ...args: RequestMap[C][0]
) => Promise<RequestMap[C][1]> | RequestMap[C][1]

/** Small typed wrapper so every handler is checked against the contract. */
function handle<C extends RequestChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, (_event, ...args) =>
    (handler as (...a: unknown[]) => unknown)(...args)
  )
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  let watcher: WorkspaceWatcher | null = null
  let currentRoot: string | null = null

  /** Open a folder as the workspace: read it, restore state, watch, remember. */
  const openAt = async (
    win: BrowserWindow,
    root: string
  ): Promise<WorkspaceInfo> => {
    const [entries, state] = await Promise.all([
      fsService.readDir(root),
      loadWorkspaceState(root)
    ])
    currentRoot = root
    watcher?.stop()
    watcher = new WorkspaceWatcher(win)
    watcher.start(root)
    await addRecentProject(root)
    await setLastOpenedProject(root)
    return { root, name: fsService.folderName(root), entries, state }
  }

  handle('workspace:open', async (): Promise<WorkspaceInfo | null> => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return openAt(win, result.filePaths[0])
  })

  handle('workspace:openPath', async (path: string): Promise<WorkspaceInfo | null> => {
    const win = getWindow()
    if (!win) return null
    // Throws (ENOENT) if the folder no longer exists; the renderer forgets it.
    return openAt(win, path)
  })

  handle('projects:recent', () => getRecentProjects())
  handle('projects:removeRecent', (path: string) => removeRecentProject(path))

  handle('workspace:close', () => {
    watcher?.stop()
    watcher = null
    currentRoot = null
    return setLastOpenedProject(null)
  })

  handle('projects:pickAndAdd', async (): Promise<string[]> => {
    const win = getWindow()
    if (!win) return getRecentProjects()
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return getRecentProjects()
    return addRecentProject(result.filePaths[0])
  })

  handle('projects:forget', async (path: string): Promise<string[]> => {
    await deleteWorkspaceState(path)
    return removeRecentProject(path)
  })

  handle('projects:scaffold', (root: string) => scaffoldProject(root))
  handle('pm:getState', (root: string) => readState(root))
  handle('pm:setState', (root: string, state) => writeState(root, state))
  handle('pm:getConfig', (root: string) => readBigConfig(root))
  handle('pm:setConfig', (root: string, config) => writeBigConfig(root, config))
  handle('projects:statuses', (roots: string[]) => projectStatuses(roots))
  handle('projects:lastOpened', () => getLastOpenedProject())
  handle('hub:files', (root: string) => hubFiles(root))

  handle('workspace:saveState', async (state: WorkspaceState): Promise<void> => {
    if (currentRoot) await saveWorkspaceState(currentRoot, state)
  })

  handle('dir:read', (path: string) => fsService.readDir(path))
  handle('file:read', (path: string) => fsService.readFile(path))
  handle('file:write', (args) => fsService.writeFile(args))
  handle('file:create', (path: string, isDir: boolean) =>
    fsService.createEntry(path, isDir)
  )
  handle('file:rename', (from: string, to: string) =>
    fsService.renameEntry(from, to)
  )
  handle('file:delete', (path: string) => fsService.deleteEntry(path))

  handle('settings:get', () => loadSettings())
  handle('settings:set', async (partial) => {
    const current = await loadSettings()
    const next = { ...current, ...partial }
    await saveSettings(next)
    return next
  })

  // templates
  handle('templates:list', () => templates.listTemplates())
  handle('templates:readFile', (name: string, relPath: string) =>
    templates.readTemplateFile(name, relPath)
  )
  handle('templates:writeFile', (name: string, relPath: string, content: string) =>
    templates.writeTemplateFile(name, relPath, content)
  )
  handle('templates:create', (name: string) => templates.createTemplate(name))
  handle('templates:duplicate', (sourceName: string, newName: string) =>
    templates.duplicateTemplate(sourceName, newName)
  )
  handle('templates:delete', (name: string) => templates.deleteTemplate(name))
  handle('templates:addFile', (name: string, relPath: string) =>
    templates.writeTemplateFile(name, relPath, '', true)
  )
  handle('templates:deleteFile', (name: string, relPath: string) =>
    templates.deleteTemplateFile(name, relPath)
  )
  handle('templates:setFileRequired', (name: string, relPath: string, required: boolean) =>
    templates.setFileRequired(name, relPath, required)
  )
  handle('templates:revealFile', (name: string, relPath: string) => {
    shell.showItemInFolder(assertInsideTemplates(name, relPath))
  })
  handle('templates:getSelected', () => getSelectedTemplate())
  handle('templates:setSelected', (name: string) => setSelectedTemplate(name))

  // OS integration
  handle('shell:showItem', (path: string) => {
    shell.showItemInFolder(path)
  })

  // metrics
  handle('metrics:projectStats', (root: string) => computeProjectStats(root))

  // github account
  handle('account:get', () => accountGet())
  handle('account:setClientId', (id: string | null) => accountSetClientId(id))
  handle('account:beginConnect', () =>
    accountBeginConnect(
      getWindow(),
      (s) => getWindow()?.webContents.send('account:connected', s),
      (message) => getWindow()?.webContents.send('account:authError', { message })
    )
  )
  handle('account:cancelConnect', () => {
    accountCancelConnect()
  })
  handle('account:disconnect', () => accountDisconnect())
  handle('account:forget', (login: string) => accountForget(login))
  handle('github:listRepos', () => githubListRepos())
  handle('github:clone', (cloneUrl: string, destParent: string) =>
    githubClone(cloneUrl, destParent)
  )
  handle('dialog:pickDirectory', async () => {
    const win = getWindow()
    const res = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openDirectory', 'createDirectory']
        })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
  handle('dialog:pickFile', async () => {
    const win = getWindow()
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile'] })
      : await dialog.showOpenDialog({ properties: ['openFile'] })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  // hub repair dock
  handle('hub:repairInfo', (root: string) => hubRepairInfo(root))
  handle('hub:setRequiredDocs', (root: string, names: string[]) =>
    hubSetRequiredDocs(root, names)
  )
  handle('hub:addRequiredFile', (root: string, sourceAbs: string) =>
    hubAddRequiredFile(root, sourceAbs)
  )
  handle('hub:applyRepair', (root: string, names: string[]) => hubApplyRepair(root, names))

  // custom titlebar window controls + menu roles
  handle('window:action', (action: string) => {
    const win = getWindow()
    if (!win) return
    const wc = win.webContents
    switch (action) {
      case 'minimize':
        win.minimize()
        break
      case 'maximize':
        win.isMaximized() ? win.unmaximize() : win.maximize()
        break
      case 'close':
        win.close()
        break
      case 'undo':
        wc.undo()
        break
      case 'redo':
        wc.redo()
        break
      case 'cut':
        wc.cut()
        break
      case 'copy':
        wc.copy()
        break
      case 'paste':
        wc.paste()
        break
      case 'selectAll':
        wc.selectAll()
        break
      case 'reload':
        wc.reload()
        break
      case 'toggleDevTools':
        wc.toggleDevTools()
        break
      case 'zoomIn':
        wc.setZoomLevel(wc.getZoomLevel() + 0.5)
        break
      case 'zoomOut':
        wc.setZoomLevel(wc.getZoomLevel() - 0.5)
        break
      case 'zoomReset':
        wc.setZoomLevel(0)
        break
    }
  })
  handle('window:isMaximized', () => getWindow()?.isMaximized() ?? false)

  // local AI agents (read-only detection + health)
  startAgentWatch(getWindow)
  handle('agents:list', (root: string | null) => {
    setAgentWatchRoot(root)
    return agentsList(root)
  })
  handle('agents:detect', () => detectAgents())
  handle('agents:planRegister', (id: string) => planRegister(id))
  handle('agents:register', (id: string) => registerAgent(id))
  handle('agents:unregister', (id: string) => unregisterAgent(id))
  handle('agents:openBackup', (id: string) => openBackup(id))

  // app log
  initAppLog(getWindow)
  handle('log:history', () => getLogHistory())
  handle('log:write', (level, source: string, message: string) => {
    appLog(level, source, message)
  })
  handle('log:clear', () => clearLog())

  // terminals (PTY)
  initTerminals(getWindow)
  handle('term:profiles', () => detectProfiles())
  handle('term:list', () => listTerminals())
  handle('term:create', (profileId: string, cwd: string | null) => createTerminal(profileId, cwd))
  handle('term:write', (id: string, data: string) => {
    writeTerminal(id, data)
  })
  handle('term:resize', (id: string, cols: number, rows: number) => {
    resizeTerminal(id, cols, rows)
  })
  handle('term:kill', (id: string) => {
    killTerminal(id)
  })

  // clipboard (terminal copy/paste, sandboxed renderer → main)
  handle('clipboard:read', () => clipboard.readText())
  handle('clipboard:write', (text: string) => {
    clipboard.writeText(text)
  })

  // git (read-only)
  handle('git:graph', (root: string) => gitGraph(root))
  handle('git:commitMetrics', (root: string, shas: string[]) =>
    gitCommitMetrics(root, shas)
  )
  handle('git:fileAtCommit', (root: string, relPath: string, hash: string) =>
    fileAtCommit(root, relPath, hash)
  )
  handle('git:fileHistory', (root: string, relPath: string) => fileHistory(root, relPath))
  handle('git:commitFiles', (root: string, hash: string) => commitFiles(root, hash))
  handle('git:deletedPaths', (root: string) => deletedPaths(root))
  handle('git:treeAtCommit', (root: string, hash: string) => treeAtCommit(root, hash))
  handle('git:lastFileCommit', (root: string, relPath: string) => lastFileCommit(root, relPath))
  handle('git:commitBody', (root: string, sha: string) => commitBody(root, sha))
  handle('git:commit', (root: string, message: string, stageAll: boolean) => gitCommit(root, message, stageAll))
  handle('git:createBranch', (root: string, name: string, base: string, checkout: boolean) => gitCreateBranch(root, name, base, checkout))
  handle('git:checkout', (root: string, target: string) => gitCheckout(root, target))
  handle('git:merge', (root: string, branch: string, noFf: boolean) => gitMerge(root, branch, noFf))
  handle('git:branches', (root: string) => gitBranches(root))
  handle('git:mergeState', (root: string) => gitMergeState(root))
  handle('git:conflictVersions', (root: string, relPath: string) => gitConflictVersions(root, relPath))
  handle('git:stageResolved', (root: string, relPath: string, content: string) => gitStageResolved(root, relPath, content))
  handle('git:completeMerge', (root: string, message: string | undefined) => gitCompleteMerge(root, message))
  handle('git:abortMerge', (root: string) => gitAbortMerge(root))
}
