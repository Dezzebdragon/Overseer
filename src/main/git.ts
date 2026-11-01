import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CommitFileChange,
  GitActionResult,
  GitBranches,
  GitCommit,
  GitCommitMetrics,
  GitConflictVersions,
  GitFileCommit,
  GitGraphData,
  GitMergeResult,
  GitMergeState,
  GitRef
} from '@shared/types'

const exec = promisify(execFile)
const SEP = '\x1f'
const REC = '\x1e'
const MAX_COMMITS = 800 // cap for performance on huge repos

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024
  })
  return stdout
}

async function isRepo(root: string): Promise<boolean> {
  try {
    const out = await git(root, ['rev-parse', '--is-inside-work-tree'])
    return out.trim() === 'true'
  } catch {
    return false
  }
}

async function readRefs(root: string): Promise<Map<string, GitRef[]>> {
  const bySha = new Map<string, GitRef[]>()
  let headBranch = ''
  try {
    headBranch = (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim()
  } catch {
    /* detached HEAD */
  }
  let out = ''
  try {
    out = await git(root, [
      'for-each-ref',
      `--format=%(refname)${SEP}%(objectname)`
    ])
  } catch {
    return bySha
  }
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [refname, sha] = line.split(SEP)
    let kind: GitRef['kind']
    let name: string
    if (refname.startsWith('refs/heads/')) {
      kind = 'head'
      name = refname.slice('refs/heads/'.length)
    } else if (refname.startsWith('refs/remotes/')) {
      kind = 'remote'
      name = refname.slice('refs/remotes/'.length)
    } else if (refname.startsWith('refs/tags/')) {
      kind = 'tag'
      name = refname.slice('refs/tags/'.length)
    } else {
      continue
    }
    const list = bySha.get(sha) ?? []
    list.push({ name, kind, sha, isHead: kind === 'head' && name === headBranch })
    bySha.set(sha, list)
  }
  return bySha
}

interface RawCommit {
  sha: string
  parents: string[]
  author: string
  email: string
  dateIso: string
  subject: string
  body: string
}

function parseLog(stdout: string): RawCommit[] {
  const out: RawCommit[] = []
  for (const rec of stdout.split(REC)) {
    const trimmed = rec.replace(/^\n/, '')
    if (!trimmed.trim()) continue
    const [sha, parents, author, email, dateIso, subject = ''] = trimmed.split(SEP)
    out.push({
      sha,
      parents: parents.trim() ? parents.trim().split(' ') : [],
      author,
      email,
      dateIso,
      subject,
      body: ''
    })
  }
  return out
}

/** Assign each commit a lane; reuse freed lanes to keep the graph narrow. */
function assignLanes(raw: RawCommit[]): number[] {
  const lanes: (string | null)[] = [] // lanes[i] = sha the lane currently awaits
  const result: number[] = new Array(raw.length)

  const firstFree = (): number => {
    const i = lanes.indexOf(null)
    return i === -1 ? lanes.length : i
  }

  raw.forEach((c, idx) => {
    let lane = lanes.indexOf(c.sha)
    if (lane === -1) {
      lane = firstFree()
      lanes[lane] = c.sha
    }
    result[idx] = lane

    // Other lanes awaiting this same commit collapse into this one.
    for (let j = 0; j < lanes.length; j++) {
      if (j !== lane && lanes[j] === c.sha) lanes[j] = null
    }

    // First parent continues this lane; extra parents take (free) lanes.
    if (c.parents.length === 0) {
      lanes[lane] = null
    } else {
      lanes[lane] = c.parents[0]
      for (let k = 1; k < c.parents.length; k++) {
        const p = c.parents[k]
        if (lanes.indexOf(p) === -1) lanes[firstFree()] = p
      }
    }
  })
  return result
}

