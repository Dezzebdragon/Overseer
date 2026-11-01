export type TrackerTypeId =
  | 'bytes'
  | 'int'
  | 'float'
  | 'string'
  | 'time'
  | 'duration'
  | 'date'
  | 'percentage'
  | 'bool'

/** Curated vibrant palette (also used for swatch recoloring). */
export const SWATCHES = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#a855f7', // violet
  '#f59e0b', // amber
  '#ef4444', // red
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#ec4899', // pink
  '#f97316', // orange
  '#14b8a6' // teal
]

interface TrackerType {
  id: TrackerTypeId
  format: (value: unknown) => string
  defaultColor: string
}

const NA = '—'

/**
 * A resolver may return this instead of a value to mean "the thing this tracker
 * pointed at no longer exists" (e.g. a tracked task was deleted). Distinct from a
 * plain null/undefined, which means "no value right now" (e.g. no project open).
 * `reason` is surfaced as the cell's hover hint. Reusable by any current or future
 * tracker that can lose its target.
 */
export interface TrackerNA {
  na: true
  reason: string
}

export function trackerNA(reason: string): TrackerNA {
  return { na: true, reason }
}

export function isTrackerNA(value: unknown): value is TrackerNA {
  return typeof value === 'object' && value !== null && (value as { na?: unknown }).na === true
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const kb = n / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

export const TRACKER_TYPES: Record<TrackerTypeId, TrackerType> = {
  bytes: {
    id: 'bytes',
    defaultColor: '#3b82f6',
    format: (v) => {
      const n = asNumber(v)
      return n === null ? NA : formatBytes(n)
    }
  },
  int: {
    id: 'int',
    defaultColor: '#22c55e',
    format: (v) => {
      const n = asNumber(v)
      return n === null ? NA : Math.round(n).toLocaleString()
    }
  },
  float: {
    id: 'float',
    defaultColor: '#14b8a6',
    format: (v) => {
      const n = asNumber(v)
      return n === null ? NA : n.toFixed(2)
    }
  },
  string: {
    id: 'string',
    defaultColor: '#a855f7',
    format: (v) => (v === null || v === undefined || v === '' ? NA : String(v))
  },
  time: {
    id: 'time',
    defaultColor: '#06b6d4',
    format: (v) => {
      const n = asNumber(v)
      return n === null ? NA : new Date(n).toLocaleTimeString()
    }
  },
  duration: {
    id: 'duration',
    defaultColor: '#f59e0b',
    format: (v) => {
      const n = asNumber(v)
      return n === null ? NA : formatDuration(n)
    }
  },
  date: {
    id: 'date',
    defaultColor: '#ec4899',
    format: (v) => {
      const n = asNumber(v)
      return n === null ? NA : new Date(n).toLocaleDateString()
    }
  },
  percentage: {
    id: 'percentage',
    defaultColor: '#84cc16',
    // Expects a percent number (0..100).
    format: (v) => {
      const n = asNumber(v)
      return n === null ? NA : `${n.toFixed(0)}%`
    }
  },
  bool: {
    id: 'bool',
    defaultColor: '#f97316',
    format: (v) => (v === null || v === undefined ? NA : v ? 'Yes' : 'No')
  }
}

export function formatValue(typeId: TrackerTypeId, value: unknown): string {
  if (isTrackerNA(value)) return NA
  return TRACKER_TYPES[typeId].format(value)
}

export function typeDefaultColor(typeId: TrackerTypeId): string {
  return TRACKER_TYPES[typeId].defaultColor
}
