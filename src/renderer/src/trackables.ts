import type { GitCommitMetrics, ProjectStats } from '@shared/types'
import type { TrackerTypeId } from './trackerTypes'
import { trackerNA } from './trackerTypes'

/** Everything a resolver may read. Extend as new trackables need more inputs. */
export interface TrackerContext {
  projectRoot: string | null
  projectName: string | null
  tabsCount: number
  dirtyCount: number
  recentCount: number
  theme: string
  uptimeSec: number
  stats: ProjectStats | null
  /** Lane metrics keyed by commit sha (for commit trackers). */
  gitMetrics: Record<string, GitCommitMetrics>
  /** Notification counts (app-scoped). */
  notifTotal: number
  notifInfo: number
  notifWarning: number
  notifError: number
  /** Repair counts (project-scoped). */
  requiredCount: number
  missingCount: number
  /** Local AI agents (machine + this-project health). */
  agents: import('@shared/types').AgentInfo[]
  /** Pipeline: the current workflow's stage columns (for "does this stage still exist"). */
  pipelineStages: string[]
  /** Pipeline: all tasks in the active project. */
  pipelineTasks: import('@shared/types').PipelineTask[]
}

export interface TrackableDefinition {
  id: string
  /** Short static name for menus. */
  label: string
  /** Cell title; may use the project name or per-instance params. */
  title: (ctx: TrackerContext, params?: Record<string, string>) => string
  /** Default description (doubles as the cell's hover hint). */
  description: string
  type: TrackerTypeId
  scope: 'app' | 'project'
  origin?: { view: string | null; anchor: string | null }
  /** Pure over the context (+ params); return null for "not applicable". */
  resolve: (ctx: TrackerContext, params?: Record<string, string>) => unknown
}

/** Fixed at module load; used by the session-uptime tracker. */
export const SESSION_START = Date.now()

