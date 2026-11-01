import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { ProjectStats } from '@shared/types'

const IGNORE = new Set(['node_modules', '.git', '.hg', '.svn'])
const MAX_ENTRIES = 200_000 // safety cap against runaway trees / symlink loops

/** Walk a project once, summing file sizes and counting files. */
export async function computeProjectStats(root: string): Promise<ProjectStats> {
  let sizeBytes = 0
  let fileCount = 0
  let entries = 0
  let capped = false

  const walk = async (dir: string): Promise<void> => {
    if (capped) return
    let dirents
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const d of dirents) {
      if (entries++ > MAX_ENTRIES) {
        capped = true
        return
      }
      if (d.isDirectory()) {
        if (IGNORE.has(d.name)) continue
        await walk(join(dir, d.name))
      } else if (d.isFile()) {
        try {
          sizeBytes += (await fs.stat(join(dir, d.name))).size
          fileCount++
        } catch {
          /* unreadable file */
        }
      }
    }
  }

  await walk(root)
  return { sizeBytes, fileCount }
}
