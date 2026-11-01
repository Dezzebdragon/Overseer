import type { GitCommit } from '@shared/types'
import { useStore } from '../store'
import { useHint } from '../hint'
import { useCommitGraph } from '../hooks/useCommitGraph'

function Tab({
  path,
  name,
  colorOf,
  commitOf
}: {
  path: string
  name: string
  colorOf: (sha: string) => string
  commitOf: (sha: string) => GitCommit | undefined
}): JSX.Element {
  const activePath = useStore((s) => s.activePath)
  const dirty = useStore((s) => s.dirty)
  const externallyChanged = useStore((s) => s.externallyChanged)
  const fileCommit = useStore((s) => s.fileCommits[path])
  const setActive = useStore((s) => s.setActive)
  const closeTab = useStore((s) => s.closeTab)
  const hint = useHint(path)

  const isActive = path === activePath
  const isDirty = dirty[path]
  const isExternal = externallyChanged[path]

  const showDot = Boolean(fileCommit && fileCommit !== 'working')
  const commit = showDot && fileCommit ? commitOf(fileCommit) : undefined
  const dotHint = useHint(
    commit
      ? `${commit.shortSha} · ${commit.subject} — ${commit.author}`
      : showDot && fileCommit
        ? `Viewing ${fileCommit.slice(0, 7)}`
        : undefined
  )

  return (
    <div
      className={`tab${isActive ? ' active' : ''}`}
      onClick={() => setActive(path)}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          closeTab(path)
        }
      }}
      {...hint}
    >
      {showDot && (
        <span
          className="tab-commit-dot"
          style={{ background: fileCommit ? colorOf(fileCommit) : '#3b82f6' }}
          {...dotHint}
        />
      )}
      <span className="tab-name">
        {isExternal ? '⚠ ' : ''}
        {name}
      </span>
      <span
        className="tab-close"
        onClick={(e) => {
          e.stopPropagation()
          closeTab(path)
        }}
      >
        {isDirty ? '●' : '✕'}
      </span>
    </div>
  )
}

export function TabBar(): JSX.Element {
  const tabs = useStore((s) => s.tabs)
  const root = useStore((s) => s.root)
  const { graph, colorOf } = useCommitGraph(root)
  const commitOf = (sha: string): GitCommit | undefined => graph?.commits.find((c) => c.sha === sha)

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <Tab key={tab.path} path={tab.path} name={tab.name} colorOf={colorOf} commitOf={commitOf} />
      ))}
    </div>
  )
}
