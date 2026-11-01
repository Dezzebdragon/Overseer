import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useHint } from '../hint'
import { highlight } from '../highlight'
import { useStore } from '../store'
import { getTrackable } from '../trackables'
import { ContextMenu, type CtxItem } from './ContextMenu'
import {
  useNotifications,
  topUnseen,
  TYPE_COLOR,
  type AppNotification,
  type NotifType
} from '../notificationStore'

function relTime(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function TypeIcon({ type }: { type: NotifType }): JSX.Element {
  const c = TYPE_COLOR[type]
  if (type === 'error') {
    return (
      <svg width="18" height="18" viewBox="0 0 20 20" className="notif-icon">
        <circle cx="10" cy="10" r="8" fill="none" stroke={c} strokeWidth="1.8" />
        <path d="M7 7l6 6M13 7l-6 6" stroke={c} strokeWidth="1.8" />
      </svg>
    )
  }
  if (type === 'warning') {
    return (
      <svg width="18" height="18" viewBox="0 0 20 20" className="notif-icon">
        <path d="M10 3l8 15H2z" fill="none" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M10 8v4M10 15v.5" stroke={c} strokeWidth="1.8" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" className="notif-icon">
      <circle cx="10" cy="10" r="8" fill="none" stroke={c} strokeWidth="1.8" />
      <path d="M10 6v6M10 14v.5" stroke={c} strokeWidth="2" />
    </svg>
  )
}

/* ---- toast field (right side of the dashbar) ---- */
export function ToastField(): JSX.Element | null {
  const toasts = useNotifications((s) => s.toasts)
  const duration = Number(useStore((s) => s.settings.toastDuration) ?? 3500)
  const shift = useNotifications((s) => s.shiftToast)
  const [hover, setHover] = useState(false)
  const active = toasts[0]
  const queued = toasts.length - 1

  useEffect(() => {
    if (!active || hover) return
    const t = window.setTimeout(() => shift(), duration)
    return () => window.clearTimeout(t)
  }, [active?.id, hover, duration, shift])

  if (!active) return null
  const go = (): void => {
    if (active.origin) highlight(active.origin.anchor, active.origin.view)
  }
  return (
    <div
      className="toast-field"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="toast-text" style={{ color: active.color }} onClick={go}>
        {active.title}
      </span>
      {queued > 0 && <span className="toast-queue">+{queued}</span>}
      {hover && active.description && active.description !== active.title && (
        <div className="toast-hint">{active.description}</div>
      )}
    </div>
  )
}

function NotifRow({
  n,
  onOpen
}: {
  n: AppNotification
  onOpen: (n: AppNotification) => void
}): JSX.Element {
  const markSeen = useNotifications((s) => s.markSeen)
  const dismiss = useNotifications((s) => s.dismiss)
  const addTracker = useStore((s) => s.addTracker)
  const trackers = useStore((s) => s.trackers)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const typeDef = `notifications.${n.type}`
  const tracked = trackers.some((t) => t.definitionId === typeDef && !t.params)
  const track = (): void => {
    const d = getTrackable(typeDef)
    if (d) addTracker(typeDef, { view: d.origin?.view ?? null, anchor: d.origin?.anchor ?? null })
  }
  const items: CtxItem[] = [
    {
      label: 'Mark seen',
      onClick: () => markSeen(n.id),
      disabled: n.seen,
      hint: n.seen ? 'Already seen' : undefined
    },
    {
      label: 'Dismiss',
      onClick: () => dismiss(n.id),
      disabled: n.sticky === true,
      hint: n.sticky ? n.stickyHint ?? 'Resolve this before dismissing' : undefined
    },
    { sep: true },
    tracked
      ? { label: `Tracking ${n.type} notifications`, disabled: true, hint: 'Already tracked' }
      : { label: `Track ${n.type} notifications`, onClick: track }
  ]

  return (
    <div
      className={`notif-row${n.seen ? ' seen' : ''}`}
      onClick={() => onOpen(n)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <span className="notif-desc">{n.description}</span>
      <span className="notif-time">{relTime(n.timeMs)}</span>
      <TypeIcon type={n.type} />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  )
}

/* ---- bell + popover ---- */
export function NotificationCenter(): JSX.Element {
  const notifications = useNotifications((s) => s.notifications)
  const flashTick = useNotifications((s) => s.flashTick)
  const clearAll = useNotifications((s) => s.clearAll)
  const clearSeen = useNotifications((s) => s.clearSeen)
  const toastDuration = useStore((s) => s.settings.toastDuration) ?? '3500'
  const settings = useStore((s) => s.settings)
  const setAppSetting = useStore((s) => s.setAppSetting)
  const muteKey: Record<NotifType, 'muteError' | 'muteWarning' | 'muteInfo'> = {
    error: 'muteError',
    warning: 'muteWarning',
    info: 'muteInfo'
  }

  const bellRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const [filterType, setFilterType] = useState<'all' | NotifType>('all')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [showSettings, setShowSettings] = useState(false)
  const [popMenu, setPopMenu] = useState<{ x: number; y: number } | null>(null)
  const addTracker = useStore((s) => s.addTracker)
  const trackers = useStore((s) => s.trackers)
  const totalTracked = trackers.some((t) => t.definitionId === 'notifications.total' && !t.params)
  const trackTotal = (): void => {
    const d = getTrackable('notifications.total')
    if (d) addTracker('notifications.total', { view: null, anchor: null })
  }

  useEffect(() => {
    if (flashTick === 0) return
    const el = bellRef.current
    if (!el) return
    el.classList.remove('anchor-flash')
    void el.offsetWidth
    el.classList.add('anchor-flash')
    const t = window.setTimeout(() => el.classList.remove('anchor-flash'), 1700)
    return () => window.clearTimeout(t)
  }, [flashTick])

  const top = topUnseen(notifications)
  const bellHint = useHint('Notifications')
  const dotHint = useHint(top ? top.description : undefined)

  const toggleOpen = (): void => {
    if (pos) {
      setPos(null)
      return
    }
    const r = bellRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
  }

  const list = notifications
    .filter((n) => filterType === 'all' || n.type === filterType)
    .slice()
    .sort((a, b) => {
      if (a.seen !== b.seen) return a.seen ? 1 : -1 // unseen first
      return sort === 'newest' ? b.timeMs - a.timeMs : a.timeMs - b.timeMs
    })

  const onOpen = (n: AppNotification): void => {
    if (n.target) highlight(n.target.anchor, n.target.view)
    setPos(null)
  }

  const cycleType = (): void => {
    const order: Array<'all' | NotifType> = ['all', 'error', 'warning', 'info']
    setFilterType(order[(order.indexOf(filterType) + 1) % order.length])
  }
  const typeLabel =
    filterType === 'all' ? 'All' : filterType[0].toUpperCase() + filterType.slice(1)

  return (
    <div className="notif-center">
      <button ref={bellRef} className="notif-bell" onClick={toggleOpen} {...bellHint}>
        <svg width="17" height="17" viewBox="0 0 22 22">
          <path
            d="M11 3a5.5 5.5 0 015.5 5.5v3.2l1.6 2.5H3.9l1.6-2.5V8.5A5.5 5.5 0 0111 3z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M9 16.4a2 2 0 004 0" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        {top && (
          <span className="notif-dot" style={{ background: TYPE_COLOR[top.type] }} {...dotHint} />
        )}
      </button>

      {pos &&
        createPortal(
          <div className="popover-backdrop" onClick={() => setPos(null)}>
            <div
              className="notif-popover"
              style={{ top: pos.top, right: pos.right }}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                e.preventDefault()
                setPopMenu({ x: e.clientX, y: e.clientY })
              }}
            >
              <div className="notif-head">
                <span className="notif-title">Notifications</span>
                <div className="notif-head-actions">
                  <button className="notif-chip" onClick={cycleType}>
                    Type: {typeLabel}
                  </button>
                  <button
                    className="notif-chip"
                    onClick={() => setSort(sort === 'newest' ? 'oldest' : 'newest')}
                  >
                    {sort === 'newest' ? 'Newest' : 'Oldest'}
                  </button>
                  <button
                    className="icon-btn"
                    aria-label="Notification settings"
                    onClick={() => setShowSettings((v) => !v)}
                  >
                    ☰
                  </button>
                </div>
              </div>

              {showSettings && (
                <div className="notif-settings">
                  <div className="notif-settings-row">
                    <span>Toast duration</span>
                    <select
                      value={toastDuration}
                      onChange={(e) => void setAppSetting('toastDuration', e.target.value)}
                    >
                      <option value="2000">2s</option>
                      <option value="3500">3.5s</option>
                      <option value="6000">6s</option>
                    </select>
                  </div>
                  {(['error', 'warning', 'info'] as NotifType[]).map((t) => (
                    <label className="notif-settings-row" key={t}>
                      <span>Mute {t}</span>
                      <input
                        type="checkbox"
                        checked={settings[muteKey[t]] === true}
                        onChange={() => void setAppSetting(muteKey[t], !(settings[muteKey[t]] === true))}
                      />
                    </label>
                  ))}
                </div>
              )}

              <div className="notif-list">
                {list.length === 0 ? (
                  <div className="notif-empty">No notifications.</div>
                ) : (
                  list.map((n) => <NotifRow key={n.id} n={n} onOpen={onOpen} />)
                )}
              </div>

              <div className="notif-foot">
                <button className="btn btn-sm btn-ghost" onClick={clearSeen}>
                  Clear seen
                </button>
                <button className="btn btn-sm btn-ghost" onClick={clearAll}>
                  Clear all
                </button>
              </div>

              {popMenu && (
                <ContextMenu
                  x={popMenu.x}
                  y={popMenu.y}
                  items={[
                    totalTracked
                      ? { label: 'Tracking number of notifications', disabled: true, hint: 'Already tracked' }
                      : { label: 'Track number of notifications', onClick: trackTotal }
                  ]}
                  onClose={() => setPopMenu(null)}
                />
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}

/* ---- temporary test button (remove later) ---- */
export function TestNotifButton(): JSX.Element {
  const notify = useNotifications((s) => s.notify)
  const types: NotifType[] = ['info', 'warning', 'error']
  const samples: Record<NotifType, string> = {
    info: 'New commit on main',
    warning: 'Task moved to review stage',
    error: 'Merge conflict in README.md'
  }
  const fire = (): void => {
    const t = types[Math.floor(Math.random() * types.length)]
    notify({ type: t, description: samples[t], target: { view: 'git', anchor: null } })
  }
  return (
    <button className="btn btn-sm btn-ghost notif-test" onClick={fire}>
      + Test notif
    </button>
  )
}
