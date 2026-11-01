import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import type { ProjectStatus } from '@shared/types'
import { loadSettings } from './workspace-state'
import { getDisabledTemplateFiles, getSelectedTemplate } from './registry'
import { getTemplatesDir } from './paths'
import { listTemplateFiles } from './templates'
import { BUILTIN_DOCS } from './builtinDocs'
import {
  CONFIG_FILE,
  STATE_FILE,
  configPath,
  defaultConfig,
  nameFor,
  defaultState,
  fileExists,
  pathExists,
  readConfig,
  statePath,
  writeConfig,
  writeState
} from './projectFiles'

const exec = promisify(execFile)

export async function enabledTemplateFiles(templateName: string): Promise<string[]> {
  const dir = join(getTemplatesDir(), templateName)
  if (!(await pathExists(dir))) return []
  const all = await listTemplateFiles(dir)
  const disabled = new Set(await getDisabledTemplateFiles(templateName))
  return all.filter((f) => !disabled.has(f))
}

/** Non-destructive, idempotent: copies enabled files, generates config/state, git init. */
export async function scaffoldProject(root: string): Promise<ProjectStatus> {
  const settings = await loadSettings()
  const templateName = await getSelectedTemplate()
  const templateDir = join(getTemplatesDir(), templateName)
  const enabled = await enabledTemplateFiles(templateName)

  for (const rel of enabled) {
    const dest = join(root, ...rel.split('/'))
    if (await pathExists(dest)) continue // never overwrite
    await fs.mkdir(dirname(dest), { recursive: true })
    await fs.copyFile(join(templateDir, ...rel.split('/')), dest)
  }

  if (settings.generateState !== false && !(await pathExists(statePath(root)))) {
    await writeState(root, defaultState())
  }

  if (settings.generateConfig !== false && !(await pathExists(configPath(root)))) {
    const paths: Record<string, string> = {}
    const scaffoldedNames: string[] = []
    for (const rel of enabled) {
      const name = nameFor(rel)
      paths[name] = rel
      if (!scaffoldedNames.includes(name)) scaffoldedNames.push(name)
    }
    const requiredNames: string[] = []
    for (const doc of BUILTIN_DOCS) {
      const name = nameFor(doc.relPath)
      paths[name] = doc.relPath
      if (!requiredNames.includes(name)) requiredNames.push(name)
    }
    await writeConfig(
      root,
      defaultConfig(root, templateName, paths, requiredNames, scaffoldedNames)
    )
  }

  if (settings.initGitOnScaffold !== false && !(await pathExists(join(root, '.git')))) {
    try {
      await exec('git', ['init'], { cwd: root })
    } catch {
      /* git not installed / not on PATH — scaffolding still succeeds */
    }
  }

  return projectStatus(root)
}

/** A project is initialized when all required files are present. */
export async function projectStatus(root: string): Promise<ProjectStatus> {
  const settings = await loadSettings()
  const config = await readConfig(root)
  const projectTemplate = config?.template ?? (await getSelectedTemplate())

  const required: string[] = []
  if (settings.generateConfig !== false) required.push(CONFIG_FILE)
  if (settings.generateState !== false) required.push(STATE_FILE)

  if (settings.requireAllFiles !== false) {
    const mode = settings.hubRequirement ?? 'project'
    const set = new Set<string>()
    if (mode === 'default' || mode === 'default+project') {
      for (const f of await enabledTemplateFiles('default')) set.add(f)
    }
    if (mode === 'project' || mode === 'default+project') {
      for (const f of await enabledTemplateFiles(projectTemplate)) set.add(f)
    }
    for (const f of set) required.push(f)
  }

  const missing: string[] = []
  for (const rel of required) {
    if (!(await fileExists(root, rel))) missing.push(rel)
  }

  const hasConfig = await pathExists(configPath(root))
  const initialized = required.length > 0 && missing.length === 0
  const damaged = hasConfig && missing.length > 0
  return { initialized, damaged, required, missing }
}

export async function projectStatuses(
  roots: string[]
): Promise<Record<string, ProjectStatus>> {
  const out: Record<string, ProjectStatus> = {}
  for (const root of roots) {
    try {
      out[root] = await projectStatus(root)
    } catch {
      out[root] = { initialized: false, damaged: false, required: [], missing: [] }
    }
  }
  return out
}
