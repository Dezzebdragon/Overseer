import { useStore } from '../store'
import { useFileHistory, toRel } from '../hooks/useFileHistory'
import { EditorHost } from './EditorHost'
import { Welcome } from './Welcome'
import { DiffPane } from './DiffPane'

export function ExplorerEditor(): JSX.Element {
  const root = useStore((s) => s.root)
  const tabs = useStore((s) => s.tabs)
  const activePath = useStore((s) => s.activePath)
  const fileCommits = useStore((s) => s.fileCommits)

  const relPath = toRel(root, activePath)
  const history = useFileHistory(root, relPath)

  const selected = activePath ? fileCommits[activePath] ?? 'working' : 'working'
  const viewedSha = selected === 'working' ? null : selected
  const idx = viewedSha ? history.findIndex((c) => c.sha === viewedSha) : -1
  const baseHash = viewedSha ? history[idx + 1]?.sha ?? null : null

  return (
    <div className="editor-area">
      <EditorHost />
      {viewedSha && root && relPath && (
        <div className="diff-overlay">
          <DiffPane root={root} relPath={relPath} versionHash={viewedSha} baseHash={baseHash} />
        </div>
      )}
      {tabs.length === 0 && <Welcome />}
    </div>
  )
}
