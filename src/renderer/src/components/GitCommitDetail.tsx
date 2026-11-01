import { useEffect, useState } from 'react'
import type { CommitFileChange, GitCommit } from '@shared/types'
import { useStore } from '../store'
import { ipc } from '../ipc'

function statusMeta(s: string): { cls: string; label: string } {
  if (s === 'A' || s === 'C') return { cls: 'add', label: 'A' }
  if (s === 'M' || s === 'T') return { cls: 'mod', label: 'M' }
  if (s === 'D') return { cls: 'del', label: 'D' }
  if (s === 'R') return { cls: 'add', label: 'R' }
  return { cls: 'mod', label: s.slice(0, 1) }
}

export function GitCommitDetail({ commit, root }: { commit: GitCommit; root: string }): JSX.Element {
  const openFileAtCommit = useStore((s) => s.openFileAtCommit)
  const setGitSelectedSha = useStore((s) => s.setGitSelectedSha)
  const [files, setFiles] = useState<CommitFileChange[]>([])
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setBody('')
    void ipc
      .gitCommitFiles(root, commit.sha)
      .then((f) => !cancelled && setFiles(f))
      .catch(() => !cancelled && setFiles([]))
      .finally(() => !cancelled && setLoading(false))
    void ipc.gitCommitBody(root, commit.sha).then((b) => !cancelled && setBody(b)).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [root, commit.sha])

  const openFile = (ch: CommitFileChange): void => {
    // deleted-in-this-commit: show the version from the parent (where it existed)
    const at = ch.status === 'D' ? commit.parents[0] ?? commit.sha : commit.sha
    openFileAtCommit(ch.path, at)
  }

  return (
    <div className="git-detail">
      <div className="git-detail-head">
        <span className="hd-row">COMMIT</span>
        <button className="git-detail-close" onClick={() => setGitSelectedSha(null)} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="git-detail-body">
        <div className="mono git-detail-sha">{commit.shortSha}</div>
        {commit.refs.length > 0 && (
          <div className="git-detail-refs">
            {commit.refs.map((r) => (
              <span key={r.name} className={`git-ref git-ref-${r.kind}`}>{r.name}</span>
            ))}
          </div>
        )}
        <div className="git-detail-subject">{commit.subject}</div>
        <div className="git-detail-meta">
          {commit.author} &lt;{commit.email}&gt;
        </div>
        <div className="git-detail-meta">{new Date(commit.dateIso).toLocaleString()}</div>
        {body && <div className="git-detail-msg">{body}</div>}
      </div>

      <div className="git-detail-files-hd">
        <span className="hd-row">CHANGED FILES</span>
        {!loading && <span className="git-detail-count">{files.length}</span>}
      </div>
      <div className="git-detail-files">
        {loading ? (
          <div className="ct-loading">Loading…</div>
        ) : files.length === 0 ? (
          <div className="ct-loading">No file changes.</div>
        ) : (
          files.map((ch) => {
            const m = statusMeta(ch.status)
            return (
              <button
                key={ch.path}
                className="git-file-row"
                onClick={() => openFile(ch)}
                title={ch.oldPath ? `${ch.oldPath} → ${ch.path}` : ch.path}
              >
                <span className={`git-file-status ${m.cls}`}>{m.label}</span>
                <span className="git-file-name">{ch.path.split('/').pop()}</span>
                <span className="git-file-path">{ch.path}</span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
