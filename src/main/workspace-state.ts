import { app } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  type AppSettings
} from '@shared/ipc'
import {
  EMPTY_WORKSPACE_STATE,
  type WorkspaceState
} from '@shared/types'

function userDir(): string {
  return app.getPath('userData')
}

function workspaceStatePath(root: string): string {
  const hash = createHash('sha1').update(root).digest('hex').slice(0, 16)
  return join(userDir(), 'workspaces', hash, 'state.json')
}

function settingsPath(): string {
  return join(userDir(), 'settings.json')
}

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await fs.mkdir(join(path, '..'), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmp, path)
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path, 'utf-8')
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) }
  } catch {
    return fallback
  }
}

export async function loadWorkspaceState(root: string): Promise<WorkspaceState> {
  return readJson(workspaceStatePath(root), EMPTY_WORKSPACE_STATE)
}

export async function saveWorkspaceState(
  root: string,
  state: WorkspaceState
): Promise<void> {
  await writeJsonAtomic(workspaceStatePath(root), state)
}

/** Delete our app-created state for a workspace (used by "forget"). */
export async function deleteWorkspaceState(root: string): Promise<void> {
  await fs.rm(join(workspaceStatePath(root), '..'), { recursive: true, force: true })
}

export async function loadSettings(): Promise<AppSettings> {
  return readJson(settingsPath(), DEFAULT_SETTINGS)
}

/** Synchronous settings read (for code paths that can't be async, e.g. agent health). */
export function loadSettingsSync(): AppSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(readFileSync(settingsPath(), 'utf-8')) as Partial<AppSettings>) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await writeJsonAtomic(settingsPath(), settings)
}
