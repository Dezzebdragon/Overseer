// Domain types shared across processes. Single source of truth.

export type Eol = 'lf' | 'crlf'

export interface DirEntry {
  /** Absolute path. Also used as the stable tree node id. */
  path: string
  name: string
  isDir: boolean
}

export interface FileReadResult {
  path: string
  content: string
  eol: Eol
  encoding: 'utf-8'
  mtimeMs: number
  /** Set when the file was refused (too large or binary). content is empty. */
  refused?: 'too-large' | 'binary'
}

export interface WriteArgs {
  path: string
  content: string
  eol: Eol
}

export interface WriteResult {
  path: string
  mtimeMs: number
}

export interface WorkspaceInfo {
  root: string
  name: string
  /** Immediate children of the root folder. */
  entries: DirEntry[]
  /** Persisted per-workspace UI state, restored on open. */
  state: WorkspaceState
}

export interface OpenTabState {
  path: string
}

export interface WorkspaceState {
  openTabs: OpenTabState[]
  activePath: string | null
  expandedDirs: string[]
  trackers: TrackerInstance[]
  hub: HubViewState
  dirCommit?: string | null
  fileCommits?: Record<string, string>
}

export const EMPTY_WORKSPACE_STATE: WorkspaceState = {
  openTabs: [],
  activePath: null,
  expandedDirs: [],
  trackers: [],
  hub: { selectedRel: null, drawerOpen: false }
}

/** A single filesystem change coming from the watcher. */
export interface FsChange {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  path: string
}

export interface FsChangeBatch {
  root: string
  changes: FsChange[]
}

// ---- templates -------------------------------------------------------

/** A document that ships with the app's default template. */
export interface BuiltinDoc {
  id: string
  relPath: string
  label: string
}

/** One file inside a template, with its on-disk size for the file list. */
export interface TemplateFile {
  relPath: string
  sizeBytes: number
}

export interface TemplateInfo {
  name: string
  files: TemplateFile[]
  isDefault: boolean
  /** Files toggled off; they are not scaffolded into new projects. */
  disabled: string[]
}

// ---- trackers --------------------------------------------------------

export interface ProjectStats {
  sizeBytes: number
  fileCount: number
}

/** A user-pinned tracker (project-scoped). Kept storage-agnostic. */
export interface TrackerInstance {
  instanceId: string
  definitionId: string
  /** Optional parameters (e.g. a commit sha + metric) for parameterized trackers. */
  params?: Record<string, string>
  /** Captured at track time so "show original" can navigate back. */
  origin: { view: string | null; anchor: string | null }
  title?: string
  description?: string
  color?: string
}

// ---- projects (scaffolding) ------------------------------------------

export interface ProjectConfig {
  schemaVersion: number
  name: string
  template: string
  paths: Record<string, string> // file name -> project-relative path
  requiredDocs: string[] // file names (keys into paths) — source of truth for "missing"
  scaffoldedDocs: string[] // file names copied from the template at scaffold time
}

/** One coordination file, as shown in the Hub repair dock. */
export interface RepairFile {
  name: string
  path: string // project-relative
  required: boolean // in config.requiredDocs (source of truth)
  present: boolean
  generated: boolean // config/state → regenerated, not template-copied
  builtin: boolean // a default-app-template file
}

export interface RepairInfo {
  template: string
  files: RepairFile[]
}

export interface ApplyRepairResult {
  ok: boolean
  applied: string[]
  regenerated: string[]
  /** Names selected that the current template can't supply → whole apply cancelled. */
  missingFromTemplate: string[]
  template: string
}

export type WorkflowMode = 'flat' | 'gitNative'
export type TaskPriority = 'low' | 'medium' | 'high'

/** A pipeline task, persisted in big-state.json. All fields required. */
export interface PipelineTask {
  id: string
  agent: string
  title: string
  description: string
  stage: string
  priority: TaskPriority
  createdAt: string
}

/** Project-level config in big-config.json (kept separate from big-mcp.config.json). */
export interface BigConfig {
  workflowMode: WorkflowMode
}

export interface ProjectState {
  schemaVersion: number
  nextId: number
  tasks: PipelineTask[]
}

/** Initialization status used by the project popup badges (and Hub later). */
export interface ProjectStatus {
  initialized: boolean
  damaged: boolean
  required: string[]
  missing: string[]
}

// ---- hub -------------------------------------------------------------

/** A managed project file surfaced in the Hub (templated docs + config/state). */
export interface HubFile {
  relPath: string
  absPath: string
  sizeBytes: number
}