function buildGraph(
  raw: RawCommit[],
  refsBySha: Map<string, GitRef[]>,
  headSha: string | null
): GitGraphData {
  const laneOf = assignLanes(raw)

  // child counts → branch points (a commit that is a parent of >1 commits).
  const childCount = new Map<string, number>()
  for (const c of raw) {
    for (const p of c.parents) childCount.set(p, (childCount.get(p) ?? 0) + 1)
  }

  const commits: GitCommit[] = raw.map((c, idx) => ({
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    parents: c.parents,
    author: c.author,
    email: c.email,
    dateIso: c.dateIso,
    subject: c.subject,
    body: c.body,
    refs: refsBySha.get(c.sha) ?? [],
    lane: laneOf[idx],
    isMerge: c.parents.length > 1,
    isBranchPoint: (childCount.get(c.sha) ?? 0) > 1
  }))

  const allRefs: GitRef[] = []
  for (const list of refsBySha.values()) allRefs.push(...list)

  return {
    isRepo: true,
    headSha,
    commits,
    laneCount: Math.max(1, ...laneOf.map((l) => l + 1)),
    refs: allRefs
  }
}

const graphCache = new Map<string, { fp: string; data: GitGraphData }>()

/** Cheap fingerprint of all refs + HEAD; changes exactly when the graph would. */
async function refsFingerprint(root: string): Promise<string> {
  const [refs, head] = await Promise.all([
    git(root, ['for-each-ref', '--format=%(objectname) %(refname)']).catch(() => ''),
    git(root, ['rev-parse', 'HEAD']).catch(() => '')
  ])
  return `${refs}|${head}`
}

export async function gitGraph(root: string): Promise<GitGraphData> {
  if (!(await isRepo(root))) {
    graphCache.delete(root)
    return { isRepo: false, headSha: null, commits: [], laneCount: 0, refs: [] }
  }
  // Skip the expensive log+parse when nothing changed since last time.
  const fp = await refsFingerprint(root)
  const cached = graphCache.get(root)
  if (cached && cached.fp === fp) return cached.data

  const fmt = ['%H', '%P', '%an', '%ae', '%aI', '%s'].join(SEP) + REC
  let stdout = ''
  try {
    stdout = await git(root, [
      'log',
      '--all',
      '--topo-order',
      `--max-count=${MAX_COMMITS}`,
      `--pretty=format:${fmt}`
    ])
  } catch {
    return { isRepo: true, headSha: null, commits: [], laneCount: 0, refs: [] }
  }
  const raw = parseLog(stdout)
  const refsBySha = await readRefs(root)
  let headSha: string | null = null
  try {
    headSha = (await git(root, ['rev-parse', 'HEAD'])).trim()
  } catch {
    /* empty repo */
  }
  const data = buildGraph(raw, refsBySha, headSha)
  graphCache.set(root, { fp, data })
  return data
}

/** Lane-based ahead/behind/in-branch for the requested commits. */
export async function gitCommitMetrics(
  root: string,
  shas: string[]
): Promise<Record<string, GitCommitMetrics>> {
  const graph = await gitGraph(root)
  const out: Record<string, GitCommitMetrics> = {}
  if (!graph.isRepo) return out

  // commits are newest-first; group indices by lane.
  const wanted = new Set(shas)
  const laneList = new Map<number, string[]>()
  for (const c of graph.commits) {
    const arr = laneList.get(c.lane) ?? []
    arr.push(c.sha)
    laneList.set(c.lane, arr)
  }
  const laneOfSha = new Map<string, number>()
  for (const c of graph.commits) laneOfSha.set(c.sha, c.lane)

  for (const sha of wanted) {
    const lane = laneOfSha.get(sha)
    if (lane === undefined) {
      out[sha] = { inBranch: 0, ahead: 0, behind: 0 }
      continue
    }
    const arr = laneList.get(lane) ?? []
    const idx = arr.indexOf(sha) // newest-first, so idx = commits ahead
    out[sha] = {
      inBranch: arr.length,
      ahead: idx < 0 ? 0 : idx,
      behind: idx < 0 ? 0 : arr.length - 1 - idx
    }
  }
  return out
}

// ---- versioned file system (read-only) -------------------------------

function assertRelSafe(rel: string): void {
  if (rel.split(/[\\/]/).some((s) => s === '..')) {
    throw new Error('Unsafe path.')
  }
}