export const TRACKABLES: TrackableDefinition[] = [
  // --- app-scoped (the default grid) ---
  {
    id: 'app.openTabs',
    label: 'Open tabs',
    title: () => 'Open tabs',
    description: 'Number of files currently open in the editor.',
    type: 'int',
    scope: 'app',
    origin: { view: 'explorer', anchor: null },
    resolve: (ctx) => ctx.tabsCount
  },
  {
    id: 'app.unsavedFiles',
    label: 'Unsaved files',
    title: () => 'Unsaved files',
    description: 'Open files with unsaved changes.',
    type: 'int',
    scope: 'app',
    origin: { view: 'explorer', anchor: null },
    resolve: (ctx) => ctx.dirtyCount
  },
  {
    id: 'app.recentProjects',
    label: 'Recent projects',
    title: () => 'Recent projects',
    description: 'How many projects you have opened recently.',
    type: 'int',
    scope: 'app',
    resolve: (ctx) => ctx.recentCount
  },
  {
    id: 'app.uptime',
    label: 'Session uptime',
    title: () => 'Session uptime',
    description: 'Time elapsed since the app started.',
    type: 'duration',
    scope: 'app',
    resolve: (ctx) => ctx.uptimeSec
  },
  {
    id: 'app.theme',
    label: 'Theme',
    title: () => 'Theme',
    description: 'The active color theme.',
    type: 'string',
    scope: 'app',
    origin: { view: 'settings', anchor: null },
    resolve: (ctx) => ctx.theme
  },

  // --- project-scoped (user-tracked from the header path) ---
  {
    id: 'project.name',
    label: 'Project name',
    title: () => 'Project name',
    description: 'Name of the active project.',
    type: 'string',
    scope: 'project',
    origin: { view: null, anchor: 'header.projectPath' },
    resolve: (ctx) => ctx.projectName
  },
  {
    id: 'project.path',
    label: 'Project path',
    title: () => 'Project path',
    description: 'Absolute path of the active project.',
    type: 'string',
    scope: 'project',
    origin: { view: null, anchor: 'header.projectPath' },
    resolve: (ctx) => ctx.projectRoot
  },
  {
    id: 'project.size',
    label: 'Project size',
    title: (ctx) => `${ctx.projectName ?? 'Project'} size`,
    description: 'Total size of the project on disk (excludes node_modules, .git).',
    type: 'bytes',
    scope: 'project',
    origin: { view: null, anchor: 'header.projectPath' },
    resolve: (ctx) => ctx.stats?.sizeBytes ?? null
  },
  {
    id: 'project.fileCount',
    label: 'Project files',
    title: (ctx) => `${ctx.projectName ?? 'Project'} files`,
    description: 'Number of files in the project (excludes node_modules, .git).',
    type: 'int',
    scope: 'project',
    origin: { view: null, anchor: 'header.projectPath' },
    resolve: (ctx) => ctx.stats?.fileCount ?? null
  },

  // --- git commit trackers (parameterized by sha) ---
  {
    id: 'git.commit',
    label: 'This commit',
    title: (_ctx, p) => `Commit ${p?.shortSha ?? ''}`,
    description: 'A tracked git commit.',
    type: 'string',
    scope: 'project',
    origin: { view: 'git', anchor: null },
    resolve: (_ctx, p) => p?.subject ?? p?.shortSha ?? null
  },
  {
    id: 'git.commit.inBranch',
    label: 'Commits in this branch',
    title: (_ctx, p) => `In branch · ${p?.shortSha ?? ''}`,
    description: 'Number of commits in the same branch (lane) as this commit.',
    type: 'int',
    scope: 'project',
    origin: { view: 'git', anchor: null },
    resolve: (ctx, p) => (p ? ctx.gitMetrics[p.sha]?.inBranch ?? null : null)
  },
  {
    id: 'git.commit.ahead',
    label: 'Commits ahead',
    title: (_ctx, p) => `Ahead · ${p?.shortSha ?? ''}`,
    description: 'Commits newer than this one on the same branch (lane).',
    type: 'int',
    scope: 'project',
    origin: { view: 'git', anchor: null },
    resolve: (ctx, p) => (p ? ctx.gitMetrics[p.sha]?.ahead ?? null : null)
  },
  {
    id: 'git.commit.behind',
    label: 'Commits behind',
    title: (_ctx, p) => `Behind · ${p?.shortSha ?? ''}`,
    description: 'Commits older than this one on the same branch (lane).',
    type: 'int',
    scope: 'project',
    origin: { view: 'git', anchor: null },
    resolve: (ctx, p) => (p ? ctx.gitMetrics[p.sha]?.behind ?? null : null)
  },

  // --- notifications (app-scoped) ---
  {
    id: 'notifications.total',
    label: 'Notifications',
    title: () => 'Notifications',
    description: 'Total notifications this session.',
    type: 'int',
    scope: 'app',
    resolve: (ctx) => ctx.notifTotal
  },
  {
    id: 'notifications.info',
    label: 'Info notifications',
    title: () => 'Info notifications',
    description: 'Info notifications this session.',
    type: 'int',
    scope: 'app',
    resolve: (ctx) => ctx.notifInfo
  },
  {
    id: 'notifications.warning',
    label: 'Warning notifications',
    title: () => 'Warning notifications',
    description: 'Warning notifications this session.',
    type: 'int',
    scope: 'app',
    resolve: (ctx) => ctx.notifWarning
  },
  {
    id: 'notifications.error',
    label: 'Error notifications',
    title: () => 'Error notifications',
    description: 'Error notifications this session.',
    type: 'int',
    scope: 'app',
    resolve: (ctx) => ctx.notifError
  },

  // --- repair (project-scoped) ---
  {
    id: 'project.requiredCount',
    label: 'Required files',
    title: (ctx) => `${ctx.projectName ?? 'Project'} required files`,
    description: 'Number of files this project requires.',
    type: 'int',
    scope: 'project',
    origin: { view: 'hub', anchor: null },
    resolve: (ctx) => ctx.requiredCount
  },
  {
    id: 'project.missingCount',
    label: 'Missing files',
    title: (ctx) => `${ctx.projectName ?? 'Project'} missing files`,
    description: 'Required files that are not present in the project.',
    type: 'int',
    scope: 'project',
    origin: { view: 'hub', anchor: null },
    resolve: (ctx) => ctx.missingCount
  },

  // --- local ai agents ---
  {
    id: 'agents.count',
    label: 'Agents',
    title: () => 'AI agents',
    description: 'Local AI agents detected on this machine.',
    type: 'int',
    scope: 'app',
    origin: { view: 'overview', anchor: null },
    resolve: (ctx) => ctx.agents.filter((a) => a.found).length
  },
  {
    id: 'agents.active',
    label: 'Active agents',
    title: () => 'Active agents',
    description: 'Agents registered to this project.',
    type: 'int',
    scope: 'app',
    origin: { view: 'overview', anchor: null },
    resolve: (ctx) => ctx.agents.filter((a) => a.health === 'active').length
  },
  {
    id: 'agents.mismatch',
    label: 'Mismatched agents',
    title: () => 'Mismatched agents',
    description: 'Agents registered to a different project or URL.',
    type: 'int',
    scope: 'app',
    origin: { view: 'overview', anchor: null },
    resolve: (ctx) => ctx.agents.filter((a) => a.health === 'mismatch').length
  },
  {
    id: 'agents.missing',
    label: 'Missing agents',
    title: () => 'Missing agents',
    description: 'Agents present but not registered to this project.',
    type: 'int',
    scope: 'app',
    origin: { view: 'overview', anchor: null },
    resolve: (ctx) => ctx.agents.filter((a) => a.health === 'missing').length
  },
  {
    id: 'agent.health',
    label: 'Agent health',
    title: (ctx, p) => {
      const a = p ? ctx.agents.find((x) => x.id === p.agent) : undefined
      return a ? `${a.name} health` : 'Agent health'
    },
    description: 'Registration health of a specific agent.',
    type: 'string',
    scope: 'app',
    origin: { view: 'overview', anchor: null },
    resolve: (ctx, p) => (p ? ctx.agents.find((x) => x.id === p.agent)?.health ?? null : null)
  },

  // --- pipeline (project-scoped, parameterized) ---
  {
    id: 'pipeline.stageCount',
    label: 'Tasks in stage',
    title: (_ctx, p) => `Tasks · ${p?.stage ?? ''}`,
    description: 'Number of pipeline tasks currently in this stage.',
    type: 'int',
    scope: 'project',
    origin: { view: 'pipeline', anchor: null },
    resolve: (ctx, p) => {
      if (!ctx.projectRoot || !p?.stage) return null
      // Stage removed by a workflow switch → the tracked target is gone.
      if (!ctx.pipelineStages.includes(p.stage)) {
        return trackerNA(`Stage "${p.stage}" isn't in the current workflow`)
      }
      return ctx.pipelineTasks.filter((t) => t.stage === p.stage).length
    }
  },
  {
    id: 'pipeline.taskState',
    label: 'Task state',
    // Title prefers the name captured at track time, so a deleted task still reads well.
    title: (_ctx, p) => (p?.title ? `State · ${p.title}` : 'Task state'),
    description: 'Current stage of a specific pipeline task.',
    type: 'string',
    scope: 'project',
    origin: { view: 'pipeline', anchor: null },
    resolve: (ctx, p) => {
      if (!ctx.projectRoot || !p?.taskId) return null
      const t = ctx.pipelineTasks.find((x) => x.id === p.taskId)
      return t ? t.stage : trackerNA('Task was deleted')
    }
  }
]

/** Shown in the default (app) grid, in this order. */
export const DEFAULT_TRACKER_IDS = [
  'app.openTabs',
  'app.unsavedFiles',
  'app.recentProjects',
  'app.uptime',
  'app.theme'
]

const BY_ID = new Map(TRACKABLES.map((t) => [t.id, t]))

export function getTrackable(id: string): TrackableDefinition | undefined {
  return BY_ID.get(id)
}
