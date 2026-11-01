import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { BigConfig, ProjectConfig, ProjectState } from '@shared/types'

export const CONFIG_FILE = 'big-mcp.config.json'
export const STATE_FILE = 'big-state.json'

export function configPath(root: string): string {
  return join(root, CONFIG_FILE)
}
export function statePath(root: string): string {
  return join(root, STATE_FILE)
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export function fileExists(root: string, rel: string): Promise<boolean> {
  return pathExists(join(root, ...rel.split('/')))
}

export function defaultState(): ProjectState {
  return { schemaVersion: 1, nextId: 1, tasks: [] }
}

export const SCHEMA_VERSION = 3

/** A file's short name (basename); callers dedupe collisions against existing keys. */
export function nameFor(relPath: string): string {
  return basename(relPath)
}

export function defaultConfig(
  root: string,
  template: string,
  paths: Record<string, string>,
  requiredDocs: string[],
  scaffoldedDocs: string[]
): ProjectConfig {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: basename(root) || root,
    template,
    paths,
    requiredDocs,
    scaffoldedDocs
  }
}

/** Migrate older configs (paths keyed by doc id) to the name→path schema. */
function migrateConfig(raw: ProjectConfig): ProjectConfig {
  if ((raw.schemaVersion ?? 0) >= SCHEMA_VERSION) return raw
  const oldPaths = raw.paths ?? {}
  // old paths: docId -> relpath. Rebuild as name -> relpath.
  const paths: Record<string, string> = {}
  const idToName: Record<string, string> = {}
  for (const [id, rel] of Object.entries(oldPaths)) {
    const name = nameFor(rel)
    paths[name] = rel
    idToName[id] = name
  }
  const mapNames = (arr: string[] | undefined): string[] =>
    (arr ?? []).map((x) => idToName[x] ?? (paths[x] ? x : x)).filter((n) => paths[n])
  return {
    schemaVersion: SCHEMA_VERSION,
    name: raw.name,
    template: raw.template,
    paths,
    requiredDocs: mapNames(raw.requiredDocs),
    scaffoldedDocs: mapNames(raw.scaffoldedDocs)
  }
}

export async function readConfig(root: string): Promise<ProjectConfig | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath(root), 'utf8')) as ProjectConfig
    return migrateConfig(parsed)
  } catch {
    return null
  }
}

export async function writeConfig(root: string, config: ProjectConfig): Promise<void> {
  await fs.writeFile(configPath(root), `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

export async function writeState(root: string, state: ProjectState): Promise<void> {
  await fs.writeFile(statePath(root), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

export const BIGCONFIG_FILE = 'big-config.json'
export function bigConfigPath(root: string): string {
  return join(root, BIGCONFIG_FILE)
}

/** Read big-state.json, tolerating a missing/partial file. */
export async function readState(root: string): Promise<ProjectState> {
  try {
    const raw = await fs.readFile(statePath(root), 'utf8')
    const j = JSON.parse(raw) as Partial<ProjectState>
    return {
      schemaVersion: typeof j.schemaVersion === 'number' ? j.schemaVersion : 1,
      nextId: typeof j.nextId === 'number' ? j.nextId : 1,
      tasks: Array.isArray(j.tasks) ? (j.tasks as ProjectState['tasks']) : []
    }
  } catch {
    return defaultState()
  }
}

/** Read workflow mode from big-config.json (defaults to flat). */
export async function readBigConfig(root: string): Promise<BigConfig> {
  try {
    const raw = await fs.readFile(bigConfigPath(root), 'utf8')
    const j = JSON.parse(raw) as Partial<BigConfig>
    return { workflowMode: j.workflowMode === 'gitNative' ? 'gitNative' : 'flat' }
  } catch {
    return { workflowMode: 'flat' }
  }
}

/** Write big-config.json, preserving any other keys already present. */
export async function writeBigConfig(root: string, config: BigConfig): Promise<void> {
  let existing: Record<string, unknown> = {}
  try {
    existing = JSON.parse(await fs.readFile(bigConfigPath(root), 'utf8')) as Record<string, unknown>
  } catch {
    /* new file */
  }
  await fs.writeFile(
    bigConfigPath(root),
    `${JSON.stringify({ ...existing, ...config }, null, 2)}\n`,
    'utf8'
  )
}
