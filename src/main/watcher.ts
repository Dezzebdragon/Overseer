import chokidar, { type FSWatcher } from 'chokidar'
import type { BrowserWindow } from 'electron'
import type { FsChange, FsChangeBatch } from '@shared/types'

/**
 * Watches a workspace root and pushes debounced, batched change events to the
 * renderer. A git checkout or npm install can fire thousands of events, so we
 * coalesce them into batches instead of one message per file.
 */
export class WorkspaceWatcher {
  private watcher: FSWatcher | null = null
  private gitWatcher: FSWatcher | null = null
  private gitTimer: NodeJS.Timeout | null = null
  private pending: FsChange[] = []
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly win: BrowserWindow) {}

  start(root: string): void {
    this.stop()
    try {
      this.watcher = chokidar.watch(root, {
        ignored: /(^|[/\\])(node_modules|\.git|\.hg|\.svn)([/\\]|$)/,
        ignoreInitial: true,
        persistent: true,
        // Symlink loops and huge trees can exhaust inotify handles on Linux.
        followSymlinks: false,
        depth: 99
      })

      const push = (type: FsChange['type']) => (path: string) =>
        this.enqueue(root, { type, path })

      this.watcher
        .on('add', push('add'))
        .on('change', push('change'))
        .on('unlink', push('unlink'))
        .on('addDir', push('addDir'))
        .on('unlinkDir', push('unlinkDir'))
        .on('error', (err) => {
          console.warn('[watcher] error, live updates disabled:', err)
        })
    } catch (err) {
      console.warn('[watcher] failed to start, continuing without it:', err)
    }

    // Narrow watcher on just the ref/HEAD files so we notice external git
    // activity (terminal commits, checkouts, merges, fetches) without the churn
    // of watching all of .git (objects/index).
    try {
      const gitDir = `${root}/.git`
      this.gitWatcher = chokidar.watch(
        [
          `${gitDir}/HEAD`,
          `${gitDir}/packed-refs`,
          `${gitDir}/refs`,
          `${gitDir}/logs/HEAD`,
          `${gitDir}/MERGE_HEAD`
        ],
        { ignoreInitial: true, persistent: true, depth: 6 }
      )
      const onGit = (): void => {
        if (this.gitTimer) return
        this.gitTimer = setTimeout(() => {
          this.gitTimer = null
          if (!this.win.isDestroyed()) this.win.webContents.send('git:changed', { root })
        }, 200)
      }
      this.gitWatcher
        .on('add', onGit)
        .on('change', onGit)
        .on('unlink', onGit)
        .on('error', () => undefined)
    } catch {
      /* no git dir / not a repo — fine */
    }
  }

  private enqueue(root: string, change: FsChange): void {
    this.pending.push(change)
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(root), 80)
  }

  private flush(root: string): void {
    this.timer = null
    if (this.pending.length === 0) return
    const batch: FsChangeBatch = { root, changes: this.pending }
    this.pending = []
    if (!this.win.isDestroyed()) {
      this.win.webContents.send('fs:changed', batch)
    }
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.gitTimer) {
      clearTimeout(this.gitTimer)
      this.gitTimer = null
    }
    this.pending = []
    void this.watcher?.close()
    this.watcher = null
    void this.gitWatcher?.close()
    this.gitWatcher = null
  }
}
