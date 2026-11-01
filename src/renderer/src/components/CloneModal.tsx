import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GithubRepo } from '@shared/types'
import { ipc } from '../ipc'

export function CloneModal({
  onClose,
  onCloned
}: {
  onClose: () => void
  onCloned: (path: string) => void
}): JSX.Element {
  const [repos, setRepos] = useState<GithubRepo[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ipc
      .githubListRepos()
      .then((r) => !cancelled && setRepos(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to list repos'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const doClone = async (cloneUrl: string): Promise<void> => {
    if (!cloneUrl.trim()) return
    setError(null)
    const dest = await ipc.pickDirectory()
    if (!dest) return
    setBusy(true)
    try {
      const { path } = await ipc.githubClone(cloneUrl.trim(), dest)
      onCloned(path)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Clone failed')
    } finally {
      setBusy(false)
    }
  }

  const filtered = repos.filter((r) =>
    r.fullName.toLowerCase().includes(search.toLowerCase())
  )

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal clone-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Clone from GitHub</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="clone-url-row">
            <input
              className="account-input"
              placeholder="Paste a repository URL…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button
              className="btn btn-primary"
              disabled={!url.trim() || busy}
              onClick={() => void doClone(url)}
            >
              Clone
            </button>
          </div>

          <div className="modal-section">
            <div className="modal-section-title">Your repositories</div>
            <input
              className="account-input clone-search"
              placeholder="Search repositories…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {loading ? (
              <div className="modal-empty">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="modal-empty">No repositories.</div>
            ) : (
              <div className="clone-repo-list">
                {filtered.map((r) => (
                  <button
                    key={r.fullName}
                    className="clone-repo-row"
                    disabled={busy}
                    onClick={() => void doClone(r.cloneUrl)}
                  >
                    <span className="clone-repo-name">
                      {r.fullName}
                      {r.private && <span className="clone-repo-private">private</span>}
                    </span>
                    {r.description && <span className="clone-repo-desc">{r.description}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {busy && <div className="modal-empty">Cloning…</div>}
          {error && <div className="account-error">{error}</div>}
        </div>
      </div>
    </div>,
    document.body
  )
}
