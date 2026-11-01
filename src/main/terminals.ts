import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { ShellProfile, TerminalInfo } from '@shared/types'
import type { AppSettings } from '@shared/ipc'
import {
  TERMINAL_CD,
  AGENT_RUN,
  toOSPlatform,
  substituteProjectDir,
  type OSPlatform
} from '@shared/terminal-commands'
import { loadSettingsSync } from './workspace-state'
import { appLog } from './app-log'

/**
 * PTY-backed terminals. node-pty is a native module that must be compiled for the
 * target Electron ABI (electron-rebuild at packaging time). It's loaded lazily via
 * a variable specifier so this file typechecks and bundles even where the native
 * binary isn't present; a real terminal only spawns once node-pty is installed +
 * rebuilt on the host.
 */

// --- minimal node-pty surface (hand-written so we don't depend on its types) ---
interface IPty {
  readonly pid: number
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}
interface IPtyModule {
  spawn(file: string, args: string[], opts: Record<string, unknown>): IPty
}

const NODE_PTY: string = 'node-pty'
let ptyPromise: Promise<IPtyModule> | null = null
function loadPty(): Promise<IPtyModule> {
  if (!ptyPromise) {
    ptyPromise = import(/* @vite-ignore */ NODE_PTY).then((m) => (m.default ?? m) as IPtyModule)
  }
  return ptyPromise
}

// --- shell detection (built-in system shells only) -----------------------------

/** Only built-in system shell locations count (no Homebrew / user-installed). */
function isSystemPath(p: string): boolean {
  return (
    p.startsWith('/bin/') ||
    p.startsWith('/usr/bin/') ||
    p.startsWith('/sbin/') ||
    p.startsWith('/usr/sbin/')
  )
}

function detectUnixShells(): ShellProfile[] {
  // Well-known system shells, plus anything /etc/shells declares.
  const paths = new Set<string>([
    '/bin/zsh',
    '/bin/bash',
    '/usr/bin/bash',
    '/bin/sh',
    '/usr/bin/zsh',
    '/usr/bin/fish'
  ])
  try {
    for (const line of readFileSync('/etc/shells', 'utf8').split('\n')) {
      const p = line.trim()
      if (p && !p.startsWith('#')) paths.add(p)
    }
  } catch {
    /* /etc/shells may not exist */
  }

  const out: ShellProfile[] = []
  const seenReal = new Set<string>()
  const seenLabel = new Set<string>()
  for (const p of paths) {
    if (!isSystemPath(p) || !existsSync(p)) continue
    let real = p
    try {
      real = realpathSync(p)
    } catch {
      /* keep p */
    }
    // Dedup by resolved binary (symlinks) and by name (no two "bash" entries).
    if (seenReal.has(real)) continue
    const label = p.split('/').pop() ?? p
    if (seenLabel.has(label)) continue
    seenReal.add(real)
    seenLabel.add(label)
    out.push({ id: label, label, path: p })
  }
  return out
}

