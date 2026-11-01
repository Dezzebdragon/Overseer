import { useEffect, useState } from 'react'
import type { GitBranches } from '@shared/types'
import { ipc } from '../ipc'
import { Modal } from './Modal'

type Action = null | 'commit' | 'branch' | 'merge' | 'checkout'

export function GitActionModals({
  action,
  root,
  selectedSha,
  onClose,
  onDone
}: {
  action: Action
  root: string
  selectedSha: string | null
  onClose: () => void
  onDone: () => void
}): JSX.Element | null {
  if (action === 'commit') return <CommitModal root={root} onClose={onClose} onDone={onDone} />
  if (action === 'branch')
    return <BranchModal root={root} selectedSha={selectedSha} onClose={onClose} onDone={onDone} />
  if (action === 'merge') return <MergeModal root={root} onClose={onClose} onDone={onDone} />
  if (action === 'checkout')
    return <CheckoutModal root={root} selectedSha={selectedSha} onClose={onClose} onDone={onDone} />
  return null
}

function Err({ text }: { text: string | null }): JSX.Element | null {
  return text ? <div className="modal-error">{text}</div> : null
}

function CommitModal({ root, onClose, onDone }: { root: string; onClose: () => void; onDone: () => void }): JSX.Element {
  const [message, setMessage] = useState('')
  const [stageAll, setStageAll] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (!message.trim()) {
      setError('Enter a commit message.')
      return
    }
    setBusy(true)
    setError(null)
    const res = await ipc.gitCommit(root, message.trim(), stageAll)
    setBusy(false)
    if (res.ok) onDone()
    else setError(res.error ?? 'Commit failed.')
  }

  return (
    <Modal title="Commit" onClose={onClose}>
      <textarea
        className="modal-textarea"
        placeholder="Commit message"
        value={message}
        autoFocus
        onChange={(e) => setMessage(e.target.value)}
      />
      <label className="modal-check">
        <input type="checkbox" checked={stageAll} onChange={(e) => setStageAll(e.target.checked)} />
        Stage all changes (git add -A)
      </label>
      <Err text={error} />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Committing…' : 'Commit'}
        </button>
      </div>
    </Modal>
  )
}

function BranchModal({
  root,
  selectedSha,
  onClose,
  onDone
}: {
  root: string
  selectedSha: string | null
  onClose: () => void
  onDone: () => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [base, setBase] = useState(selectedSha ?? 'HEAD')
  const [checkout, setCheckout] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (!name.trim()) {
      setError('Enter a branch name.')
      return
    }
    setBusy(true)
    setError(null)
    const res = await ipc.gitCreateBranch(root, name.trim(), base.trim() || 'HEAD', checkout)
    setBusy(false)
    if (res.ok) onDone()
    else setError(res.error ?? 'Could not create branch.')
  }

  return (
    <Modal title="New branch" onClose={onClose}>
      <label className="modal-label">Name</label>
      <input className="modal-input" placeholder="feature/…" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      <label className="modal-label">Base</label>
      <input className="modal-input mono" value={base} onChange={(e) => setBase(e.target.value)} />
      {selectedSha && (
        <div className="modal-hintline">Defaulting to the selected commit {selectedSha.slice(0, 7)}. Use “HEAD” for the current tip.</div>
      )}
      <label className="modal-check">
        <input type="checkbox" checked={checkout} onChange={(e) => setCheckout(e.target.checked)} />
        Check out after creating
      </label>
      <Err text={error} />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Creating…' : 'Create branch'}
        </button>
      </div>
    </Modal>
  )
}

function useBranches(root: string): GitBranches | null {
  const [b, setB] = useState<GitBranches | null>(null)
  useEffect(() => {
    let cancelled = false
    void ipc.gitBranches(root).then((r) => !cancelled && setB(r)).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [root])
  return b
}

function MergeModal({ root, onClose, onDone }: { root: string; onClose: () => void; onDone: () => void }): JSX.Element {
  const branches = useBranches(root)
  const others = (branches?.branches ?? []).filter((b) => b !== branches?.current)
  const [branch, setBranch] = useState('')
  const [noFf, setNoFf] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!branch && others.length) setBranch(others[0])
  }, [others, branch])

  const submit = async (): Promise<void> => {
    if (!branch) {
      setError('Choose a branch to merge.')
      return
    }
    setBusy(true)
    setError(null)
    const res = await ipc.gitMerge(root, branch, noFf)
    setBusy(false)
    if (res.ok) onDone()
    else if (res.conflicts && res.conflicts.length) onDone() // conflict view will open
    else setError(res.error ?? 'Merge failed.')
  }

  return (
    <Modal title={`Merge into ${branches?.current ?? 'current branch'}`} onClose={onClose}>
      <label className="modal-label">Branch to merge</label>
      <select className="modal-input" value={branch} onChange={(e) => setBranch(e.target.value)}>
        {others.length === 0 && <option value="">(no other branches)</option>}
        {others.map((b) => (
          <option key={b} value={b}>{b}</option>
        ))}
      </select>
      <label className="modal-check">
        <input type="checkbox" checked={noFf} onChange={(e) => setNoFf(e.target.checked)} />
        Always create a merge commit (--no-ff)
      </label>
      <div className="modal-hintline">If the merge conflicts, a resolution view opens here.</div>
      <Err text={error} />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !branch}>
          {busy ? 'Merging…' : 'Merge'}
        </button>
      </div>
    </Modal>
  )
}

function CheckoutModal({
  root,
  selectedSha,
  onClose,
  onDone
}: {
  root: string
  selectedSha: string | null
  onClose: () => void
  onDone: () => void
}): JSX.Element {
  const branches = useBranches(root)
  const COMMIT = selectedSha ? `commit:${selectedSha}` : ''
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!target && branches) {
      const first = branches.branches.find((b) => b !== branches.current)
      setTarget(first ?? branches.current ?? '')
    }
  }, [branches, target])

  const submit = async (): Promise<void> => {
    if (!target) return
    const real = target.startsWith('commit:') ? target.slice('commit:'.length) : target
    setBusy(true)
    setError(null)
    const res = await ipc.gitCheckout(root, real)
    setBusy(false)
    if (res.ok) onDone()
    else setError(res.error ?? 'Checkout failed.')
  }

  const isDetached = target.startsWith('commit:')

  return (
    <Modal title="Checkout" onClose={onClose}>
      <label className="modal-label">Target</label>
      <select className="modal-input" value={target} onChange={(e) => setTarget(e.target.value)}>
        {(branches?.branches ?? []).map((b) => (
          <option key={b} value={b}>
            {b}
            {b === branches?.current ? ' (current)' : ''}
          </option>
        ))}
        {selectedSha && <option value={COMMIT}>commit {selectedSha.slice(0, 7)} (detached)</option>}
      </select>
      {isDetached && (
        <div className="modal-hintline warn">
          Checking out a commit puts you in detached HEAD — new commits won't belong to any branch. Create a branch here to keep work.
        </div>
      )}
      <Err text={error} />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !target}>
          {busy ? 'Switching…' : 'Checkout'}
        </button>
      </div>
    </Modal>
  )
}
