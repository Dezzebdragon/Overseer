import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { GithubAccount } from '@shared/types'
import { getRegistryPath } from './paths'

/**
 * App-global registry. For now it only carries template file toggles; it will
 * grow (projects, active project, github client id) when the project layer
 * lands. templateFileToggles is sparse: an absent entry means "required".
 */
export interface Registry {
  templateFileToggles: Record<string, Record<string, boolean>>
  /** Most-recent-first list of absolute project (workspace) paths. */
  recentProjects: string[]
  /** Global template used as the scaffold source (persisted). */
  selectedTemplate: string
  /** Last project opened, reopened on next app start. */
  lastOpenedProject: string | null
  /** GitHub OAuth App client id (device flow). App-wide. */
  oauthClientId: string | null
  /** Recent GitHub accounts (identity only; tokens live in safeStorage). */
  accounts: GithubAccount[]
  /** Login of the last selected account, reselected on start. */
  selectedAccount: string | null
}

const DEFAULT_REGISTRY: Registry = {
  templateFileToggles: {},
  recentProjects: [],
  selectedTemplate: 'default',
  lastOpenedProject: null,
  oauthClientId: null,
  accounts: [],
  selectedAccount: null
}
const MAX_RECENT = 12

function sanitizeToggles(value: unknown): Record<string, Record<string, boolean>> {
  const output: Record<string, Record<string, boolean>> = {}
  if (!value || typeof value !== 'object') return output
  for (const [templateName, files] of Object.entries(value as Record<string, unknown>)) {
    if (!files || typeof files !== 'object') continue
    const entries: Record<string, boolean> = {}
    for (const [relPath, required] of Object.entries(files as Record<string, unknown>)) {
      if (typeof required === 'boolean') entries[relPath] = required
    }
    if (Object.keys(entries).length > 0) output[templateName] = entries
  }
  return output
}

export async function readRegistry(): Promise<Registry> {
  const path = getRegistryPath()
  await fs.mkdir(dirname(path), { recursive: true })
  try {
    const raw = await fs.readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<Registry>
    const recentProjects = Array.isArray(parsed.recentProjects)
      ? parsed.recentProjects.filter((p): p is string => typeof p === 'string')
      : []
    const accounts = Array.isArray(parsed.accounts)
      ? parsed.accounts.filter(
          (a): a is GithubAccount => Boolean(a) && typeof (a as GithubAccount).login === 'string'
        )
      : []
    return {
      templateFileToggles: sanitizeToggles(parsed.templateFileToggles),
      recentProjects,
      selectedTemplate:
        typeof parsed.selectedTemplate === 'string' ? parsed.selectedTemplate : 'default',
      lastOpenedProject:
        typeof parsed.lastOpenedProject === 'string' ? parsed.lastOpenedProject : null,
      oauthClientId: typeof parsed.oauthClientId === 'string' ? parsed.oauthClientId : null,
      accounts,
      selectedAccount:
        typeof parsed.selectedAccount === 'string' ? parsed.selectedAccount : null
    }
  } catch {
    return structuredClone(DEFAULT_REGISTRY)
  }
}

export async function writeRegistry(registry: Registry): Promise<void> {
  const path = getRegistryPath()
  await fs.mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmp, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, path)
}

export async function getSelectedTemplate(): Promise<string> {
  return (await readRegistry()).selectedTemplate
}

export async function getLastOpenedProject(): Promise<string | null> {
  const path = (await readRegistry()).lastOpenedProject
  if (!path) return null
  try {
    await fs.access(path)
    return path
  } catch {
    return null // folder gone; don't try to reopen it
  }
}

export async function setLastOpenedProject(path: string | null): Promise<void> {
  const registry = await readRegistry()
  registry.lastOpenedProject = path
  await writeRegistry(registry)
}

export async function setSelectedTemplate(name: string): Promise<void> {
  const registry = await readRegistry()
  registry.selectedTemplate = name
  await writeRegistry(registry)
}

export async function getRecentProjects(): Promise<string[]> {
  return (await readRegistry()).recentProjects
}

