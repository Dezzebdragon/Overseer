import { app } from 'electron'
import { resolve, join, relative, isAbsolute, sep } from 'node:path'

export function getAppDataDir(): string {
  return app.getPath('userData')
}

export function getRegistryPath(): string {
  return join(getAppDataDir(), 'registry.json')
}

/** Editable templates live here. */
export function getTemplatesDir(): string {
  return join(getAppDataDir(), 'templates')
}

/** Read-only templates that ship with the app (seed for the default). */
export function getShippedTemplatesDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'templates')
  }
  // Dev: out/main/index.js -> project root -> templates
  return resolve(__dirname, '../../templates')
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

export function validateTemplateName(name: string): string {
  const trimmed = name.trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(trimmed)) {
    throw new Error(
      'Template names may contain letters, numbers, dots, underscores, and hyphens.'
    )
  }
  return trimmed
}

/** Resolve a path inside a template, rejecting traversal and absolute paths. */
export function assertInsideTemplates(templateName: string, requestedPath = '.'): string {
  const safeName = validateTemplateName(templateName)
  if (
    isAbsolute(requestedPath) ||
    requestedPath.split(/[\\/]+/).some((segment) => segment === '..')
  ) {
    throw new Error('Template file path must stay inside the template.')
  }
  const templatesRoot = resolve(getTemplatesDir())
  const candidate = resolve(templatesRoot, safeName, requestedPath)
  if (!isInside(templatesRoot, candidate)) {
    throw new Error('Template path escapes the templates directory.')
  }
  return candidate
}
