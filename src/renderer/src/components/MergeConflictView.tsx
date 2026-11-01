import { useCallback, useEffect, useState } from 'react'
import { ipc } from '../ipc'
import { ConflictEditor } from './ConflictEditor'

export function MergeConflictView({
  root,
  onResolved
}: {
  root: string
  onResolved: () => void
}): JSX.Element {
  const [conflicts, setConflicts] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const ms = await ipc.gitMergeState(root)
    if (!ms.merging) {
      onResolved()
      return
    }
    setConflicts(ms.conflicts)
    setMessage(ms.message || '')
    setSelected((prev) => (prev && ms.conflicts.includes(prev) ? prev : ms.conflicts[0] ?? null))
  }, [root, onResolved])

  useEffect(() => {
    void reload()
  }, [reload])

  const allResolved = conflicts.length === 0

  const complete = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const r = await ipc.gitCompleteMerge(root, undefined)
    setBusy(false)
    if (r.ok) onResolved()
    else setError(r.error ?? 'Could not complete the merge.')
  }
  const abort = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const r = await ipc.gitAbortMerge(root)
    setBusy(false)
    if (r.ok) onResolved()
    else setError(r.error ?? 'Could not abort the merge.')
  }

  return (
    <div className="merge-view">
      <div className="merge-head">
        <div className="merge-title">
          <strong>Merge in progress</strong>
          {message && <span className="dim"> — {message}</span>}
        </div>
        <div className="merge-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => void abort()} disabled={busy}>
            Abort merge
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => void complete()} disabled={busy || !allResolved}>
            Complete merge
          </button>
        </div>
      </div>
      {error && <div className="modal-error">{error}</div>}
      <div className="merge-body">
        <aside className="merge-files">
          <div className="hd-row">CONFLICTS ({conflicts.length})</div>
          {allResolved && <div className="ct-loading">All resolved — complete the merge.</div>}
          {conflicts.map((f) => (
            <button
              key={f}
              className={`merge-file${selected === f ? ' active' : ''}`}
              onClick={() => setSelected(f)}
            >
              <span className="git-file-status del">!</span>
              <span className="git-file-name">{f.split('/').pop()}</span>
              <span className="git-file-path">{f}</span>
            </button>
          ))}
        </aside>
        <main className="merge-editor">
          {selected ? (
            <ConflictEditor key={selected} root={root} relPath={selected} onStaged={() => void reload()} />
          ) : (
            <div className="ct-loading">Select a file to resolve.</div>
          )}
        </main>
      </div>
    </div>
  )
}
