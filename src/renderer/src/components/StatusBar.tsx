import { useStore } from '../store'
import { modelManager } from '../monaco/modelManager'
import { useCommitGraph } from '../hooks/useCommitGraph'
import { useFileHistory, toRel } from '../hooks/useFileHistory'
import { CommitNavigator, type NavCommit } from './CommitNavigator'

const LANG: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  typescriptreact: 'TSX',
  javascriptreact: 'JSX',
  json: 'JSON',
  jsonc: 'JSON',
  markdown: 'Markdown',
  css: 'CSS',
  scss: 'SCSS',
  html: 'HTML',
  python: 'Python',
  shell: 'Shell',
  yaml: 'YAML',
  plaintext: 'Plain Text'
}
function languageLabel(id: string): string {
  return LANG[id] ?? id.charAt(0).toUpperCase() + id.slice(1)
}

export function StatusBar(): JSX.Element {
  const root = useStore((s) => s.root)
  const activePath = useStore((s) => s.activePath)
  const fileCommits = useStore((s) => s.fileCommits)
  const setFileCommit = useStore((s) => s.setFileCommit)
  const addTracker = useStore((s) => s.addTracker)
  const focusCommitInGit = useStore((s) => s.focusCommitInGit)
  const caret = useStore((s) => s.caret)
  useStore((s) => s.dirty) // re-render when the active tab changes

  const { graph, colorOf } = useCommitGraph(root)
  const relPath = toRel(root, activePath)
  const history = useFileHistory(root, relPath)

  const model = activePath ? modelManager.get(activePath) : undefined
  const format = model ? languageLabel(model.getLanguageId()) : null

  const selected = activePath ? fileCommits[activePath] ?? 'working' : 'working'
  const isWorking = selected === 'working'
  const hashText = isWorking ? 'current' : selected.slice(0, 7)

  const navCommits: NavCommit[] = history.map((h) => ({
    sha: h.sha,
    shortSha: h.shortSha,
    subject: h.subject,
    author: h.author,
    dateIso: h.dateIso,
    laneColor: colorOf(h.sha),
    additions: h.additions,
    deletions: h.deletions
  }))

  const trackCommit = (sha: string): void => {
    const c = history.find((x) => x.sha === sha)
    if (c) addTracker('git.commit', { view: 'git', anchor: sha }, { sha, shortSha: c.shortSha, subject: c.subject })
  }

  let nav: JSX.Element | null = null
  if (activePath) {
    if (graph && !graph.isRepo) nav = <span className="status-note">Not a git repository</span>
    else if (graph && graph.commits.length === 0) nav = <span className="status-note">No commits yet</span>
    else
      nav = (
        <CommitNavigator
          commits={navCommits}
          selected={selected}
          showWorking
          height={20}
          maxDots={11}
          onSelect={(k) => setFileCommit(activePath, k)}
          onTrack={trackCommit}
          onSeeInGit={focusCommitInGit}
        />
      )
  }

  return (
    <div className="status-bar">
      <div className="status-left">
        {activePath && (
          <>
            <span className="status-hash">{hashText}</span>
            <button
              className="status-jump"
              disabled={isWorking}
              onClick={() => setFileCommit(activePath, 'working')}
            >
              Jump to current
            </button>
            <div className="status-nav">{nav}</div>
          </>
        )}
      </div>
      <div className="status-right">
        <span>
          Ln {caret.line}, Col {caret.col}
        </span>
        {format && <span>{format}</span>}
      </div>
    </div>
  )
}
