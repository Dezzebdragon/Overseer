import { create } from 'zustand'
import type { PipelineTask, TaskPriority, WorkflowMode } from '@shared/types'
import { ipc } from './ipc'

export const WORKFLOW_COLUMNS: Record<WorkflowMode, string[]> = {
  flat: ['develop', 'review', 'done'],
  gitNative: ['analyze', 'architect', 'develop', 'qa', 'security', 'review', 'approval', 'merge']
}
export const WORKFLOW_FINAL: Record<WorkflowMode, string> = { flat: 'done', gitNative: 'merge' }
export const WORKFLOW_LABEL: Record<WorkflowMode, string> = { flat: 'Flat', gitNative: 'Git native' }

/** Lossy remap of a stage between the two workflows. */
export function remapStage(stage: string, from: WorkflowMode, to: WorkflowMode): string {
  if (from === to) return stage
  if (from === 'gitNative') {
    if (['analyze', 'architect', 'develop'].includes(stage)) return 'develop'
    if (['qa', 'security', 'review', 'approval'].includes(stage)) return 'review'
    return 'done' // merge -> done
  }
  // flat -> gitNative
  if (stage === 'develop') return 'develop'
  if (stage === 'review') return 'review'
  return 'merge' // done -> merge
}

export interface NewTaskFields {
  agent: string
  title: string
  description: string
  stage: string
  priority: TaskPriority
}

interface PipelineStore {
  root: string | null
  loading: boolean
  loaded: boolean
  tasks: PipelineTask[]
  nextId: number
  schemaVersion: number
  workflowMode: WorkflowMode
  load: (root: string) => Promise<void>
  addTask: (fields: NewTaskFields) => Promise<void>
  moveTask: (id: string, dir: -1 | 1) => Promise<void>
  switchWorkflow: () => Promise<void>
  countNotFinal: () => number
}

export const usePipeline = create<PipelineStore>((set, get) => {
  const persist = (tasks: PipelineTask[]): Promise<void> => {
    const { root, schemaVersion, nextId } = get()
    if (!root) return Promise.resolve()
    return ipc.pmSetState(root, { schemaVersion, nextId, tasks })
  }

  return {
    root: null,
    loading: false,
    loaded: false,
    tasks: [],
    nextId: 1,
    schemaVersion: 1,
    workflowMode: 'flat',

    load: async (root) => {
      set({ loading: true, root })
      const [state, config] = await Promise.all([ipc.pmGetState(root), ipc.pmGetConfig(root)])
      if (get().root !== root) return
      set({
        tasks: state.tasks,
        nextId: state.nextId,
        schemaVersion: state.schemaVersion,
        workflowMode: config.workflowMode,
        loading: false,
        loaded: true
      })
    },

    addTask: async (fields) => {
      const { tasks, nextId } = get()
      const task: PipelineTask = {
        id: `t-${nextId}`,
        agent: fields.agent,
        title: fields.title,
        description: fields.description,
        stage: fields.stage,
        priority: fields.priority,
        createdAt: new Date().toISOString()
      }
      const next = [...tasks, task]
      set({ tasks: next, nextId: nextId + 1 })
      await persist(next)
    },

    moveTask: async (id, dir) => {
      const { tasks, workflowMode } = get()
      const cols = WORKFLOW_COLUMNS[workflowMode]
      const next = tasks.map((t) => {
        if (t.id !== id) return t
        const i = cols.indexOf(t.stage)
        const j = Math.min(cols.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))
        return { ...t, stage: cols[j] }
      })
      set({ tasks: next })
      await persist(next)
    },

    switchWorkflow: async () => {
      const { root, tasks, workflowMode, schemaVersion, nextId } = get()
      if (!root) return
      const to: WorkflowMode = workflowMode === 'flat' ? 'gitNative' : 'flat'
      const next = tasks.map((t) => ({ ...t, stage: remapStage(t.stage, workflowMode, to) }))
      set({ tasks: next, workflowMode: to })
      await Promise.all([
        ipc.pmSetState(root, { schemaVersion, nextId, tasks: next }),
        ipc.pmSetConfig(root, { workflowMode: to })
      ])
    },

    countNotFinal: () => {
      const { tasks, workflowMode } = get()
      const final = WORKFLOW_FINAL[workflowMode]
      return tasks.filter((t) => t.stage !== final).length
    }
  }
})
