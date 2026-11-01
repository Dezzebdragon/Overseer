import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type {
  DirEntry,
  Eol,
  FileReadResult,
  WriteArgs,
  WriteResult
} from '@shared/types'

const MAX_FILE_BYTES = 50 * 1024 * 1024 // 50 MB guard

function detectEol(text: string): Eol {
  const firstLf = text.indexOf('\n')
  if (firstLf > 0 && text[firstLf - 1] === '\r') return 'crlf'
  return 'lf'
}

/** Cheap binary sniff: a NUL byte in the first chunk means "not a text file". */
function looksBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000)
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true
  return false
}

export async function readDir(path: string): Promise<DirEntry[]> {
  const dirents = await fs.readdir(path, { withFileTypes: true })
  const entries: DirEntry[] = dirents
    .filter((d) => d.isDirectory() || d.isFile())
    .map((d) => ({
      path: join(path, d.name),
      name: d.name,
      isDir: d.isDirectory()
    }))
  // Folders first, then files, each alphabetical (VS Code default).
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return entries
}

export async function readFile(path: string): Promise<FileReadResult> {
  const stat = await fs.stat(path)
  if (stat.size > MAX_FILE_BYTES) {
    return {
      path,
      content: '',
      eol: 'lf',
      encoding: 'utf-8',
      mtimeMs: stat.mtimeMs,
      refused: 'too-large'
    }
  }
  const buf = await fs.readFile(path)
  if (looksBinary(buf)) {
    return {
      path,
      content: '',
      eol: 'lf',
      encoding: 'utf-8',
      mtimeMs: stat.mtimeMs,
      refused: 'binary'
    }
  }
  // Strip a UTF-8 BOM if present; Monaco does not want it in the buffer.
  let content = buf.toString('utf-8')
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1)
  return {
    path,
    content,
    eol: detectEol(content),
    encoding: 'utf-8',
    mtimeMs: stat.mtimeMs
  }
}

export async function writeFile(args: WriteArgs): Promise<WriteResult> {
  const normalized =
    args.eol === 'crlf'
      ? args.content.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
      : args.content.replace(/\r\n/g, '\n')
  // Atomic write: temp file in the same directory, then rename.
  const tmp = `${args.path}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmp, normalized, 'utf-8')
  await fs.rename(tmp, args.path)
  const stat = await fs.stat(args.path)
  return { path: args.path, mtimeMs: stat.mtimeMs }
}

export async function createEntry(path: string, isDir: boolean): Promise<void> {
  if (isDir) {
    await fs.mkdir(path, { recursive: false })
  } else {
    // Fail if it already exists (wx), so we never clobber a file.
    const handle = await fs.open(path, 'wx')
    await handle.close()
  }
}

export async function renameEntry(from: string, to: string): Promise<void> {
  await fs.rename(from, to)
}

export async function deleteEntry(path: string): Promise<void> {
  await fs.rm(path, { recursive: true, force: true })
}

export function folderName(path: string): string {
  return basename(path) || path
}
