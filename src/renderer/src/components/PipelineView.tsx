import { useEffect, useMemo, useState } from 'react'
import type { PipelineTask } from '@shared/types'
import { useStore } from '../store'
import {
  usePipeline,
  WORKFLOW_COLUMNS,
  WORKFLOW_LABEL,
  WORKFLOW_FINAL
} from '../pipelineStore'
import { ViewSettingsMenu } from './ViewSettingsMenu'
import { Modal } from './Modal'
import { AddTaskModal } from './AddTaskModal'
import { ContextMenu, type CtxItem } from './ContextMenu'

const PRIORITY_COLOR: Record<string, string> = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#ef4444'
}

function TaskCard({
  task,
  columns,
  showAgent,
  showPriority
}: {
  task: PipelineTask
  columns: string[]
  showAgent: boolean
  showPriority: boolean
}): JSX.Element {
  const moveTask = usePipeline((s) => s.moveTask)
  const addTracker = useStore((s) => s.addTracker)
  const trackers = useStore((s) => s.trackers)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const i = columns.indexOf(task.stage)
  const atStart = i <= 0
  const atEnd = i >= columns.length - 1

  const tracked = trackers.some(
    (t) => t.definitionId === 'pipeline.taskState' && t.params?.taskId === task.id
  )
  const items: CtxItem[] = [
    tracked
      ? { label: 'Tracking this task', disabled: true, hint: 'Already tracked' }
      : {
          label: "Track this task's state",
          onClick: () =>
            addTracker(
              'pipeline.taskState',
              { view: 'pipeline', anchor: null },
              { taskId: task.id, title: task.title }
            )
        }
  ]

  return (
    <div
      className="task-card"
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <div className="task-card-top">
        <span className="task-title">{task.title}</span>
        {showPriority && (
          <span className="task-priority" style={{ color: PRIORITY_COLOR[task.priority] ?? '#8b92a5' }}>
            {task.priority}
          </span>
        )}
      </div>
      {task.description && <div className="task-desc">{task.description}</div>}
      <div className="task-card-foot">
        {showAgent && <span className="task-agent">@{task.agent}</span>}
        <div className="task-arrows">
          <button
            className="task-arrow"
            disabled={atStart}
            onClick={() => moveTask(task.id, -1)}
            title="Move back"
          >
            ◀
          </button>
          <button
            className="task-arrow"
            disabled={atEnd}
            onClick={() => moveTask(task.id, 1)}
            title="Move forward"
          >
            ▶
          </button>
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  )
}

function ColHead({ col, count }: { col: string; count: number }): JSX.Element {
  const addTracker = useStore((s) => s.addTracker)
  const trackers = useStore((s) => s.trackers)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const tracked = trackers.some(
    (t) => t.definitionId === 'pipeline.stageCount' && t.params?.stage === col
  )
  const items: CtxItem[] = [
    tracked
      ? { label: `Tracking "${col}" count`, disabled: true, hint: 'Already tracked' }
      : {
          label: `Track number of tasks in "${col}"`,
          onClick: () =>
            addTracker('pipeline.stageCount', { view: 'pipeline', anchor: null }, { stage: col })
        }
  ]

  return (
    <div
      className="pipeline-col-head"
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <span className="pipeline-col-name">{col}</span>
      <span className="pipeline-col-count">{count}</span>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  )
}

export function PipelineView(): JSX.Element {
  const root = useStore((s) => s.root)
  const showAgent = useStore((s) => s.settings.pipelineShowAgent ?? true)
  const showPriority = useStore((s) => s.settings.pipelineShowPriority ?? true)

  const load = usePipeline((s) => s.load)
  const tasks = usePipeline((s) => s.tasks)
  const workflowMode = usePipeline((s) => s.workflowMode)
  const switchWorkflow = usePipeline((s) => s.switchWorkflow)
  const countNotFinal = usePipeline((s) => s.countNotFinal)

  const [showAdd, setShowAdd] = useState(false)
  const [showSwitch, setShowSwitch] = useState(false)

  useEffect(() => {
    if (root) void load(root)
  }, [root, load])

  const columns = WORKFLOW_COLUMNS[workflowMode]
  const byStage = useMemo(() => {
    const m: Record<string, PipelineTask[]> = {}
    columns.forEach((c) => (m[c] = []))
    for (const t of tasks) (m[t.stage] ??= []).push(t)
    return m
  }, [tasks, columns])

  const otherMode = workflowMode === 'flat' ? 'gitNative' : 'flat'

  // Empty board: nothing to remap, so switch immediately with no confirm modal.
  const onSwitchClick = (): void => {
    if (tasks.length === 0) void switchWorkflow()
    else setShowSwitch(true)
  }

  const header = (
    <div className="template-header">
      <div className="header-left">
        <span className="template-label">Pipeline</span>
        <ViewSettingsMenu sectionId="pipeline" label="Pipeline view settings" />
      </div>
      <div className="header-right pipeline-header-right">
        <button className="btn btn-sm" onClick={onSwitchClick}>Switch workflow</button>
        <span className="pipeline-mode">
          workflow mode <strong>{WORKFLOW_LABEL[workflowMode]}</strong>
        </span>
        <button
          className="btn btn-sm btn-primary pipeline-add"
          onClick={() => setShowAdd(true)}
          disabled={!root}
        >
          + Add task
        </button>
      </div>
    </div>
  )

  if (!root) {
    return (
      <div className="view view-pipeline">
        {header}
        <div className="hub-empty">Open a project to use the Pipeline.</div>
      </div>
    )
  }

  return (
    <div className="view view-pipeline">
      {header}
      <div className="pipeline-board">
        {columns.map((col) => (
          <div className="pipeline-col" key={col}>
            <ColHead col={col} count={byStage[col]?.length ?? 0} />
            <div className="pipeline-col-body">
              {(byStage[col] ?? []).map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  columns={columns}
                  showAgent={showAgent}
                  showPriority={showPriority}
                />
              ))}
              {(byStage[col]?.length ?? 0) === 0 && (
                <div className="pipeline-col-empty">No tasks</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {showAdd && <AddTaskModal columns={columns} onClose={() => setShowAdd(false)} />}

      {showSwitch && (
        <Modal title="Switch workflow" onClose={() => setShowSwitch(false)}>
          <p className="modal-text">
            Switch to <strong>{WORKFLOW_LABEL[otherMode]}</strong>? Task stages will be remapped to the
            new workflow's columns.
          </p>
          {countNotFinal() > 0 && (
            <div className="modal-error">
              ⚠ {countNotFinal()} task{countNotFinal() === 1 ? '' : 's'} not in the final stage (
              {WORKFLOW_FINAL[workflowMode]}). Remapping is lossy and may collapse detail.
            </div>
          )}
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setShowSwitch(false)}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                void switchWorkflow()
                setShowSwitch(false)
              }}
            >
              Switch
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
