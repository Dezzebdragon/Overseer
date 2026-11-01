import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { AgentInfo } from '@shared/types'
import { loadSettingsSync } from './workspace-state'

/**
 * Detection + registration of local AI agents (Claude Code, Codex, Claude Desktop):
 * find each one's MCP config, look for OUR server entry, and report health. The
 * server is root-agnostic — one global registration serves every project this app
 * manages (the active project is resolved at request time), so health no longer
 * depends on a project root. Health is recomputed whenever a config file changes.
 */

// Our server identity (stable port + fixed name; see mcp-transition.md).
export const MCP_SERVER_NAME = 'custom-ide'
export const MCP_PORT = 4517

/** The built-in default server URL (root-agnostic). */
export function defaultServerUrl(): string {
  return `http://127.0.0.1:${MCP_PORT}/mcp`
}

/** The URL we consider correct — the user-configured command, or the default. */
export function resolveServerUrl(): string {
  const configured = loadSettingsSync().agentCommands?.mcpServerUrl?.trim()
  return configured && configured.length > 0 ? configured : defaultServerUrl()
}

/** How an agent's config file is edited when (un)registering. */
export type AgentFormat = 'json' | 'json-claude-code' | 'toml'

export interface AgentDef {
  id: string
  name: string
  format: AgentFormat
  configPath: () => string
  /** parse config text → { registeredUrl, present } for our server name */
  lookup: (text: string) => { url: string | null; present: boolean }
}

function claudeDesktopPath(): string {
  const home = homedir()
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
  }
  return join(home, '.config', 'Claude', 'claude_desktop_config.json')
}

/** Pull a url out of an mcpServers[NAME] entry (http server has a `url`). */
function entryUrl(entry: unknown): string | null {
  if (entry && typeof entry === 'object' && typeof (entry as { url?: unknown }).url === 'string') {
    return (entry as { url: string }).url
  }
  return null
}

/** JSON configs (Claude Desktop; Claude Code user scope + per-project scope). */
function lookupJsonMcpServers(text: string, opts: { perProject?: boolean } = {}): {
  url: string | null
  present: boolean
} {
  let json: Record<string, unknown>
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    return { url: null, present: false }
  }
  const scan = (servers: unknown): string | null | undefined => {
    if (!servers || typeof servers !== 'object') return undefined
    if (!(MCP_SERVER_NAME in (servers as Record<string, unknown>))) return undefined
    return entryUrl((servers as Record<string, unknown>)[MCP_SERVER_NAME])
  }
  // top-level (user scope)
  const top = scan((json as { mcpServers?: unknown }).mcpServers)
  if (top !== undefined) return { url: top, present: true }
  // per-project (Claude Code local scope: projects[<path>].mcpServers)
  if (opts.perProject && json.projects && typeof json.projects === 'object') {
    for (const proj of Object.values(json.projects as Record<string, unknown>)) {
      const u = scan((proj as { mcpServers?: unknown })?.mcpServers)
      if (u !== undefined) return { url: u, present: true }
    }
  }
  return { url: null, present: false }
}

/** Minimal TOML scan for Codex: find [mcp_servers.custom-ide] then its url. */
function lookupCodexToml(text: string): { url: string | null; present: boolean } {
  const lines = text.split(/\r?\n/)
  const header = `[mcp_servers.${MCP_SERVER_NAME}]`
  let inBlock = false
  let present = false
  let url: string | null = null
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inBlock = line === header
      if (inBlock) present = true
      continue
    }
    if (inBlock) {
      const m = line.match(/^url\s*=\s*["']([^"']+)["']/)
      if (m) url = m[1]
    }
  }
  return { url, present }
}

export const AGENTS: AgentDef[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    format: 'json-claude-code',
    configPath: () => join(homedir(), '.claude.json'),
    lookup: (t) => lookupJsonMcpServers(t, { perProject: true })
  },
  {
    id: 'codex',
    name: 'Codex',
    format: 'toml',
    configPath: () => join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml'),
    lookup: lookupCodexToml
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    format: 'json',
    configPath: claudeDesktopPath,
    lookup: lookupJsonMcpServers
  }
]

export function getAgentDef(id: string): AgentDef | undefined {
  return AGENTS.find((d) => d.id === id)
}

function computeOne(def: AgentDef, serverUrl: string): AgentInfo {
  const configPath = def.configPath()
  const base: AgentInfo = {
    id: def.id,
    name: def.name,
    found: false,
    configPath,
    registeredPath: null,
    health: 'not_found'
  }
  if (!existsSync(configPath)) return base

  let text = ''
  try {
    text = readFileSync(configPath, 'utf8')
  } catch {
    return base
  }
  const { url, present } = def.lookup(text)

  if (!present) {
    return { ...base, found: true, health: 'missing' }
  }
  if (url === serverUrl) {
    return { ...base, found: true, health: 'active' }
  }
  return {
    ...base,
    found: true,
    health: 'mismatch',
    problem: `Registered with a different URL: ${url ?? 'unknown'}`
  }
}

/**
 * Health for every known agent. Root is accepted for call-site compatibility but
 * no longer affects health (the server is root-agnostic).
 */
export function agentsList(_root?: string | null): AgentInfo[] {
  const serverUrl = resolveServerUrl()
  return AGENTS.map((d) => computeOne(d, serverUrl))
}

// ---- watching --------------------------------------------------------

let watchers: FSWatcher[] = []
let watchRoot: string | null = null

/** Start watching the agents' config files; emit fresh lists on change. */
export function startAgentWatch(getWindow: () => BrowserWindow | null): void {
  if (watchers.length > 0) return
  const emit = (): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('agents:changed', agentsList(watchRoot))
  }
  let timer: NodeJS.Timeout | null = null
  const debounced = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(emit, 250)
  }
  for (const def of AGENTS) {
    const dir = dirname(def.configPath())
    try {
      if (existsSync(dir)) watchers.push(watch(dir, debounced))
    } catch {
      /* directory not watchable — skip */
    }
  }
}

export function setAgentWatchRoot(root: string | null): void {
  watchRoot = root
}
