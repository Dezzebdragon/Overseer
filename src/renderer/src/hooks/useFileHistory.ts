import { useEffect, useState } from 'react'
import type { GitFileCommit } from '@shared/types'
import { ipc } from '../ipc'

/** Loads the commit history (with +/- stats) for a file, by relative path. */
export function useFileHistory(root: string | null, relPath: string | null): GitFileCommit[] {
  const [history, setHistory] = useState<GitFileCommit[]>([])
  useEffect(() => {
    let cancelled = false
    if (!root || !relPath) {
      setHistory([])
      return
    }
    void ipc
      .gitFileHistory(root, relPath)
      .then((h) => !cancelled && setHistory(h))
      .catch(() => !cancelled && setHistory([]))
    return () => {
      cancelled = true
    }
  }, [root, relPath])
  return history
}

export function toRel(root: string | null, abs: string | null): string | null {
  if (!abs) return null
  if (root && abs.startsWith(root)) return abs.slice(root.length).replace(/^[\\/]+/, '')
  return abs.split(/[\\/]/).pop() ?? abs
}
