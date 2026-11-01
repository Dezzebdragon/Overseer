import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { ApplyRepairResult, ProjectConfig, RepairFile, RepairInfo } from '@shared/types'
import { BUILTIN_DOCS } from './builtinDocs'
import { getSelectedTemplate } from './registry'
import { getTemplatesDir } from './paths'
import { enabledTemplateFiles } from './projects'
import {
  CONFIG_FILE,
  SCHEMA_VERSION,
  STATE_FILE,
  defaultConfig,
  defaultState,
  fileExists,
  nameFor,
  pathExists,
  readConfig,
  writeConfig,
  writeState
} from './projectFiles'

const isGenerated = (rel: string): boolean => rel === CONFIG_FILE || rel === STATE_FILE

/** Rebuild big-mcp.config.json from the current template + builtin docs. */
async function regenerateConfig(root: string): Promise<ProjectConfig> {
  const template = await getSelectedTemplate()
  const enabled = await enabledTemplateFiles(template)
  const paths: Record<string, string> = {}
  const scaffolded: string[] = []
  for (const rel of enabled) {
    const n = nameFor(rel)
    paths[n] = rel
    if (!scaffolded.includes(n)) scaffolded.push(n)
  }
  const required: string[] = []
  for (const doc of BUILTIN_DOCS) {
    const n = nameFor(doc.relPath)
    paths[n] = doc.relPath
    if (!required.includes(n)) required.push(n)
  }
  const config = defaultConfig(root, template, paths, required, scaffolded)
  await writeConfig(root, config)
  return config
}

async function ensureConfig(root: string): Promise<ProjectConfig> {
  return (await readConfig(root)) ?? (await regenerateConfig(root))
}

/** The coordination files for the repair dock (source of truth = requiredDocs). */
export async function hubRepairInfo(root: string): Promise<RepairInfo> {
  const config = await readConfig(root)
  const template = config?.template ?? (await getSelectedTemplate())
  const paths: Record<string, string> = { ...(config?.paths ?? {}) }
  const requiredSet = new Set(config?.requiredDocs ?? [])

  const builtinNames = new Set<string>()
  for (const doc of BUILTIN_DOCS) {
    const n = nameFor(doc.relPath)
    builtinNames.add(n)
    if (!paths[n]) paths[n] = doc.relPath
  }
  // generated coordination files are always required (regenerated if missing)
  paths[CONFIG_FILE] = CONFIG_FILE
  paths[STATE_FILE] = STATE_FILE

  const names = new Set<string>([
    ...builtinNames,
    ...requiredSet,
    CONFIG_FILE,
    STATE_FILE
  ])

  const files: RepairFile[] = []
  for (const name of names) {
    const rel = paths[name] ?? name
    const generated = isGenerated(rel)
    files.push({
      name,
      path: rel,
      generated,
      builtin: builtinNames.has(name) && !generated,
      required: generated ? true : requiredSet.has(name),
      present: await fileExists(root, rel)
    })
  }
  files.sort((a, b) =>
    a.generated === b.generated ? a.name.localeCompare(b.name) : a.generated ? 1 : -1
  )
  return { template, files }
}

/** Persist the checked names as requiredDocs (generated files can't be toggled off). */
export async function hubSetRequiredDocs(root: string, names: string[]): Promise<RepairInfo> {
  const config = await ensureConfig(root)
  const paths = { ...config.paths }
  for (const doc of BUILTIN_DOCS) {
    const n = nameFor(doc.relPath)
    if (!paths[n]) paths[n] = doc.relPath
  }
  const clean = names.filter((n) => n !== CONFIG_FILE && n !== STATE_FILE)
  await writeConfig(root, {
    ...config,
    schemaVersion: SCHEMA_VERSION,
    paths,
    requiredDocs: Array.from(new Set(clean))
  })
  return hubRepairInfo(root)
}

/** Copy an external file into the project and mark it required. */
export async function hubAddRequiredFile(root: string, sourceAbs: string): Promise<RepairInfo> {
  const config = await ensureConfig(root)
  const paths = { ...config.paths }
  let name = basename(sourceAbs)
  let rel = name
  if (paths[name] && paths[name] !== rel) {
    let i = 1
    while (paths[`${i}-${name}`]) i++
    name = `${i}-${name}`
    rel = name
  }
  const dest = join(root, rel)
  if (!(await pathExists(dest))) {
    await fs.mkdir(dirname(dest), { recursive: true })
    await fs.copyFile(sourceAbs, dest)
  }
  paths[name] = rel
  const requiredDocs = config.requiredDocs.includes(name)
    ? config.requiredDocs
    : [...config.requiredDocs, name]
  await writeConfig(root, { ...config, schemaVersion: SCHEMA_VERSION, paths, requiredDocs })
  return hubRepairInfo(root)
}

/** Re-add selected files from the current template; regenerate config/state. */
export async function hubApplyRepair(root: string, names: string[]): Promise<ApplyRepairResult> {
  const template = (await readConfig(root))?.template ?? (await getSelectedTemplate())
  const info = await hubRepairInfo(root)
  const byName = new Map(info.files.map((f) => [f.name, f]))
  const templateRel = new Set(await enabledTemplateFiles(template))
  const templateDir = join(getTemplatesDir(), template)

  const gen: RepairFile[] = []
  const tmpl: RepairFile[] = []
  const missingFromTemplate: string[] = []
  for (const n of names) {
    const f = byName.get(n)
    if (!f) continue
    if (f.generated) gen.push(f)
    else if (templateRel.has(f.path)) tmpl.push(f)
    else missingFromTemplate.push(n)
  }

  if (missingFromTemplate.length > 0) {
    return { ok: false, applied: [], regenerated: [], missingFromTemplate, template }
  }

  const regenerated: string[] = []
  for (const f of gen) {
    if (f.path === STATE_FILE) {
      if (!(await pathExists(join(root, STATE_FILE)))) await writeState(root, defaultState())
      regenerated.push(f.name)
    } else if (f.path === CONFIG_FILE) {
      if (!(await pathExists(join(root, CONFIG_FILE)))) await regenerateConfig(root)
      regenerated.push(f.name)
    }
  }

  const applied: string[] = []
  for (const f of tmpl) {
    const dest = join(root, ...f.path.split('/'))
    if (!(await pathExists(dest))) {
      await fs.mkdir(dirname(dest), { recursive: true })
      await fs.copyFile(join(templateDir, ...f.path.split('/')), dest)
    }
    applied.push(f.name)
  }
  return { ok: true, applied, regenerated, missingFromTemplate: [], template }
}