// ---- git -------------------------------------------------------------

export interface GitRef {
  name: string
  kind: 'head' | 'remote' | 'tag'
  sha: string
  isHead: boolean
}

export interface GitCommit {
  sha: string
  shortSha: string
  parents: string[]
  author: string
  email: string
  dateIso: string
  subject: string
  body: string
  refs: GitRef[]
  lane: number
  isMerge: boolean
  isBranchPoint: boolean
}

export interface GitGraphData {
  isRepo: boolean
  headSha: string | null
  commits: GitCommit[]
  laneCount: number
  refs: GitRef[]
}

/** Lane-based metrics for a commit (same branch = its drawn lane). */
export interface GitCommitMetrics {
  inBranch: number
  ahead: number
  behind: number
}

// ---- hub view state (persisted per workspace) ------------------------

export interface HubViewState {
  selectedRel: string | null
  drawerOpen: boolean
}

/** A commit that touched a specific file (for the version navigator). */
export interface GitFileCommit {
  sha: string
  shortSha: string
  subject: string
  author: string
  dateIso: string
  additions: number
  deletions: number
}

/** One changed path in a commit (git diff-tree --name-status). */
export interface CommitFileChange {
  status: string // A | M | D | R | C | T ...
  path: string
  oldPath?: string
}

// ---- git write actions -----------------------------------------------

export interface GitActionResult {
  ok: boolean
  error?: string
  detached?: boolean
}
export interface GitMergeResult {
  ok: boolean
  conflicts?: string[]
  error?: string
}
export interface GitBranches {
  branches: string[]
  current: string
  detached: boolean
}
export interface GitMergeState {
  merging: boolean
  conflicts: string[]
  message: string
}
export interface GitConflictVersions {
  base: string
  ours: string
  theirs: string
}

// ---- local ai agents (mcp config detection) -------------------------

export type AgentHealth = 'active' | 'mismatch' | 'missing' | 'not_found'

export interface AgentInfo {
  id: string
  name: string
  /** config file exists on disk */
  found: boolean
  configPath: string
  /** project root our server entry currently points at, if any */
  registeredPath: string | null
  health: AgentHealth
  /** human-readable reason for a mismatch */
  problem?: string
}

/** An agent detected on this machine (its config file exists). */
export interface AgentDetect {
  id: string
  name: string
  configPath: string
  health: AgentHealth
}

/** A dry-run of registering an agent: what will be written, over what. */
export interface RegisterPlan {
  agentId: string
  name: string
  configPath: string
  /** Where the entry is written (all agents use user/global scope). */
  scope: string
  /** Current server URL in the config, or null if not present. */
  before: string | null
  /** URL that will be written. */
  after: string
  /** True when an existing, differing entry will be replaced. */
  willOverwrite: boolean
  /** True when our entry is already present (possibly identical). */
  present: boolean
}

// ---- terminals ------------------------------------------------------

/** A detected built-in system shell (or an agent launcher) that backs a terminal. */
export interface ShellProfile {
  id: string
  label: string
  path: string
  args?: string[]
  /** 'agent' entries spawn the default shell and then auto-run an agent command. */
  kind?: 'shell' | 'agent'
  agentId?: string
}

/** A live (or exited) terminal instance backed by a PTY in main. */
export interface TerminalInfo {
  id: string
  profileId: string
  title: string
  pid: number
  cwd: string
  exited: boolean
  exitCode?: number
}

// ---- app log --------------------------------------------------------

export type LogLevel = 'info' | 'warning' | 'error' | 'test'

/** A single entry in the app-wide log stream. */
export interface LogEntry {
  id: string
  /** epoch ms */
  ts: number
  level: LogLevel
  /** where it came from (view id, subsystem, etc.) */
  source: string
  message: string
}

// ---- github account -------------------------------------------------

export interface GithubAccount {
  login: string
  name: string | null
  avatarUrl: string | null
}

export interface GithubRepo {
  fullName: string
  name: string
  cloneUrl: string
  private: boolean
  description: string | null
  updatedAt: string
}

/** Everything the renderer needs to render the Account view + gate Clone. */
export interface AccountState {
  clientId: string | null
  accounts: GithubAccount[]
  selectedAccount: string | null
  connected: GithubAccount | null
}

/** User-facing device-flow info shown while authorizing. */
export interface DeviceCodeInfo {
  userCode: string
  verificationUri: string
}
