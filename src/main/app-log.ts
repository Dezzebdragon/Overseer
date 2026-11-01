import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { LogEntry, LogLevel } from '@shared/types'
import { getAppDataDir } from './paths'

/**
 * The single app-wide log. Entries are kept in a capped in-memory ring (served to
 * the renderer on demand and streamed live) and appended to a rotating file in
 * app-data for durability/readability.
 */

const CAP = 2000
const MAX_BYTES = 1_000_000 // rotate at ~1 MB, keep one .1 backup

const buffer: LogEntry[] = []
let getWindow: (() => BrowserWindow | null) | null = null

function logFile(): string {
  return join(getAppDataDir(), 'logs', 'app.log')
}

function uid(): string {
  return `l_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function persist(entry: LogEntry): void {
  try {
    const path = logFile()
    mkdirSync(join(path, '..'), { recursive: true })
    if (existsSync(path) && statSync(path).size > MAX_BYTES) {
      renameSync(path, `${path}.1`)
    }
    const line = `${new Date(entry.ts).toISOString()} [${entry.level}] ${entry.source}: ${entry.message}\n`
    appendFileSync(path, line, 'utf8')
  } catch {
    /* logging must never throw */
  }
}

export function initAppLog(getWin: () => BrowserWindow | null): void {
  getWindow = getWin
}

/** Append an entry: ring buffer + file + live stream to the renderer. */
export function appLog(level: LogLevel, source: string, message: string): LogEntry {
  const entry: LogEntry = { id: uid(), ts: Date.now(), level, source, message }
  buffer.push(entry)
  if (buffer.length > CAP) buffer.splice(0, buffer.length - CAP)
  persist(entry)
  const win = getWindow?.()
  if (win && !win.isDestroyed()) win.webContents.send('log:entry', entry)
  return entry
}

/** Current in-memory history (oldest → newest). */
export function getLogHistory(): LogEntry[] {
  return buffer.slice()
}

export function clearLog(): void {
  buffer.length = 0
  try {
    const path = logFile()
    if (existsSync(path)) renameSync(path, `${path}.1`)
  } catch {
    /* ignore */
  }
}

/** Read the persisted log file (for debugging/export); unused by the UI for now. */
export function readLogFile(): string {
  try {
    return readFileSync(logFile(), 'utf8')
  } catch {
    return ''
  }
}
