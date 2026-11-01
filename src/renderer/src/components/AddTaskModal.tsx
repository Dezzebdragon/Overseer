import { useState } from 'react'
import type { TaskPriority } from '@shared/types'
import { Modal } from './Modal'
import { usePipeline, type NewTaskFields } from '../pipelineStore'

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high']

export function AddTaskModal({
  columns,
  onClose
}: {
  columns: string[]
  onClose: () => void
}): JSX.Element {
  const addTask = usePipeline((s) => s.addTask)
  const [fields, setFields] = useState<NewTaskFields>({
    agent: '',
    title: '',
    description: '',
    stage: columns[0] ?? '',
    priority: 'medium'
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof NewTaskFields>(k: K, v: NewTaskFields[K]): void =>
    setFields((f) => ({ ...f, [k]: v }))

  const submit = async (): Promise<void> => {
    if (!fields.title.trim() || !fields.agent.trim() || !fields.description.trim()) {
      setError('Title, agent, and description are all required.')
      return
    }
    setBusy(true)
    await addTask({
      agent: fields.agent.trim(),
      title: fields.title.trim(),
      description: fields.description.trim(),
      stage: fields.stage,
      priority: fields.priority
    })
    setBusy(false)
    onClose()
  }

  return (
    <Modal title="Add task" onClose={onClose} width={460}>
      <label className="modal-label">Title</label>
      <input className="modal-input" autoFocus value={fields.title} onChange={(e) => set('title', e.target.value)} />

      <label className="modal-label">Agent</label>
      <input className="modal-input" placeholder="e.g. architect" value={fields.agent} onChange={(e) => set('agent', e.target.value)} />

      <label className="modal-label">Description</label>
      <textarea className="modal-textarea" value={fields.description} onChange={(e) => set('description', e.target.value)} />

      <div className="modal-row">
        <div className="modal-col">
          <label className="modal-label">Stage</label>
          <select className="modal-input" value={fields.stage} onChange={(e) => set('stage', e.target.value)}>
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="modal-col">
          <label className="modal-label">Priority</label>
          <select className="modal-input" value={fields.priority} onChange={(e) => set('priority', e.target.value as TaskPriority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="modal-error">{error}</div>}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Adding…' : 'Add task'}
        </button>
      </div>
    </Modal>
  )
}
