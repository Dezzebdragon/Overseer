import type {
  AccountState,
  AgentInfo,
  AgentDetect,
  RegisterPlan,
  LogEntry,
  LogLevel,
  ShellProfile,
  TerminalInfo,
  ApplyRepairResult,
  DeviceCodeInfo,
  GithubRepo,
  RepairInfo,
  CommitFileChange,
  DirEntry,
  FileReadResult,
  FsChangeBatch,
  GitActionResult,
  GitBranches,
  GitCommitMetrics,
  GitConflictVersions,
  GitFileCommit,
  GitGraphData,
  GitMergeResult,
  GitMergeState,
  BigConfig,
  ProjectState,
  HubFile,
  ProjectStats,
  ProjectStatus,
  TemplateInfo,
  WorkspaceInfo,
  WorkspaceState,
  WriteArgs,
  WriteResult
} from './types'

/**
 * Request/response channels: renderer -> main, awaits a typed reply.
 * Each entry maps a channel to [args tuple, return type].
 */
export interface RequestMap {
  'workspace:open': [[], WorkspaceInfo | null] // opens a native folder dialog
  'workspace:openPath': [[path: string], WorkspaceInfo | null] // open a known folder
  'workspace:close': [[], void]
  'workspace:saveState': [[state: WorkspaceState], void]
  'pm:getState': [[root: string], ProjectState]
  'pm:setState': [[root: string, state: ProjectState], void]
  'pm:getConfig': [[root: string], BigConfig]
  'pm:setConfig': [[root: string, config: BigConfig], void]
  'projects:recent': [[], string[]]
  'projects:pickAndAdd': [[], string[]] // dialog: add to recent, do NOT select
  'projects:removeRecent': [[path: string], string[]]
  'projects:forget': [[path: string], string[]] // remove recent + delete app-state
  'projects:scaffold': [[root: string], ProjectStatus]
  'projects:statuses': [[roots: string[]], Record<string, ProjectStatus>]
  'projects:lastOpened': [[], string | null]
  'hub:files': [[root: string], HubFile[]]
  // git (read-only)
  'git:graph': [[root: string], GitGraphData]
  'git:commitMetrics': [[root: string, shas: string[]], Record<string, GitCommitMetrics>]
  'git:fileAtCommit': [[root: string, relPath: string, hash: string], string]
  'git:fileHistory': [[root: string, relPath: string], GitFileCommit[]]
  'git:commitFiles': [[root: string, hash: string], CommitFileChange[]]
  'git:deletedPaths': [[root: string], string[]]
  'git:treeAtCommit': [[root: string, hash: string], string[]]
  'git:lastFileCommit': [[root: string, relPath: string], string | null]
  'git:commitBody': [[root: string, sha: string], string]
  'git:commit': [[root: string, message: string, stageAll: boolean], GitActionResult]
  'git:createBranch': [[root: string, name: string, base: string, checkout: boolean], GitActionResult]
  'git:checkout': [[root: string, target: string], GitActionResult]
  'git:merge': [[root: string, branch: string, noFf: boolean], GitMergeResult]
  'git:branches': [[root: string], GitBranches]
  'git:mergeState': [[root: string], GitMergeState]
  'git:conflictVersions': [[root: string, relPath: string], GitConflictVersions]
  'git:stageResolved': [[root: string, relPath: string, content: string], GitActionResult]
  'git:completeMerge': [[root: string, message: string | undefined], GitActionResult]
  'git:abortMerge': [[root: string], GitActionResult]
  'dir:read': [[path: string], DirEntry[]]
  'file:read': [[path: string], FileReadResult]
  'file:write': [[args: WriteArgs], WriteResult]
  'file:create': [[path: string, isDir: boolean], void]
  'file:rename': [[from: string, to: string], void]
  'file:delete': [[path: string], void]
  'settings:get': [[], AppSettings]
  'settings:set': [[settings: Partial<AppSettings>], AppSettings]
  // templates (global; shared across projects)
  'templates:list': [[], TemplateInfo[]]
  'templates:readFile': [[name: string, relPath: string], string]
  'templates:writeFile': [[name: string, relPath: string, content: string], void]
  'templates:create': [[name: string], TemplateInfo]
  'templates:duplicate': [[sourceName: string, newName: string], TemplateInfo]
  'templates:delete': [[name: string], void]
  'templates:addFile': [[name: string, relPath: string], void]
  'templates:deleteFile': [[name: string, relPath: string], void]
  'templates:setFileRequired': [[name: string, relPath: string, required: boolean], TemplateInfo[]]
  'templates:revealFile': [[name: string, relPath: string], void]
  'templates:getSelected': [[], string]
  'templates:setSelected': [[name: string], void]
  // OS integration
  'shell:showItem': [[path: string], void]
  // metrics (for async trackers)
  'metrics:projectStats': [[root: string], ProjectStats]
  // github account
  'account:get': [[], AccountState]
  'account:setClientId': [[id: string | null], AccountState]
  'account:beginConnect': [[], DeviceCodeInfo]
  'account:cancelConnect': [[], void]
  'account:disconnect': [[], AccountState]
  'account:forget': [[login: string], AccountState]
  'github:listRepos': [[], GithubRepo[]]
  'github:clone': [[cloneUrl: string, destParent: string], { path: string }]
  'dialog:pickDirectory': [[], string | null]
  'dialog:pickFile': [[], string | null]
  'hub:repairInfo': [[root: string], RepairInfo]
  'hub:setRequiredDocs': [[root: string, names: string[]], RepairInfo]
  'hub:addRequiredFile': [[root: string, sourceAbs: string], RepairInfo]
  'hub:applyRepair': [[root: string, names: string[]], ApplyRepairResult]
  'window:action': [[action: string], void]
  'window:isMaximized': [[], boolean]
  'agents:list': [[root: string | null], AgentInfo[]]
  'agents:detect': [[], AgentDetect[]]
  'agents:planRegister': [[id: string], RegisterPlan]
  'agents:register': [[id: string], AgentInfo[]]
  'agents:unregister': [[id: string], AgentInfo[]]
  'agents:openBackup': [[id: string], boolean]
  'log:history': [[], LogEntry[]]
  'log:write': [[level: LogLevel, source: string, message: string], void]
  'log:clear': [[], void]
  'term:profiles': [[], ShellProfile[]]
  'term:list': [[], TerminalInfo[]]
  'term:create': [[profileId: string, cwd: string | null], TerminalInfo]
  'term:write': [[id: string, data: string], void]
  'term:resize': [[id: string, cols: number, rows: number], void]
  'term:kill': [[id: string], void]
  'clipboard:read': [[], string]
  'clipboard:write': [[text: string], void]
}