export async function addRecentProject(path: string): Promise<string[]> {
  const registry = await readRegistry()
  const next = [path, ...registry.recentProjects.filter((p) => p !== path)].slice(0, MAX_RECENT)
  registry.recentProjects = next
  await writeRegistry(registry)
  return next
}

export async function removeRecentProject(path: string): Promise<string[]> {
  const registry = await readRegistry()
  registry.recentProjects = registry.recentProjects.filter((p) => p !== path)
  await writeRegistry(registry)
  return registry.recentProjects
}

export async function getDisabledTemplateFiles(templateName: string): Promise<string[]> {
  const registry = await readRegistry()
  const toggles = registry.templateFileToggles[templateName] ?? {}
  return Object.entries(toggles)
    .filter(([, required]) => required === false)
    .map(([relPath]) => relPath)
    .sort((a, b) => a.localeCompare(b))
}

export async function setTemplateFileRequired(
  templateName: string,
  relPath: string,
  required: boolean
): Promise<void> {
  const registry = await readRegistry()
  const current = { ...(registry.templateFileToggles[templateName] ?? {}) }
  if (required) delete current[relPath]
  else current[relPath] = false
  if (Object.keys(current).length > 0) registry.templateFileToggles[templateName] = current
  else delete registry.templateFileToggles[templateName]
  await writeRegistry(registry)
}

export async function copyTemplateToggles(sourceName: string, targetName: string): Promise<void> {
  const registry = await readRegistry()
  const source = registry.templateFileToggles[sourceName]
  if (!source || Object.keys(source).length === 0) return
  registry.templateFileToggles[targetName] = { ...source }
  await writeRegistry(registry)
}

export async function deleteTemplateToggles(templateName: string): Promise<void> {
  const registry = await readRegistry()
  if (!(templateName in registry.templateFileToggles)) return
  delete registry.templateFileToggles[templateName]
  await writeRegistry(registry)
}

/** Drop toggle entries for templates or files that no longer exist. */
export async function pruneTemplateToggles(existing: Map<string, string[]>): Promise<void> {
  const registry = await readRegistry()
  let changed = false
  for (const [templateName, files] of Object.entries(registry.templateFileToggles)) {
    const known = existing.get(templateName)
    if (!known) {
      delete registry.templateFileToggles[templateName]
      changed = true
      continue
    }
    const kept: Record<string, boolean> = {}
    for (const [relPath, required] of Object.entries(files)) {
      if (known.includes(relPath)) kept[relPath] = required
      else changed = true
    }
    if (Object.keys(kept).length > 0) registry.templateFileToggles[templateName] = kept
    else {
      delete registry.templateFileToggles[templateName]
      changed = true
    }
  }
  if (changed) await writeRegistry(registry)
}

// ---- github accounts -------------------------------------------------

const MAX_ACCOUNTS = 12

export async function getOauthClientId(): Promise<string | null> {
  return (await readRegistry()).oauthClientId
}

export async function setOauthClientId(id: string | null): Promise<void> {
  const registry = await readRegistry()
  registry.oauthClientId = id && id.trim() ? id.trim() : null
  await writeRegistry(registry)
}

export async function getAccounts(): Promise<GithubAccount[]> {
  return (await readRegistry()).accounts
}

export async function getSelectedAccount(): Promise<string | null> {
  return (await readRegistry()).selectedAccount
}

/** Add/refresh an account at the top of the recents and mark it selected. */
export async function upsertAccount(account: GithubAccount): Promise<void> {
  const registry = await readRegistry()
  registry.accounts = [
    account,
    ...registry.accounts.filter((a) => a.login !== account.login)
  ].slice(0, MAX_ACCOUNTS)
  registry.selectedAccount = account.login
  await writeRegistry(registry)
}

export async function removeAccount(login: string): Promise<void> {
  const registry = await readRegistry()
  registry.accounts = registry.accounts.filter((a) => a.login !== login)
  if (registry.selectedAccount === login) registry.selectedAccount = null
  await writeRegistry(registry)
}

export async function setSelectedAccount(login: string | null): Promise<void> {
  const registry = await readRegistry()
  registry.selectedAccount = login
  await writeRegistry(registry)
}
