import { useEffect, useMemo } from 'react'
import type { GitGraphData } from '@shared/types'
import { useStore } from '../store'
import { SWATCHES } from '../trackerTypes'

/**
 * Reads the shared, cached commit graph from the store. Every reader (Git view,
 * tabs, status bar) triggers a single deduped load; the graph is reused across
 * view switches and only reloads on Refresh / our own git actions / a .git change.
 */
export function useCommitGraph(root: string | null): {
  graph: GitGraphData | null
  colorOf: (sha: string) => string
} {
  const graph = useStore((s) => s.gitGraph)
  const loadGitGraph = useStore((s) => s.loadGitGraph)

  useEffect(() => {
    if (root) void loadGitGraph(false)
  }, [root, loadGitGraph])

  const colorOf = useMemo(() => {
    const m = new Map<string, string>()
    graph?.commits.forEach((c) => m.set(c.sha, SWATCHES[c.lane % SWATCHES.length]))
    return (sha: string): string => m.get(sha) ?? '#3b82f6'
  }, [graph])

  return { graph, colorOf }
}