/** Event channels: main -> renderer, fire-and-forget stream. */
export interface EventMap {
  'fs:changed': FsChangeBatch
  /** A menu item or native accelerator asked the renderer to run a command. */
  'menu:command': { commandId: string }
  'git:changed': { root: string }
  /** Device-flow authorization completed. */
  'account:connected': AccountState
  /** Device-flow authorization failed/cancelled. */
  'account:authError': { message: string }
  'window:maximizeChanged': boolean
  'agents:changed': AgentInfo[]
  /** A new app-log entry was appended. */
  'log:entry': LogEntry
  /** Output from a terminal's PTY. */
  'term:data': { id: string; data: string }
  /** A terminal's PTY exited. */
  'term:exit': { id: string; exitCode: number }
}

export interface AppSettings {
  theme: 'dark' | 'light'
  /** Per-default-tracker color overrides, keyed by definition id. App-level. */
  trackerColors?: Record<string, string>
  // Scaffolding options (all default on).
  initGitOnScaffold?: boolean
  generateConfig?: boolean
  generateState?: boolean
  requireAllFiles?: boolean
  /** Which template(s) determine a project's required files. */
  hubRequirement?: 'default' | 'project' | 'default+project'
  /** Explorer: hide dotfiles. */
  explorerShowHidden?: boolean
  toastDuration?: string
  muteError?: boolean
  muteWarning?: boolean
  muteInfo?: boolean
  logsAutoScroll?: boolean
  /** Logs: auto-run the agent command when opening an agent terminal. */
  logsAutoStartAgents?: boolean
  /** Logs: cd new terminals into the current project directory. */
  logsUseProjectDir?: boolean
  toolsShowDisabled?: boolean
  /** Explorer: show history-only (deleted) files as ghost nodes. */
  explorerShowDeleted?: boolean
  /** Pipeline: show the agent on task cards. */
  pipelineShowAgent?: boolean
  /** Pipeline: show the priority tag on task cards. */
  pipelineShowPriority?: boolean
  /** Editable command strings written into agent configs, keyed by command-setting id. */
  agentCommands?: Record<string, string>
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  trackerColors: {},
  initGitOnScaffold: true,
  generateConfig: true,
  generateState: true,
  requireAllFiles: true,
  hubRequirement: 'project',
  explorerShowHidden: false,
  toastDuration: '3500',
  muteError: false,
  muteWarning: false,
  muteInfo: false,
  logsAutoScroll: true,
  logsAutoStartAgents: true,
  logsUseProjectDir: true,
  toolsShowDisabled: false,
  explorerShowDeleted: false,
  pipelineShowAgent: true,
  pipelineShowPriority: true
}

