import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  readdirSync
} from 'node:fs'
import { join, basename } from 'node:path'
import { shell } from 'electron'
import type { AgentDetect, AgentInfo, RegisterPlan } from '@shared/types'
import { getAppDataDir } from './paths'
import { AGENTS, MCP_SERVER_NAME, getAgentDef, resolveServerUrl, agentsList } from './agents'
import { appLog } from './app-log'

/**
 * Writing side of agent registration. We edit config files this app doesn't own,
 * so every mutation is backed up first (into app-data), never duplicates our
 * server entry, and — for TOML — touches only our own table, leaving the rest of
 * the user's file intact.
 */

// ---- backups (app-data) ----------------------------------------------

function backupDir(agentId: string): string {
  return join(getAppDataDir(), 'agent-backups', agentId)
}

/** Copy the current config aside before mutating. Returns the backup path or null. */
function backup(agentId: string, configPath: string): string | null {
  if (!existsSync(configPath)) return null
  const dir = backupDir(agentId)
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = join(dir, `${stamp}__${basename(configPath)}`)
  copyFileSync(configPath, dest)
  return dest
}

/** Reveal the most recent backup for an agent in the OS file explorer. */
export function openBackup(agentId: string): boolean {
  const dir = backupDir(agentId)
  if (!existsSync(dir)) return false
  const files = readdirSync(dir).sort() // ISO-timestamp names sort chronologically
  if (files.length === 0) return false
  shell.showItemInFolder(join(dir, files[files.length - 1]))
  return true
}

// ---- JSON writers (Claude Desktop; Claude Code user/global scope) -----

function readJsonObject(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    throw new Error(
      `Cannot parse ${basename(configPath)} — it isn't valid JSON. Fix or remove it, then retry.`
    )
  }
}

function writeJsonFile(configPath: string, data: unknown): void {
  mkdirSync(join(configPath, '..'), { recursive: true })
  writeFileSync(configPath, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

/** Remove our server from every per-project scope (Claude Code) to avoid duplicates. */
function stripPerProject(json: Record<string, unknown>): void {
  const projects = json.projects
  if (!projects || typeof projects !== 'object') return
  for (const proj of Object.values(projects as Record<string, unknown>)) {
    const servers = (proj as { mcpServers?: Record<string, unknown> })?.mcpServers
    if (servers && typeof servers === 'object' && MCP_SERVER_NAME in servers) {
      delete servers[MCP_SERVER_NAME]
    }
  }
}

function setJsonServer(configPath: string, serverUrl: string, claudeCode: boolean): void {
  const json = readJsonObject(configPath)
  const servers =
    json.mcpServers && typeof json.mcpServers === 'object'
      ? (json.mcpServers as Record<string, unknown>)
      : {}
  servers[MCP_SERVER_NAME] = { url: serverUrl } // replace in place — never a duplicate
  json.mcpServers = servers
  if (claudeCode) stripPerProject(json)
  writeJsonFile(configPath, json)
}

function removeJsonServer(configPath: string, claudeCode: boolean): void {
  if (!existsSync(configPath)) return
  const json = readJsonObject(configPath)
  const servers = json.mcpServers as Record<string, unknown> | undefined
  if (servers && typeof servers === 'object') delete servers[MCP_SERVER_NAME]
  if (claudeCode) stripPerProject(json)
  writeJsonFile(configPath, json)
}

// ---- TOML writer (Codex) — block surgery, leaves the rest byte-intact -

function tomlBlock(serverUrl: string): string {
  return `[mcp_servers.${MCP_SERVER_NAME}]\nurl = "${serverUrl}"\n`
}

/**
 * Return `text` with the table starting at `header` replaced by `block`
 * (removed when block is ''); appends when the table is absent and block is set.
 * Only our own table is affected — everything else is preserved.
 */
function replaceTomlBlock(text: string, header: string, block: string): string {
  const lines = text.split(/\r?\n/)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === header) {
      start = i
      break
    }
  }

  if (start === -1) {
    if (!block) return text
    const gap = text.length === 0 ? '' : text.endsWith('\n') ? '\n' : '\n\n'
    return `${text}${gap}${block}`
  }

  // End of our table: the next line that opens a new table, else EOF.
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('[')) {
      end = i
      break
    }
  }
  const before = lines.slice(0, start).join('\n').replace(/\n+$/, '')
  const after = lines.slice(end).join('\n').replace(/^\n+/, '')
  const mid = block.replace(/\n+$/, '')
  const parts = [before, mid, after].filter((p) => p.length > 0)
  const joined = parts.join('\n')
  if (joined.length === 0) return ''
  return joined.endsWith('\n') ? joined : joined + '\n'
}

function setTomlServer(configPath: string, serverUrl: string): void {
  const header = `[mcp_servers.${MCP_SERVER_NAME}]`
  const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : ''
  const next = replaceTomlBlock(existing, header, tomlBlock(serverUrl))
  mkdirSync(join(configPath, '..'), { recursive: true })
  writeFileSync(configPath, next, 'utf8')
}

function removeTomlServer(configPath: string): void {
  if (!existsSync(configPath)) return
  const header = `[mcp_servers.${MCP_SERVER_NAME}]`
  const next = replaceTomlBlock(readFileSync(configPath, 'utf8'), header, '')
  writeFileSync(configPath, next, 'utf8')
}

// ---- public API ------------------------------------------------------

/** Agents whose config file actually exists on this machine. */
export function detectAgents(): AgentDetect[] {
  const list = agentsList()
  return AGENTS.filter((d) => existsSync(d.configPath())).map((d) => ({
    id: d.id,
    name: d.name,
    configPath: d.configPath(),
    health: list.find((x) => x.id === d.id)?.health ?? 'not_found'
  }))
}

/** Dry-run: what registering this agent will write, and over what. */
export function planRegister(agentId: string): RegisterPlan {
  const def = getAgentDef(agentId)
  if (!def) throw new Error(`Unknown agent: ${agentId}`)
  const configPath = def.configPath()
  const after = resolveServerUrl()
  let before: string | null = null
  let present = false
  if (existsSync(configPath)) {
    try {
      const found = def.lookup(readFileSync(configPath, 'utf8'))
      before = found.url
      present = found.present
    } catch {
      /* a parse problem will surface when we actually write */
    }
  }
  return {
    agentId,
    name: def.name,
    configPath,
    scope: def.format === 'json-claude-code' ? 'user (global, top-level)' : 'user (global)',
    before,
    after,
    willOverwrite: present && before !== after,
    present
  }
}

export function registerAgent(agentId: string): AgentInfo[] {
  const def = getAgentDef(agentId)
  if (!def) throw new Error(`Unknown agent: ${agentId}`)
  const configPath = def.configPath()
  const serverUrl = resolveServerUrl()
  backup(agentId, configPath)
  if (def.format === 'toml') setTomlServer(configPath, serverUrl)
  else setJsonServer(configPath, serverUrl, def.format === 'json-claude-code')
  appLog('info', 'agents', `Registered ${def.name} → ${serverUrl}`)
  return agentsList()
}

export function unregisterAgent(agentId: string): AgentInfo[] {
  const def = getAgentDef(agentId)
  if (!def) throw new Error(`Unknown agent: ${agentId}`)
  const configPath = def.configPath()
  backup(agentId, configPath)
  if (def.format === 'toml') removeTomlServer(configPath)
  else removeJsonServer(configPath, def.format === 'json-claude-code')
  appLog('info', 'agents', `Unregistered ${def.name}`)
  return agentsList()
}
