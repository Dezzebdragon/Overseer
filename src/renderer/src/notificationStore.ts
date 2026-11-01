import { create } from 'zustand'
import { useStore } from './store'
import { ipc } from './ipc'

export type NotifType = 'error' | 'warning' | 'info'

/** Severity for the bell dot: info < warning < error. */
export const SEVERITY: Record<NotifType, number> = { info: 0, warning: 1, error: 2 }

export const TYPE_COLOR: Record<NotifType, string> = {
  error: '#e5484d',
  warning: '#f5a623',
  info: '#3b82f6'
}

export interface NotifTarget {
  view: string | null
  anchor: string | null
}

export interface AppNotification {
  id: string
  type: NotifType
  description: string
  timeMs: number
  seen: boolean
  target?: NotifTarget
  /** Dismiss disabled while true (e.g. unresolved repair). */
  sticky?: boolean
  /** Why dismiss is disabled. */
  stickyHint?: string
  /** Groups a notification with a resolvable condition. */
  resolveKey?: string
}

export interface Toast {
  id: string
  title: string
  /** CSS color for the text. */
  color: string
  /** Shown on hover. */
  description?: string
  origin?: NotifTarget
}

interface NotificationStore {
  notifications: AppNotification[]
  toasts: Toast[] // queue; toasts[0] is active
  flashTick: number

  /** Logged event: adds a notification AND a toast (unless the type is muted). */
  notify: (n: {
    type: NotifType
    description: string
    target?: NotifTarget
    sticky?: boolean
    stickyHint?: string
    resolveKey?: string
  }) => void
  /** Transient toast only (not logged). */
  toast: (t: Omit<Toast, 'id'>) => void

  shiftToast: () => void
  markSeen: (id: string) => void
  dismiss: (id: string) => void
  /** Remove notifications for a resolved condition (they vanish once fixed). */
  resolve: (resolveKey: string) => void
  clearAll: () => void
  clearSeen: () => void
}

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `n_${Date.now()}_${Math.random().toString(36).slice(2)}`

const CAP = 200

const isMuted = (type: NotifType): boolean => {
  const s = useStore.getState().settings
  if (type === 'error') return s.muteError === true
  if (type === 'warning') return s.muteWarning === true
  return s.muteInfo === true
}

export const useNotifications = create<NotificationStore>((set, get) => ({
  notifications: [],
  toasts: [],
  flashTick: 0,

  notify: ({ type, description, target, sticky, stickyHint, resolveKey }) => {
    if (isMuted(type)) return
    // Don't stack an unresolved notification for the same condition.
    if (
      resolveKey &&
      get().notifications.some((n) => n.resolveKey === resolveKey && n.sticky)
    ) {
      return
    }
    const n: AppNotification = {
      id: uid(),
      type,
      description,
      timeMs: Date.now(),
      seen: false,
      target,
      sticky,
      stickyHint,
      resolveKey
    }
    set((s) => ({
      notifications: [n, ...s.notifications].slice(0, CAP),
      toasts: [...s.toasts, { id: n.id, title: description, color: TYPE_COLOR[type], description, origin: target }],
      flashTick: s.flashTick + 1
    }))
    // Mirror into the single app log so every logged event is in one place.
    void ipc.logWrite(type, target?.view ?? 'app', description)
  },

  toast: (t) => {
    set((s) => ({ toasts: [...s.toasts, { ...t, id: uid() }] }))
  },

  shiftToast: () => set((s) => ({ toasts: s.toasts.slice(1) })),

  markSeen: (id) =>
    set((s) => ({
      notifications: s.notifications.map((n) => (n.id === id ? { ...n, seen: true } : n))
    })),

  dismiss: (id) => set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),

  resolve: (resolveKey) =>
    set((s) => ({
      notifications: s.notifications.filter((n) => n.resolveKey !== resolveKey)
    })),

  clearAll: () => set({ notifications: [] }),

  clearSeen: () => set((s) => ({ notifications: s.notifications.filter((n) => !n.seen) }))
}))

/** Highest-severity unseen type + newest of that type (for the bell dot/hint). */
export function topUnseen(notifs: AppNotification[]): AppNotification | null {
  const unseen = notifs.filter((n) => !n.seen)
  if (unseen.length === 0) return null
  return unseen.reduce((best, n) => {
    if (SEVERITY[n.type] > SEVERITY[best.type]) return n
    if (SEVERITY[n.type] === SEVERITY[best.type] && n.timeMs > best.timeMs) return n
    return best
  })
}
