import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { ipc } from '../ipc'
import { languageForPath } from '../monaco/languages'

/**
 * Read-only inline diff of a file at a commit vs a base (parent or pinned).
 * Self-contained: owns its Monaco diff editor and models, like EditorPane.
 */
export function DiffPane({
  root,
  relPath,
  versionHash,
  baseHash
}: {
  root: string
  relPath: string
  versionHash: string
  baseHash: string | null
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const modelsRef = useRef<{ original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ed = monaco.editor.createDiffEditor(el, {
      readOnly: true,
      originalEditable: false,
      renderSideBySide: false,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: false
    })
    editorRef.current = ed
    return () => {
      ed.dispose()
      editorRef.current = null
      modelsRef.current?.original.dispose()
      modelsRef.current?.modified.dispose()
      modelsRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const load = async (): Promise<void> => {
      try {
        const [version, base] = await Promise.all([
          ipc.gitFileAtCommit(root, relPath, versionHash),
          baseHash ? ipc.gitFileAtCommit(root, relPath, baseHash) : Promise.resolve('')
        ])
        if (cancelled) return
        const lang = languageForPath(relPath)
        const original = monaco.editor.createModel(base, lang)
        const modified = monaco.editor.createModel(version, lang)
        editorRef.current?.setModel({ original, modified })
        modelsRef.current?.original.dispose()
        modelsRef.current?.modified.dispose()
        modelsRef.current = { original, modified }
      } catch (e) {
        if (!cancelled) setError((e as Error).message || 'Could not load this version.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [root, relPath, versionHash, baseHash])

  return (
    <div className="diff-pane">
      {error && <div className="diff-pane-note">{error}</div>}
      {loading && !error && <div className="diff-pane-note">Loading version…</div>}
      <div
        className="diff-pane-monaco"
        ref={containerRef}
        style={{ display: error ? 'none' : 'block' }}
      />
    </div>
  )
}