function detectWindowsShells(): ShellProfile[] {
  const found: ShellProfile[] = []
  const sysRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const ps = `${sysRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  const cmd = `${sysRoot}\\System32\\cmd.exe`
  if (existsSync(ps)) found.push({ id: 'powershell', label: 'PowerShell', path: ps })
  if (existsSync(cmd)) found.push({ id: 'cmd', label: 'Command Prompt', path: cmd })
  return found
}

export function detectShells(): ShellProfile[] {
  return process.platform === 'win32' ? detectWindowsShells() : detectUnixShells()
}

/** Agents that run as a CLI (Claude Desktop is a GUI app → excluded). */
interface CliAgent {
  agentId: string
  name: string
  bin: string
}
const CLI_AGENTS: CliAgent[] = [
  { agentId: 'claude-code', name: 'Claude Code', bin: 'claude' },
  { agentId: 'codex', name: 'Codex', bin: 'codex' }
]

/** Is an executable named `bin` reachable on PATH? */
function binOnPath(bin: string): boolean {
  const path = process.env.PATH ?? ''
  const sep = process.platform === 'win32' ? ';' : ':'
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of path.split(sep)) {
    if (!dir) continue
    for (const ext of exts) {
      try {
        if (existsSync(join(dir, bin + ext))) return true
      } catch {
        /* ignore unreadable PATH entry */
      }
    }
  }
  return false
}

/** Terminal options for detected CLI agents — spawn the default shell, auto-run the agent. */
function detectAgentProfiles(): ShellProfile[] {
  const shell = detectShells()[0]
  if (!shell) return []
  return CLI_AGENTS.filter((a) => binOnPath(a.bin)).map((a) => ({
    id: `agent:${a.agentId}`,
    label: a.name,
    path: shell.path,
    args: shell.args,
    kind: 'agent' as const,
    agentId: a.agentId
  }))
}

/** All "+ terminal" options: system shells first, then detected agents. */
export function detectProfiles(): ShellProfile[] {
  return [...detectShells(), ...detectAgentProfiles()]
}

/** Resolve a per-OS terminal command from settings, falling back to shared defaults. */
function resolveTermCommand(id: string, platform: OSPlatform, s: AppSettings): string {
  const stored = s.agentCommands?.[`${id}:${platform}`]
  if (stored && stored.trim()) return stored
  if (id === 'terminalCd') return TERMINAL_CD[platform].value
  if (id.startsWith('agentRun.')) {
    const agentId = id.slice('agentRun.'.length)
    return AGENT_RUN[agentId]?.[platform]?.value ?? ''
  }
  return ''
}

function defaultCwd(): string {
  return homedir()
}

// --- manager -------------------------------------------------------------------

interface Live {
  pty: IPty
  info: TerminalInfo
}

const terminals = new Map<string, Live>()
let getWindow: (() => BrowserWindow | null) | null = null
let counter = 0

export function initTerminals(getWin: () => BrowserWindow | null): void {
  getWindow = getWin
}

function send<T>(channel: 'term:data' | 'term:exit', payload: T): void {
  const win = getWindow?.()
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

export function listTerminals(): TerminalInfo[] {
  return [...terminals.values()].map((t) => t.info)
}

export async function createTerminal(
  profileId: string,
  projectDir: string | null
): Promise<TerminalInfo> {
  const profile = detectProfiles().find((p) => p.id === profileId) ?? detectShells()[0]
  if (!profile) throw new Error('No system shell detected')

  const mod = await loadPty()
  const home = defaultCwd()
  const pty = mod.spawn(profile.path, profile.args ?? [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: home,
    env: process.env as Record<string, string>
  })

  const s = loadSettingsSync()
  const useProject = s.logsUseProjectDir !== false && !!projectDir
  const autoStart = s.logsAutoStartAgents !== false

  const id = `term_${Date.now()}_${counter++}`
  const info: TerminalInfo = {
    id,
    profileId: profile.id,
    title: profile.label,
    pid: pty.pid,
    cwd: useProject && projectDir ? projectDir : home,
    exited: false
  }
  terminals.set(id, { pty, info })

  pty.onData((data) => send('term:data', { id, data }))
  pty.onExit(({ exitCode }) => {
    const live = terminals.get(id)
    if (live) live.info = { ...live.info, exited: true, exitCode }
    send('term:exit', { id, exitCode })
  })

  // Assemble the auto-run: cd to project (if enabled), then launch the agent (if enabled).
  const platform = toOSPlatform(process.platform)
  const lines: string[] = []
  if (useProject && projectDir) {
    const cd = resolveTermCommand('terminalCd', platform, s)
    if (cd) lines.push(substituteProjectDir(cd, projectDir))
  }
  if (profile.agentId && autoStart) {
    const run = resolveTermCommand(`agentRun.${profile.agentId}`, platform, s)
    if (run) lines.push(run)
  }
  if (lines.length > 0) {
    // Give the shell a moment to print its first prompt before typing.
    setTimeout(() => {
      const live = terminals.get(id)
      if (!live || live.info.exited) return
      for (const line of lines) live.pty.write(line + '\r')
    }, 400)
  }

  appLog('info', 'terminal', `Opened ${profile.label} (pid ${pty.pid})`)
  return info
}

export function writeTerminal(id: string, data: string): void {
  terminals.get(id)?.pty.write(data)
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const live = terminals.get(id)
  if (!live || live.info.exited) return
  try {
    live.pty.resize(Math.max(1, cols), Math.max(1, rows))
  } catch {
    /* resizing an exited pty can throw — ignore */
  }
}

export function killTerminal(id: string): void {
  const live = terminals.get(id)
  if (!live) return
  appLog('info', 'terminal', `Closed ${live.info.title}`)
  try {
    live.pty.kill()
  } catch {
    /* already gone */
  }
  terminals.delete(id)
}

/** Kill every PTY (called on app quit). */
export function disposeTerminals(): void {
  for (const id of [...terminals.keys()]) killTerminal(id)
}
