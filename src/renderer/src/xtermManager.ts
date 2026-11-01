import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ipc } from './ipc'

/**
 * Keeps one xterm instance (and its detached container element) per terminal id,
 * OUTSIDE React. A surface (Logs view or bottom panel) "mounts" a terminal by
 * appending its container into a slot; moving the node preserves the live session,
 * so the same terminal can travel between the two surfaces without a restart.
 */

interface Entry {
  term: Terminal
  fit: FitAddon
  container: HTMLDivElement
  opened: boolean
}

const entries = new Map<string, Entry>()
let subscribed = false

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function ensureSubscription(): void {
  if (subscribed) return
  subscribed = true
  window.api.on('term:data', ({ id, data }) => {
    entries.get(id)?.term.write(data)
  })
  window.api.on('term:exit', ({ id, exitCode }) => {
    entries.get(id)?.term.write(`\r\n\x1b[90m[process exited (${exitCode})]\x1b[0m\r\n`)
  })
}

function create(id: string): Entry {
  ensureSubscription()
  const term = new Terminal({
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    cursorBlink: true,
    allowProposedApi: true,
    theme: {
      background: cssVar('--bg', '#1e1e1e'),
      foreground: cssVar('--fg', '#d4d4d4')
    }
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const container = document.createElement('div')
  container.className = 'xterm-host'
  // User keystrokes → PTY.
  term.onData((d) => void ipc.termWrite(id, d))
  const entry: Entry = { term, fit, container, opened: false }
  entries.set(id, entry)
  return entry
}

export function getOrCreate(id: string): Entry {
  return entries.get(id) ?? create(id)
}

/** Append the terminal's container into `slot`, fit to it, and focus. */
export function mountInto(id: string, slot: HTMLElement): void {
  const e = getOrCreate(id)
  if (e.container.parentElement !== slot) slot.appendChild(e.container)
  // Open lazily, once the container is actually in the DOM (xterm needs layout).
  if (!e.opened) {
    e.term.open(e.container)
    e.opened = true
  }
  requestAnimationFrame(() => {
    fit(id)
    e.term.focus()
  })
}

/** Detach the container (keeps the instance + session alive). */
export function unmount(id: string): void {
  const e = entries.get(id)
  if (e?.container.parentElement) e.container.parentElement.removeChild(e.container)
}

export function fit(id: string): void {
  const e = entries.get(id)
  if (!e) return
  try {
    e.fit.fit()
    void ipc.termResize(id, e.term.cols, e.term.rows)
  } catch {
    /* element may be detached / zero-size */
  }
}

export function dispose(id: string): void {
  const e = entries.get(id)
  if (!e) return
  unmount(id)
  e.term.dispose()
  entries.delete(id)
}

export function hasSelection(id: string): boolean {
  return entries.get(id)?.term.hasSelection() ?? false
}

export function getSelection(id: string): string {
  return entries.get(id)?.term.getSelection() ?? ''
}

/** Paste text into the terminal (handles bracketed-paste correctly). */
export function pasteInto(id: string, text: string): void {
  entries.get(id)?.term.paste(text)
}