/** File contents at a commit: `git show <hash>:<relPath>`. */
export async function fileAtCommit(root: string, relPath: string, hash: string): Promise<string> {
  assertRelSafe(relPath)
  if (!/^[0-9a-fA-F]{4,40}$/.test(hash)) throw new Error('Invalid commit hash.')
  const posix = relPath.split('\\').join('/')
  try {
    return await git(root, ['show', `${hash}:${posix}`])
  } catch (e) {
    const msg = (e as Error).message
    if (/exists on disk, but not in|does not exist in|bad revision|fatal: path/i.test(msg)) {
      throw new Error('This file did not exist in the selected commit.')
    }
    throw e
  }
}

/** Commits that changed a file (newest-first), with per-commit line stats. */
export async function fileHistory(
  root: string,
  relPath: string,
  limit = 100
): Promise<GitFileCommit[]> {
  assertRelSafe(relPath)
  const posix = relPath.split('\\').join('/')
  const header = REC + ['%H', '%an', '%aI', '%s'].join(SEP)
  let out = ''
  try {
    out = await git(root, [
      'log',
      '--follow',
      '--numstat',
      `--max-count=${limit}`,
      `--pretty=format:${header}`,
      '--',
      posix
    ])
  } catch {
    return []
  }
  const commits: GitFileCommit[] = []
  for (const rec of out.split(REC)) {
    if (!rec.trim()) continue
    const lines = rec.split('\n')
    const [sha, author, dateIso, subject = ''] = lines[0].split(SEP)
    let additions = 0
    let deletions = 0
    for (const l of lines.slice(1)) {
      if (!l.includes('\t')) continue
      const [a, d] = l.split('\t')
      additions += Number.parseInt(a, 10) || 0
      deletions += Number.parseInt(d, 10) || 0
    }
    commits.push({ sha, shortSha: sha.slice(0, 7), author, dateIso, subject, additions, deletions })
  }
  return commits
}

