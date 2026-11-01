import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentInfo, GitCommitMetrics, ProjectStats } from '@shared/types'
import { useStore } from '../store'
import { useNotifications } from '../notificationStore'
import { usePipeline, WORKFLOW_COLUMNS } from '../pipelineStore'
import { ipc } from '../ipc'
import {
  DEFAULT_TRACKER_IDS,
  SESSION_START,
  getTrackable,
  type TrackableDefinition,
  type TrackerContext
} from '../trackables'
import { formatValue, isTrackerNA, typeDefaultColor } from '../trackerTypes'
import { highlight } from '../highlight'
import { TrackerCell } from './TrackerCell'
import { AgentConfigSection } from './AgentConfigSection'

const AGENT_TOAST_COLOR: Record<string, string> = {
  active: '#3fb950',
  mismatch: '#f5a623',
  missing: '#e5484d',
  not_found: '#8a8a8a'
}

const STATS_INTERVAL_MS = 15_000
const TICK_MS = 1_000

export function OverviewView(): JSX.Element {
  const root = useStore((s) => s.root)
  const workspaceName = useStore((s) => s.workspaceName)
  const tabs = useStore((s) => s.tabs)
  const dirty = useStore((s) => s.dirty)
  const recentProjects = useStore((s) => s.recentProjects)
  const theme = useStore((s) => s.settings.theme)
  const trackerColors = useStore((s) => s.settings.trackerColors)
  const trackers = useStore((s) => s.trackers)
  const setTrackerColor = useStore((s) => s.setTrackerColor)
  const setTrackerTitle = useStore((s) => s.setTrackerTitle)
  const setTrackerDescription = useStore((s) => s.setTrackerDescription)
  const removeTracker = useStore((s) => s.removeTracker)
  const setDefaultTrackerColor = useStore((s) => s.setDefaultTrackerColor)

  const [stats, setStats] = useState<ProjectStats | null>(null)
  const [gitMetrics, setGitMetrics] = useState<Record<string, GitCommitMetrics>>({})
  const [, setTick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), TICK_MS)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!root) {
      setStats(null)
      return
    }
    let cancelled = false
    const load = (): void => {
      void ipc.projectStats(root).then((s) => !cancelled && setStats(s)).catch(() => undefined)
    }
    load()
    const t = setInterval(load, STATS_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [root])

  const commitShas = trackers
    .map((t) => t.params?.sha)
    .filter((s): s is string => Boolean(s))
  const shasKey = commitShas.join(',')

  useEffect(() => {
    if (!root || commitShas.length === 0) {
      setGitMetrics({})
      return
    }
    let cancelled = false
    const load = (): void => {
      void ipc
        .gitCommitMetrics(root, commitShas)
        .then((m) => !cancelled && setGitMetrics(m))
        .catch(() => undefined)
    }
    load()
    const t = setInterval(load, STATS_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, shasKey])

  const notifications = useNotifications((s) => s.notifications)
  const notifTotal = notifications.length
  const notifInfo = notifications.filter((n) => n.type === 'info').length
  const notifWarning = notifications.filter((n) => n.type === 'warning').length
  const notifError = notifications.filter((n) => n.type === 'error').length

  const toast = useNotifications((s) => s.toast)
  const notify = useNotifications((s) => s.notify)
  const resolveNotif = useNotifications((s) => s.resolve)
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const prevHealth = useRef<Record<string, string>>({})

  const loadAgents = useCallback(() => {
    void ipc.agentsList(root).then(setAgents)
  }, [root])

  useEffect(() => {
    loadAgents()
    return window.api.on('agents:changed', (list) => setAgents(list))
  }, [loadAgents])

  useEffect(() => {
    for (const a of agents) {
      const prev = prevHealth.current[a.id]
      if (prev && prev !== a.health) {
        toast({ title: `${a.name}: ${a.health.replace('_', ' ')}`, color: AGENT_TOAST_COLOR[a.health] })
      }
      prevHealth.current[a.id] = a.health
      const key = `agent:${a.id}`
      if (a.health === 'mismatch') {
        notify({
          type: 'warning',
          description: `${a.name} is registered to a different project`,
          target: { view: 'overview', anchor: null },
          sticky: true,
          stickyHint: 'Fix or unregister the agent to resolve',
          resolveKey: key
        })
      } else if (a.health === 'missing') {
        notify({
          type: 'error',
          description: `${a.name} is not registered to this project`,
          target: { view: 'overview', anchor: null },
          sticky: true,
          stickyHint: 'Register the agent to resolve',
          resolveKey: key
        })
      } else {
        resolveNotif(key)
      }
    }
  }, [agents, notify, resolveNotif, toast])

  // Pipeline data for pipeline trackers. Load it here so trackers resolve even if
  // the Pipeline view was never opened this session.
  const pipelineTasks = usePipeline((s) => s.tasks)
  const pipelineMode = usePipeline((s) => s.workflowMode)
  const pipelineRoot = usePipeline((s) => s.root)
  const loadPipeline = usePipeline((s) => s.load)
  useEffect(() => {
    if (root && pipelineRoot !== root) void loadPipeline(root)
  }, [root, pipelineRoot, loadPipeline])

  const [repairCounts, setRepairCounts] = useState<{ required: number; missing: number }>({
    required: 0,
    missing: 0
  })
  useEffect(() => {
    if (!root) {
      setRepairCounts({ required: 0, missing: 0 })
      return
    }
    let cancelled = false
    const load = (): void => {
      void ipc
        .hubRepairInfo(root)
        .then((info) => {
          if (cancelled) return
          const required = info.files.filter((f) => f.required).length
          const missing = info.files.filter((f) => f.required && !f.present).length
          setRepairCounts({ required, missing })
        })
        .catch(() => undefined)
    }
    load()
    const t = setInterval(load, STATS_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [root])

  const ctx: TrackerContext = {
    projectRoot: root,
    projectName: workspaceName,
    tabsCount: tabs.length,
    dirtyCount: Object.values(dirty).filter(Boolean).length,
    recentCount: recentProjects.length,
    theme,
    uptimeSec: (Date.now() - SESSION_START) / 1000,
    stats,
    gitMetrics,
    notifTotal,
    notifInfo,
    notifWarning,
    notifError,
    requiredCount: repairCounts.required,
    missingCount: repairCounts.missing,
    agents,
    pipelineStages: root ? WORKFLOW_COLUMNS[pipelineMode] : [],
    pipelineTasks: root ? pipelineTasks : []
  }

  const defaultDefs = DEFAULT_TRACKER_IDS.map(getTrackable).filter(
    (d): d is TrackableDefinition => Boolean(d)
  )

  const hasOrigin = (o?: { view: string | null; anchor: string | null }): boolean =>
    Boolean(o && (o.view || o.anchor))

  return (
    <div className="view view-overview">
      <div className="overview-scroll">
        <div className="overview-section-label">App</div>
        <div className="tracker-grid">
          {defaultDefs.map((def) => {
            const raw = def.resolve(ctx)
            const naReason = isTrackerNA(raw) ? raw.reason : undefined
            const color = trackerColors?.[def.id] ?? typeDefaultColor(def.type)
            return (
              <TrackerCell
                key={def.id}
                title={def.title(ctx)}
                description={def.description}
                valueText={formatValue(def.type, raw)}
                color={color}
                isNA={raw === null || raw === undefined || naReason !== undefined}
                naReason={naReason}
                currentColor={trackerColors?.[def.id]}
                canShowOriginal={hasOrigin(def.origin)}
                onShowOriginal={() =>
                  highlight(def.origin?.anchor ?? null, def.origin?.view ?? null)
                }
                onRecolor={(c) => void setDefaultTrackerColor(def.id, c)}
              />
            )
          })}
        </div>

        <div className="overview-separator">
          <span>Your trackers</span>
        </div>

        {trackers.length === 0 ? (
          <div className="overview-empty">
            Right-click trackable items — the project path, or commits in the Git view — and
            choose “Track” to pin them here.
          </div>
        ) : (
          <div className="tracker-grid">
            {trackers.map((inst) => {
              const def = getTrackable(inst.definitionId)
              if (!def) return null
              const raw = def.resolve(ctx, inst.params)
              const naReason = isTrackerNA(raw) ? raw.reason : undefined
              const color = inst.color ?? typeDefaultColor(def.type)
              return (
                <TrackerCell
                  key={inst.instanceId}
                  title={inst.title ?? def.title(ctx, inst.params)}
                  description={inst.description ?? def.description}
                  valueText={formatValue(def.type, raw)}
                  color={color}
                  isNA={raw === null || raw === undefined || naReason !== undefined}
                  naReason={naReason}
                  currentColor={inst.color}
                  canShowOriginal={hasOrigin(inst.origin)}
                  onShowOriginal={() => highlight(inst.origin.anchor, inst.origin.view)}
                  onRecolor={(c) => setTrackerColor(inst.instanceId, c)}
                  onRemove={() => removeTracker(inst.instanceId)}
                  onSetTitle={(v) => setTrackerTitle(inst.instanceId, v)}
                  onSetDescription={(v) => setTrackerDescription(inst.instanceId, v)}
                />
              )
            })}
          </div>
        )}

        <div className="overview-separator">
          <span>Agent configurations</span>
        </div>
        <AgentConfigSection agents={agents} root={root} onRefresh={loadAgents} />
      </div>
    </div>
  )
}
