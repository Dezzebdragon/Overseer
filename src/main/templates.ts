import { promises as fs } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import type { TemplateFile, TemplateInfo } from '@shared/types'
import { GENERATED_FILES, isGeneratedFile, normalizeRelPath } from './builtinDocs'
import {
  assertInsideTemplates,
  getShippedTemplatesDir,
  getTemplatesDir,
  validateTemplateName
} from './paths'
import {
  copyTemplateToggles,
  deleteTemplateToggles,
  pruneTemplateToggles,
  readRegistry,
  setTemplateFileRequired
} from './registry'

export const DEFAULT_TEMPLATE = 'default'

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

function assertMutable(templateName: string): void {
  if (templateName === DEFAULT_TEMPLATE) {
    throw new Error('The default template is built in and cannot be modified.')
  }
}

function assertNotGenerated(relPath: string): void {
  if (isGeneratedFile(relPath)) {
    throw new Error(`${normalizeRelPath(relPath)} is generated per project and cannot live in a template.`)
  }
}

async function copyMissing(source: string, destination: string): Promise<void> {
  const stat = await fs.stat(source)
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: true })
    for (const entry of await fs.readdir(source)) {
      await copyMissing(join(source, entry), join(destination, entry))
    }
    return
  }
  if (isGeneratedFile(basename(source))) return
  if (!(await exists(destination))) {
    await fs.mkdir(dirname(destination), { recursive: true })
    await fs.copyFile(source, destination)
  }
}

/** Seed userData/templates/default from the shipped copy on first run. */
export async function ensureDefaultTemplate(): Promise<void> {
  const destination = join(getTemplatesDir(), DEFAULT_TEMPLATE)
  await fs.mkdir(getTemplatesDir(), { recursive: true })
  if (await exists(destination)) {
    for (const generated of GENERATED_FILES) {
      await fs.rm(join(destination, generated), { force: true }).catch(() => undefined)
    }
    return
  }
  const source = join(getShippedTemplatesDir(), DEFAULT_TEMPLATE)
  if (!(await exists(source))) {
    throw new Error(`Shipped default template is missing at ${source}`)
  }
  await copyMissing(source, destination)
}

/** Recursively list a template's files (posix rel paths), excluding generated. */
export async function listTemplateFiles(root: string, current = root): Promise<string[]> {
  const output: string[] = []
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name)
    if (entry.isDirectory()) {
      output.push(...(await listTemplateFiles(root, absolute)))
    } else if (entry.isFile()) {
      const rel = relative(root, absolute).split(sep).join('/')
      if (!isGeneratedFile(rel)) output.push(rel)
    }
  }
  return output.sort((a, b) => a.localeCompare(b))
}

async function withSizes(root: string, relPaths: string[]): Promise<TemplateFile[]> {
  const files: TemplateFile[] = []
  for (const relPath of relPaths) {
    let sizeBytes = 0
    try {
      sizeBytes = (await fs.stat(join(root, ...relPath.split('/')))).size
    } catch {
      sizeBytes = 0
    }
    files.push({ relPath, sizeBytes })
  }
  return files
}

function disabledFor(
  registryToggles: Record<string, boolean>,
  relPaths: string[]
): string[] {
  return Object.entries(registryToggles)
    .filter(([relPath, required]) => required === false && relPaths.includes(relPath))
    .map(([relPath]) => relPath)
    .sort((a, b) => a.localeCompare(b))
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  await ensureDefaultTemplate()
  const entries = await fs.readdir(getTemplatesDir(), { withFileTypes: true })
  const fileMap = new Map<string, string[]>()
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    fileMap.set(entry.name, await listTemplateFiles(join(getTemplatesDir(), entry.name)))
  }

  await pruneTemplateToggles(fileMap)
  const registry = await readRegistry()

  const templates: TemplateInfo[] = []
  for (const [name, relPaths] of fileMap) {
    const toggles = registry.templateFileToggles[name] ?? {}
    templates.push({
      name,
      files: await withSizes(join(getTemplatesDir(), name), relPaths),
      isDefault: name === DEFAULT_TEMPLATE,
      disabled: disabledFor(toggles, relPaths)
    })
  }
  return templates.sort((a, b) =>
    a.isDefault ? -1 : b.isDefault ? 1 : a.name.localeCompare(b.name)
  )
}

async function buildTemplate(name: string, cloneFrom: string): Promise<TemplateInfo> {
  const safeName = validateTemplateName(name)
  if (safeName === DEFAULT_TEMPLATE) {
    throw new Error('"default" is reserved for the built-in template.')
  }
  const destination = assertInsideTemplates(safeName)
  if (await exists(destination)) {
    throw new Error(`Template "${safeName}" already exists.`)
  }
  const source = assertInsideTemplates(validateTemplateName(cloneFrom))
  if (!(await exists(source))) {
    throw new Error(`Template "${cloneFrom}" does not exist.`)
  }
  await fs.mkdir(destination, { recursive: true })
  await copyMissing(source, destination)
  const relPaths = await listTemplateFiles(destination)
  return {
    name: safeName,
    files: await withSizes(destination, relPaths),
    isDefault: false,
    disabled: []
  }
}

export async function createTemplate(name: string): Promise<TemplateInfo> {
  await ensureDefaultTemplate()
  return buildTemplate(name, DEFAULT_TEMPLATE)
}

export async function duplicateTemplate(sourceName: string, newName: string): Promise<TemplateInfo> {
  await ensureDefaultTemplate()
  const created = await buildTemplate(newName, sourceName)
  await copyTemplateToggles(validateTemplateName(sourceName), created.name)
  const registry = await readRegistry()
  created.disabled = disabledFor(
    registry.templateFileToggles[created.name] ?? {},
    created.files.map((f) => f.relPath)
  )
  return created
}

export async function deleteTemplate(name: string): Promise<void> {
  const safeName = validateTemplateName(name)
  assertMutable(safeName)
  const target = assertInsideTemplates(safeName)
  await fs.rm(target, { recursive: true, force: false })
  await deleteTemplateToggles(safeName)
}

export async function readTemplateFile(name: string, relPath: string): Promise<string> {
  return fs.readFile(assertInsideTemplates(name, relPath), 'utf8')
}

export async function writeTemplateFile(
  name: string,
  relPath: string,
  content: string,
  createOnly = false
): Promise<void> {
  assertMutable(validateTemplateName(name))
  assertNotGenerated(relPath)
  const target = assertInsideTemplates(name, relPath)
  if (createOnly && (await exists(target))) {
    throw new Error('Template file already exists.')
  }
  await fs.mkdir(dirname(target), { recursive: true })
  await fs.writeFile(target, content, 'utf8')
}

export async function deleteTemplateFile(name: string, relPath: string): Promise<void> {
  assertMutable(validateTemplateName(name))
  const target = assertInsideTemplates(name, relPath)
  const stat = await fs.stat(target)
  if (!stat.isFile()) throw new Error('Only template files can be deleted.')
  await fs.unlink(target)
}

/** Toggle a file's scaffold inclusion and return the refreshed listing. */
export async function setFileRequired(
  name: string,
  relPath: string,
  required: boolean
): Promise<TemplateInfo[]> {
  validateTemplateName(name)
  await setTemplateFileRequired(name, relPath, required)
  return listTemplates()
}