/** All file paths present in the tree at a commit (`git ls-tree -r`). */
export async function treeAtCommit(root: string, hash: string): Promise<string[]> {
  if (!/^[0-9a-fA-F]{4,40}$/.test(hash)) throw new Error('Invalid commit hash.')
  let raw = ''
  try {
    raw = await git(root, ['ls-tree', '-r', '--name-only', hash])
  } catch {
    return []
  }
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/** Files changed in a commit (name-status, rename-aware). */
export async function commitFiles(root: string, hash: string): Promise<CommitFileChange[]> {
  if (!/^[0-9a-fA-F]{4,40}$/.test(hash)) throw new Error('Invalid commit hash.')
  let raw = ''
  try {
    raw = await git(root, ['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', '--root', hash])
  } catch {
    return []
  }
  const changes: CommitFileChange[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const parts = t.split('\t')
    const status = (parts[0] ?? '').charAt(0)
    if (status === 'R' || status === 'C') {
      changes.push({ status, path: parts[2] ?? parts[1] ?? '', oldPath: parts[1] })
    } else {
      changes.push({ status, path: parts[1] ?? '' })
    }
  }
  return changes.filter((c) => c.path)
}

/** Paths that exist in history but not on disk (deleted files). */
export async function deletedPaths(root: string): Promise<string[]> {
  let raw = ''
  try {
    raw = await git(root, ['log', '--all', '--pretty=format:', '--name-only', '--max-count=2000'])
  } catch {
    return []
  }
  const historical = new Set(
    raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.split('\\').join('/'))
  )
  const out: string[] = []
  for (const rel of historical) {
    if (rel.split('/').some((s) => s === '..')) continue
    const exists = await access(join(root, rel)).then(() => true).catch(() => false)
    if (!exists) out.push(rel)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

/** The newest commit that added/modified a (now-deleted) file, so it can be viewed. */
export async function lastFileCommit(root: string, relPath: string): Promise<string | null> {
  assertRelSafe(relPath)
  const posix = relPath.split('\\').join('/')
  try {
    const out = await git(root, [
      'log',
      '--all',
      '--max-count=1',
      '--format=%H',
      '--diff-filter=AMR',
      '--',
      posix
    ])
    return out.trim() || null
  } catch {
    return null
  }
}

// ---- write actions (Git view is read-write) --------------------------

function errText(e: unknown): string {
  const anyE = e as { stderr?: string; message?: string }
  return (anyE.stderr || anyE.message || 'git command failed').toString().trim()
}

/** Full commit body for one sha (fetched lazily; graph query omits bodies). */
export async function commitBody(root: string, sha: string): Promise<string> {
  if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) return ''
  try {
    return (await git(root, ['show', '-s', '--format=%b', sha])).replace(/\n+$/, '')
  } catch {
    return ''
  }
}

export async function gitCommit(
  root: string,
  message: string,
  stageAll: boolean
): Promise<GitActionResult> {
  try {
    if (stageAll) await git(root, ['add', '-A'])
    await git(root, ['commit', '-m', message])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

export async function gitCreateBranch(
  root: string,
  name: string,
  base: string,
  checkout: boolean
): Promise<GitActionResult> {
  try {
    await git(root, ['branch', name, base || 'HEAD'])
    if (checkout) await git(root, ['checkout', name])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

export async function gitCheckout(root: string, target: string): Promise<GitActionResult> {
  try {
    await git(root, ['checkout', target])
    // Detached HEAD when the target wasn't a branch name.
    const current = await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')
    return { ok: true, detached: !current.trim() }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

export async function gitMerge(
  root: string,
  branch: string,
  noFf: boolean
): Promise<GitMergeResult> {
  try {
    await git(root, ['merge', ...(noFf ? ['--no-ff'] : []), branch])
    return { ok: true }
  } catch (e) {
    const conflicts = await unmergedPaths(root)
    if (conflicts.length > 0) return { ok: false, conflicts }
    return { ok: false, error: errText(e) }
  }
}

export async function gitBranches(root: string): Promise<GitBranches> {
  let branches: string[] = []
  try {
    const out = await git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
    branches = out.split('\n').map((l) => l.trim()).filter(Boolean)
  } catch {
    /* ignore */
  }
  const current = (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim()
  return { branches, current, detached: !current }
}

async function unmergedPaths(root: string): Promise<string[]> {
  try {
    const out = await git(root, ['diff', '--name-only', '--diff-filter=U'])
    return out.split('\n').map((l) => l.trim()).filter(Boolean)
  } catch {
    return []
  }
}

export async function gitMergeState(root: string): Promise<GitMergeState> {
  const merging = await access(join(root, '.git', 'MERGE_HEAD')).then(() => true).catch(() => false)
  const conflicts = merging ? await unmergedPaths(root) : []
  let message = ''
  try {
    if (merging) message = await git(root, ['log', '-1', '--format=%s', 'MERGE_HEAD']).catch(() => '')
  } catch {
    /* ignore */
  }
  return { merging, conflicts, message }
}

export async function gitConflictVersions(
  root: string,
  relPath: string
): Promise<GitConflictVersions> {
  assertRelSafe(relPath)
  const p = relPath.split('\\').join('/')
  const [base, ours, theirs] = await Promise.all([
    git(root, ['show', `:1:${p}`]).catch(() => ''),
    git(root, ['show', `:2:${p}`]).catch(() => ''),
    git(root, ['show', `:3:${p}`]).catch(() => '')
  ])
  return { base, ours, theirs }
}

export async function gitStageResolved(
  root: string,
  relPath: string,
  content: string
): Promise<GitActionResult> {
  assertRelSafe(relPath)
  try {
    await writeFile(join(root, relPath), content, 'utf8')
    await git(root, ['add', '--', relPath.split('\\').join('/')])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

export async function gitCompleteMerge(root: string, message?: string): Promise<GitActionResult> {
  try {
    await git(root, message ? ['commit', '-m', message] : ['commit', '--no-edit'])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

export async function gitAbortMerge(root: string): Promise<GitActionResult> {
  try {
    await git(root, ['merge', '--abort'])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}
