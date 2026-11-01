import type { BuiltinDoc } from '@shared/types'

/**
 * Single source of truth for the documents that ship with the default template.
 * Ids are stable and must never be reused. Every consumer (scaffolding, the Hub
 * required-docs UI, the missing-file checklist) reads this array.
 */
export const BUILTIN_DOCS: readonly BuiltinDoc[] = [
  { id: 'hub', relPath: 'Hub.md', label: 'Project hub' },
  { id: 'readme', relPath: 'README.md', label: 'Readme' },
  { id: 'architecture', relPath: 'Documentation/architecture.md', label: 'Architecture' }
]

/** Generated per project at scaffold time. Never part of a template. */
export const GENERATED_FILES: readonly string[] = ['big-mcp.config.json', 'big-state.json']

export function normalizeRelPath(relPath: string): string {
  return relPath.split(/[\\/]+/).filter(Boolean).join('/')
}

export function isGeneratedFile(relPath: string): boolean {
  return GENERATED_FILES.includes(normalizeRelPath(relPath))
}

export function findBuiltinDocById(id: string): BuiltinDoc | null {
  return BUILTIN_DOCS.find((doc) => doc.id === id) ?? null
}

export function findBuiltinDocByPath(relPath: string): BuiltinDoc | null {
  const normalized = normalizeRelPath(relPath)
  return BUILTIN_DOCS.find((doc) => doc.relPath === normalized) ?? null
}

export function builtinDocs(): BuiltinDoc[] {
  return BUILTIN_DOCS.map((doc) => ({ ...doc }))
}
