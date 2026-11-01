import { useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useResizeObserver } from '../hooks/useResizeObserver'
import { useHint } from '../hint'
import { ClampedFloating } from './ClampedFloating'

export interface NavCommit {
  sha: string
  shortSha: string
  subject: string
  author: string
  dateIso: string
  laneColor: string
  additions?: number
  deletions?: number
  refs?: string[]
}

interface Item {
  key: string // 'working' | sha
  working: boolean
  commit?: NavCommit
}

const LINE = '#3a4152'
const ACCENT = '#3b82f6'

export function CommitNavigator({
  commits,
  selected,
  showWorking,
  height = 40,
  maxDots = 11,
  onSelect,
  onTrack,
  onSeeInGit
}: {
  commits: NavCommit[] // newest-first (as from git)
  selected: string // 'working' | sha
  showWorking: boolean
  height?: number
  maxDots?: number
  onSelect: (key: string) => void
  onTrack: (sha: string) => void
  onSeeInGit?: (sha: string) => void
}): JSX.Element {
  const [ref, size] = useResizeObserver<HTMLDivElement>()
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null)
  const [menu, setMenu] = useState<{ sha: string; x: number; y: number } | null>(null)

  const items: Item[] = useMemo(() => {
    const list: Item[] = [...commits]
      .reverse()
      .map((c) => ({ key: c.sha, working: false, commit: c }))
    if (showWorking) list.push({ key: 'working', working: true })
    return list
  }, [commits, showWorking])

  const leftHint = useHint('Older · Ctrl: last shown · Ctrl+Shift: oldest')
  const rightHint = useHint('Newer · Ctrl: last shown · Ctrl+Shift: current')

  const H = height
  const CY = H / 2
  const DOT_R = Math.max(3, Math.round(H * 0.16))
  const SEL_R = DOT_R + 2
  const ARROW_W = Math.max(16, Math.round(H * 0.66))
  const SPACING = Math.max(14, Math.round(H * 0.7))

  const width = size.width || 240
  let slots = Math.floor((width - 2 * ARROW_W - 8) / SPACING)
  slots = Math.min(maxDots, Math.max(1, slots))
  if (slots % 2 === 0) slots -= 1
  slots = Math.max(1, slots)
  const half = (slots - 1) / 2
  const centerX = width / 2

  const selectedIndex = Math.max(0, items.findIndex((it) => it.key === selected))
  const windowStart = selectedIndex - half
  const slotX = (i: number): number => centerX + (i - half) * SPACING

  const leftDisabled = selectedIndex <= 0
  const rightDisabled = selectedIndex >= items.length - 1

  const step = (dir: -1 | 1): void => {
    const next = selectedIndex + dir
    if (next >= 0 && next < items.length) onSelect(items[next].key)
  }
  const onArrow = (side: 'left' | 'right') => (e: ReactMouseEvent): void => {
    if ((side === 'left' && leftDisabled) || (side === 'right' && rightDisabled)) return
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && e.shiftKey) {
      onSelect(items[side === 'left' ? 0 : items.length - 1].key)
    } else if (ctrl) {
      const i = side === 'left' ? 0 : slots - 1
      const idx = Math.min(items.length - 1, Math.max(0, windowStart + i))
      onSelect(items[idx].key)
    } else {
      step(side === 'left' ? -1 : 1)
    }
  }

  // Line spans only the filled slots (centered; blanks pad the ends).
  let firstFilled = -1
  let lastFilled = -1
  for (let i = 0; i < slots; i++) {
    const idx = windowStart + i
    if (idx >= 0 && idx < items.length) {
      if (firstFilled === -1) firstFilled = i
      lastFilled = i
    }
  }

  return (
    <div className="commit-nav" ref={ref}>
      <svg width={width} height={H}>
        {firstFilled !== lastFilled && (
          <line x1={slotX(firstFilled)} y1={CY} x2={slotX(lastFilled)} y2={CY} stroke={LINE} strokeWidth={2} />
        )}

        {/* arrows */}
        <g
          {...(leftDisabled ? {} : leftHint)}
          style={{ cursor: leftDisabled ? 'default' : 'pointer', opacity: leftDisabled ? 0.3 : 1 }}
          onClick={onArrow('left')}
        >
          <rect x={2} y={CY - ARROW_W / 2} width={ARROW_W} height={ARROW_W} rx={5} fill="#23262e" stroke="#313747" />
          <path d={`M${2 + ARROW_W * 0.62} ${CY - ARROW_W * 0.22} l${-ARROW_W * 0.22} ${ARROW_W * 0.22} l${ARROW_W * 0.22} ${ARROW_W * 0.22} z`} fill="#c7ccda" />
        </g>
        <g
          {...(rightDisabled ? {} : rightHint)}
          style={{ cursor: rightDisabled ? 'default' : 'pointer', opacity: rightDisabled ? 0.3 : 1 }}
          onClick={onArrow('right')}
        >
          <rect x={width - ARROW_W - 2} y={CY - ARROW_W / 2} width={ARROW_W} height={ARROW_W} rx={5} fill="#23262e" stroke="#313747" />
          <path d={`M${width - 2 - ARROW_W * 0.62} ${CY - ARROW_W * 0.22} l${ARROW_W * 0.22} ${ARROW_W * 0.22} l${-ARROW_W * 0.22} ${ARROW_W * 0.22} z`} fill="#c7ccda" />
        </g>

        {Array.from({ length: slots }).map((_, i) => {
          const idx = windowStart + i
          const item = items[idx]
          if (!item) return null
          const x = slotX(i)
          const isSel = idx === selectedIndex
          const color = item.working ? ACCENT : item.commit?.laneColor ?? ACCENT
          return (
            <g
              key={item.key}
              style={{ cursor: 'pointer' }}
              onClick={() => onSelect(item.key)}
              onMouseEnter={(e) => setHover({ item, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHover(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                if (item.commit) setMenu({ sha: item.commit.sha, x: e.clientX, y: e.clientY })
              }}
            >
              {isSel && <circle cx={x} cy={CY} r={SEL_R + 2} fill="none" stroke="#e7e9f0" strokeWidth={1.4} opacity={0.5} />}
              {item.working ? (
                <circle cx={x} cy={CY} r={DOT_R} fill="#16181d" stroke={color} strokeWidth={2.2} />
              ) : (
                <circle cx={x} cy={CY} r={isSel ? SEL_R : DOT_R} fill={color} stroke="#16181d" strokeWidth={isSel ? 2 : 0} />
              )}
            </g>
          )
        })}
      </svg>

      {hover &&
        createPortal(
          <ClampedFloating x={hover.x + 12} y={hover.y + 14} className="commit-nav-tt">
            {hover.item.working ? (
              <div className="fg">Current (working tree)</div>
            ) : (
              hover.item.commit && (
                <>
                  <div className="commit-nav-tt-top">
                    <span className="mono">{hover.item.commit.shortSha}</span>
                    {(hover.item.commit.refs ?? []).map((r) => (
                      <span key={r} className="commit-nav-ref">{r}</span>
                    ))}
                  </div>
                  <div className="dim">{hover.item.commit.author} · {new Date(hover.item.commit.dateIso).toLocaleString()}</div>
                  <div className="fg subj">{hover.item.commit.subject}</div>
                  {(hover.item.commit.additions !== undefined || hover.item.commit.deletions !== undefined) && (
                    <div className="dim">
                      this file: <span style={{ color: '#22c55e' }}>+{hover.item.commit.additions ?? 0}</span>{' '}
                      <span style={{ color: '#f87171' }}>−{hover.item.commit.deletions ?? 0}</span>
                    </div>
                  )}
                </>
              )
            )}
          </ClampedFloating>,
          document.body
        )}

      {menu &&
        createPortal(
          <div className="popover-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => e.preventDefault()}>
            <ClampedFloating x={menu.x} y={menu.y} className="popover-menu" onClick={(e) => e.stopPropagation()}>
              <button className="git-menu-track" onClick={() => { onTrack(menu.sha); setMenu(null) }}>
                ⌖ Track commit
              </button>
              {onSeeInGit && (
                <button className="git-menu-track" onClick={() => { onSeeInGit(menu.sha); setMenu(null) }}>
                  ↪ See commit in Git view
                </button>
              )}
            </ClampedFloating>
          </div>,
          document.body
        )}
    </div>
  )
}
