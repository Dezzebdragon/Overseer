import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { HubFile } from '@shared/types'
import { getSelectedTemplate } from './registry'
import { enabledTemplateFiles } from './projects'
import { CONFIG_FILE, STATE_FILE, fileExists, readConfig } from './projectFiles'

/** Files the Hub manages: the project's templated docs plus config/state. */
export async function hubFiles(root: string): Promise<HubFile[]> {
  const config = await readConfig(root)
  const templateName = config?.template ?? (await getSelectedTemplate())
  const templateFiles = await enabledTemplateFiles(templateName)
  const managed = Array.from(new Set([...templateFiles, CONFIG_FILE, STATE_FILE]))

  const out: HubFile[] = []
  for (const rel of managed) {
    if (!(await fileExists(root, rel))) continue // present files only (v1)
    const absPath = join(root, ...rel.split('/'))
    let sizeBytes = 0
    try {
      sizeBytes = (await fs.stat(absPath)).size
    } catch {
      /* ignore */
    }
    out.push({ relPath: rel, absPath, sizeBytes })
  }
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath))
}
