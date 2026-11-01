import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GitCommit } from '@shared/types'
import { useStore } from '../store'
import { useHint } from '../hint'
import { useResizeObserver } from '../hooks/useResizeObserver'
import { SWATCHES } from '../trackerTypes'
import { ViewSettingsMenu } from './ViewSettingsMenu'
import { GitCommitDetail } from './GitCommitDetail'
import { ClampedFloating } from './ClampedFloating'
import { GitActionModals } from './GitActionModals'
import { MergeConflictView } from './MergeConflictView'

const ROW_H = 30
const LANE_GAP = 22
const GRAPH_PAD = 22
const R = 6

const laneColor = (lane: number): string => SWATCHES[lane % SWATCHES.length]
const laneX = (lane: number): number => GRAPH_PAD + lane * LANE_GAP

function relTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`
  return new Date(t).toLocaleDateString()
}

interface Edge {
  path: string
  color: string
  order: number
}

function buildEdges(commits: GitCommit[], indexOf: Map<string, number>): Edge[] {
  const edges: Edge[] = []
  commits.forEach((c, i) => {
    const xc = laneX(c.lane)
    const yi = i * ROW_H + ROW_H / 2
    c.parents.forEach((psha, k) => {
      const j = indexOf.get(psha)
      if (j === undefined) return
      const p = commits[j]
      const xp = laneX(p.lane)
      const yj = j * ROW_H + ROW_H / 2
      if (c.lane === p.lane) {
        edges.push({ path: `M${xc} ${yi} L${xc} ${yj}`, color: laneColor(c.lane), order: c.lane })
      } else if (k === 0) {
        const cx = xp < xc ? xc - R : xc + R
        edges.push({
          path: `M${xc} ${yi} L${xc} ${yj - R} Q${xc} ${yj} ${cx} ${yj} L${xp} ${yj}`,
          color: laneColor(c.lane),
          order: c.lane
        })
      } else {
        const hx = xp > xc ? xp - R : xp + R
        edges.push({
          path: `M${xc} ${yi} L${hx} ${yi} Q${xp} ${yi} ${xp} ${yi + R} L${xp} ${yj}`,
          color: laneColor(p.lane),
          order: p.lane
        })
      }
    })
  })
  return edges.sort((a, b) => a.order - b.order)
}

function RefPill({ name, kind }: { name: string; kind: GitCommit['refs'][number]['kind'] }): JSX.Element {
  return <span className={`git-ref git-ref-${kind}`}>{name}</span>
}

function TrackRow({
  label,
  value,
  valueColor,
  hint,
  onTrack
}: {
  label: string
  value?: string
  valueColor?: string
  hint: string
  onTrack: () => void
}): JSX.Element {
  const h = useHint(hint)
  return (
    <div className="git-metric" {...h}>
      <span>{label}</span>
      <span className="git-metric-right">
        {value !== undefined && (
          <span className="git-metric-val" style={valueColor ? { color: valueColor } : undefined}>
            {value}
          </span>
        )}
        <button className="git-track-pin" onClick={onTrack} aria-label={`Track ${label}`}>
          ⌖
        </button>
      </span>
    </div>
  )
}

export function GitView(): JSX.Element {
  const root = useStore((s) => s.root)
  const addTracker = useStore((s) => s.addTracker)
  const gitSelectedSha = useStore((s) => s.gitSelectedSha)
  const setGitSelectedSha = useStore((s) => s.setGitSelectedSha)
  const graph = useStore((s) => s.gitGraph)
  const loading = useStore((s) => s.gitGraphLoading)
  const loadGitGraph = useStore((s) => s.loadGitGraph)
  const mergeState = useStore((s) => s.gitMergeState)
  const [action, setAction] = useState<null | 'commit' | 'branch' | 'merge' | 'checkout'>(null)
  const [hover, setHover] = useState<{ c: GitCommit; x: number; y: number } | null>(null)
  const [menu, setMenu] = useState<{ c: GitCommit; x: number; y: number } | null>(null)

  const [graphColRef, graphColSize] = useResizeObserver<HTMLDivElement>()
  const graphInnerRef = useRef<HTMLDivElement>(null)
  const vScroll = useRef(0)
  const hScroll = useRef(0)

  const refresh = useCallback(() => loadGitGraph(true), [loadGitGraph])

  useEffect(() => {
    if (root) void loadGitGraph(false)
  }, [root, loadGitGraph])

  const commits = graph?.commits ?? []
  const indexOf = useMemo(() => new Map(commits.map((c, i) => [c.sha, i])), [commits])
  const edges = useMemo(() => buildEdges(commits, indexOf), [commits, indexOf])

  const metricsBySha = useMemo(() => {
    const lanes = new Map<number, string[]>()
    for (const c of commits) {
      const a = lanes.get(c.lane) ?? []
      a.push(c.sha)
      lanes.set(c.lane, a)
    }
    const m = new Map<string, { inBranch: number; ahead: number; behind: number }>()
    for (const c of commits) {
      const a = lanes.get(c.lane) ?? []
      const idx = a.indexOf(c.sha)
      m.set(c.sha, { inBranch: a.length, ahead: idx, behind: a.length - 1 - idx })
    }
    return m
  }, [commits])

  const syncTransform = (): void => {
    if (graphInnerRef.current) {
      graphInnerRef.current.style.transform = `translate(${-hScroll.current}px, ${-vScroll.current}px)`
    }
  }

  const trackCommit = (c: GitCommit, defId: string): void => {
    addTracker(defId, { view: 'git', anchor: c.sha }, {
      sha: c.sha,
      shortSha: c.shortSha,
      subject: c.subject
    })
    setMenu(null)
  }

  const isRepo = graph?.isRepo ?? true
  const header = (
    <div className="template-header">
      <div className="header-left">
        <span className="template-label">Git</span>
        <ViewSettingsMenu sectionId="git" label="Git view settings" />
      </div>
      <div className="header-right git-header-right">
        {isRepo && (
          <div className="git-actions">
            <button className="btn btn-sm" onClick={() => setAction('commit')}>Commit</button>
            <button className="btn btn-sm" onClick={() => setAction('branch')}>Branch</button>
            <button className="btn btn-sm" onClick={() => setAction('merge')}>Merge</button>
            <button className="btn btn-sm" onClick={() => setAction('checkout')}>Checkout</button>
          </div>
        )}
        <button className="btn btn-ghost btn-sm git-refresh" onClick={() => void refresh()} disabled={loading}>
          ⟳ Refresh
        </button>
      </div>
    </div>
  )

  const modals = root && (
    <GitActionModals
      action={action}
      root={root}
      selectedSha={gitSelectedSha}
      onClose={() => setAction(null)}
      onDone={() => {
        setAction(null)
        void loadGitGraph(true)
      }}
    />
  )

  if (!root) {
    return (
      <div className="view view-git">
        {header}
        <div className="hub-empty">Open a project to use Git.</div>
      </div>
    )
  }
  if (graph && !graph.isRepo) {
    return (
      <div className="view view-git">
        {header}
        <div className="hub-empty">This project is not a git repository.</div>
      </div>
    )
  }

  const graphWidth = GRAPH_PAD + (graph?.laneCount ?? 1) * LANE_GAP + 8
  const contentH = commits.length * ROW_H
  const needHScroll = graphColSize.width > 0 && graphWidth > graphColSize.width + 1

  const refs = graph?.refs ?? []
  const heads = refs.filter((r) => r.kind === 'head')
  const remotes = refs.filter((r) => r.kind === 'remote')
  const tags = refs.filter((r) => r.kind === 'tag')
  const laneOfSha = (sha: string): number => commits[indexOf.get(sha) ?? -1]?.lane ?? 0

  return (
    <div className="view view-git">
      {header}
      {root && mergeState?.merging && (
        <div className="git-merge-overlay">
          <MergeConflictView root={root} onResolved={() => void loadGitGraph(true)} />
        </div>
      )}
      <div className="template-body">
        <aside className="git-refs">
          <div className="hd-row">BRANCHES</div>
          {heads.map((r) => (
            <div className="git-ref-row" key={`h-${r.name}`}>
              <span className="git-dot" style={{ background: laneColor(laneOfSha(r.sha)) }} />
              <span className={r.isHead ? 'git-ref-name head' : 'git-ref-name'}>{r.name}</span>
              {r.isHead && <span className="git-head-pill">HEAD</span>}
            </div>
          ))}
          {remotes.length > 0 && <div className="hd-row">REMOTES</div>}
          {remotes.map((r) => (
            <div className="git-ref-row dim" key={`r-${r.name}`}>{r.name}</div>
          ))}
          {tags.length > 0 && <div className="hd-row">TAGS</div>}
          {tags.map((r) => (
            <div className="git-ref-row" key={`t-${r.name}`}>{r.name}</div>
          ))}

          {gitSelectedSha &&
            root &&
            (() => {
              const c = commits.find((x) => x.sha === gitSelectedSha)
              return c ? <GitCommitDetail commit={c} root={root} /> : null
            })()}
        </aside>

        <div className="git-body">
          {/* graph column (capped at 50% of the right pane) */}
          <div className="git-graph-col" ref={graphColRef} style={{ width: graphWidth }}>
            {needHScroll && (
              <div
                className="git-hscroll"
                onScroll={(e) => {
                  hScroll.current = e.currentTarget.scrollLeft
                  syncTransform()
                }}
              >
                <div style={{ width: graphWidth, height: 1 }} />
              </div>
            )}
            <div className="git-graph-viewport">
              <div className="git-graph-inner" ref={graphInnerRef} style={{ width: graphWidth, height: contentH }}>
                <svg width={graphWidth} height={contentH}>
                  {edges.map((e, i) => (
                    <path key={i} d={e.path} fill="none" stroke={e.color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
                  ))}
                  {commits.map((c, i) => {
                    const cx = laneX(c.lane)
                    const cy = i * ROW_H + ROW_H / 2
                    const solid = c.isMerge || c.isBranchPoint
                    return solid ? (
                      <circle key={c.sha} cx={cx} cy={cy} r={5.5} fill={laneColor(c.lane)} stroke="#16181d" strokeWidth={2} />
                    ) : (
                      <circle key={c.sha} cx={cx} cy={cy} r={5} fill="#16181d" stroke={laneColor(c.lane)} strokeWidth={2.4} />
                    )
                  })}
                </svg>
              </div>
            </div>
          </div>

          {/* info column (hugs the graph; owns vertical scroll) */}
          <div
            className="git-info-col"
            onScroll={(e) => {
              vScroll.current = e.currentTarget.scrollTop
              syncTransform()
            }}
          >
            <div style={{ height: contentH }}>
              {commits.map((c) => (
                <div
                  key={c.sha}
                  className={`git-row${gitSelectedSha === c.sha ? ' selected' : ''}`}
                  data-anchor={c.sha}
                  style={{
                    height: ROW_H,
                    backgroundImage: `linear-gradient(90deg, ${laneColor(c.lane)}22, transparent 55%)`,
                    borderLeft: `3px solid ${laneColor(c.lane)}`
                  }}
                  onClick={() => setGitSelectedSha(c.sha)}
                  onMouseEnter={(e) => setHover({ c, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHover(null)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setHover(null)
                    setMenu({ c, x: e.clientX, y: e.clientY })
                  }}
                >
                  {c.refs.map((r) => (
                    <RefPill key={r.name} name={r.name} kind={r.kind} />
                  ))}
                  <span className="git-subject">{c.subject}</span>
                  <span className="git-row-meta">
                    <span className="git-author">{c.author}</span>
                    <span className="git-sha">{c.shortSha}</span>
                    <span className="git-time">{relTime(c.dateIso)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {hover &&
        createPortal(
          <ClampedFloating x={hover.x + 14} y={hover.y + 12} className="git-tooltip">
            <div className="git-tt-top">
              <span className="git-sha">{hover.c.shortSha}</span>
              {hover.c.refs.map((r) => (
                <RefPill key={r.name} name={r.name} kind={r.kind} />
              ))}
            </div>
            <div className="git-tt-dim">
              {hover.c.author} &lt;{hover.c.email}&gt; · {new Date(hover.c.dateIso).toLocaleString()}
            </div>
            <div className="git-tt-sep" />
            <div className="git-tt-subject">{hover.c.subject}</div>
            {hover.c.body && <div className="git-tt-dim git-tt-body">{hover.c.body}</div>}
          </ClampedFloating>,
          document.body
        )}

      {menu &&
        createPortal(
          <div className="popover-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => e.preventDefault()}>
            <ClampedFloating x={menu.x} y={menu.y} className="popover-menu git-menu" onClick={(e) => e.stopPropagation()}>
              <button className="git-menu-track" onClick={() => trackCommit(menu.c, 'git.commit')}>
                ⌖ Track this commit
              </button>
              <div className="context-sep" />
              <TrackRow
                label="In this branch"
                value={String(metricsBySha.get(menu.c.sha)?.inBranch ?? 0)}
                hint={`Track: commits in this branch (${metricsBySha.get(menu.c.sha)?.inBranch ?? 0})`}
                onTrack={() => trackCommit(menu.c, 'git.commit.inBranch')}
              />
              <TrackRow
                label="Ahead"
                value={`↑ ${metricsBySha.get(menu.c.sha)?.ahead ?? 0}`}
                valueColor="#22c55e"
                hint={`Track: commits ahead on this branch (${metricsBySha.get(menu.c.sha)?.ahead ?? 0})`}
                onTrack={() => trackCommit(menu.c, 'git.commit.ahead')}
              />
              <TrackRow
                label="Behind"
                value={`↓ ${metricsBySha.get(menu.c.sha)?.behind ?? 0}`}
                valueColor="#f59e0b"
                hint={`Track: commits behind on this branch (${metricsBySha.get(menu.c.sha)?.behind ?? 0})`}
                onTrack={() => trackCommit(menu.c, 'git.commit.behind')}
              />
              <div className="context-sep" />
              <div className="git-menu-foot">⌖ = pin this metric to Overview</div>
            </ClampedFloating>
          </div>,
          document.body
        )}
      {modals}
    </div>
  )
}