export type RequestChannel = keyof RequestMap
export type EventChannel = keyof EventMap

export type RequestArgs<C extends RequestChannel> = RequestMap[C][0]
export type RequestResult<C extends RequestChannel> = RequestMap[C][1]

/** Allowlist enforced in the preload bridge so the renderer can only reach known channels. */
export const REQUEST_CHANNELS: RequestChannel[] = [
  'workspace:open',
  'workspace:openPath',
  'workspace:close',
  'workspace:saveState',
  'pm:getState',
  'pm:setState',
  'pm:getConfig',
  'pm:setConfig',
  'projects:recent',
  'projects:pickAndAdd',
  'projects:removeRecent',
  'projects:forget',
  'projects:scaffold',
  'projects:statuses',
  'projects:lastOpened',
  'hub:files',
  'account:get',
  'account:setClientId',
  'account:beginConnect',
  'account:cancelConnect',
  'account:disconnect',
  'account:forget',
  'github:listRepos',
  'github:clone',
  'dialog:pickDirectory',
  'dialog:pickFile',
  'hub:repairInfo',
  'hub:setRequiredDocs',
  'hub:addRequiredFile',
  'hub:applyRepair',
  'window:action',
  'window:isMaximized',
  'agents:list',
  'agents:detect',
  'agents:planRegister',
  'agents:register',
  'agents:unregister',
  'agents:openBackup',
  'log:history',
  'log:write',
  'log:clear',
  'term:profiles',
  'term:list',
  'term:create',
  'term:write',
  'term:resize',
  'term:kill',
  'clipboard:read',
  'clipboard:write',
  'git:graph',
  'git:commitMetrics',
  'git:fileAtCommit',
  'git:fileHistory',
  'git:commitFiles',
  'git:deletedPaths',
  'git:treeAtCommit',
  'git:lastFileCommit',
  'git:commitBody',
  'git:commit',
  'git:createBranch',
  'git:checkout',
  'git:merge',
  'git:branches',
  'git:mergeState',
  'git:conflictVersions',
  'git:stageResolved',
  'git:completeMerge',
  'git:abortMerge',
  'dir:read',
  'file:read',
  'file:write',
  'file:create',
  'file:rename',
  'file:delete',
  'settings:get',
  'settings:set',
  'templates:list',
  'templates:readFile',
  'templates:writeFile',
  'templates:create',
  'templates:duplicate',
  'templates:delete',
  'templates:addFile',
  'templates:deleteFile',
  'templates:setFileRequired',
  'templates:revealFile',
  'templates:getSelected',
  'templates:setSelected',
  'shell:showItem',
  'metrics:projectStats'
]

export const EVENT_CHANNELS: EventChannel[] = ['fs:changed', 'menu:command', 'git:changed', 'account:connected', 'account:authError', 'window:maximizeChanged', 'agents:changed', 'log:entry', 'term:data', 'term:exit']
