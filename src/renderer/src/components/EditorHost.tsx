import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import { useStore } from '../store'
import { modelManager } from '../monaco/modelManager'
import { setEditor } from '../monaco/editorHolder'

export function EditorHost(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const prevPathRef = useRef<string | null>(null)
  const activePath = useStore((s) => s.activePath)

  // Create the single editor instance once.
  useEffect(() => {
    if (!containerRef.current) return
    const theme = useStore.getState().settings.theme === 'dark' ? 'vs-dark' : 'vs'
    const editor = monaco.editor.create(containerRef.current, {
      automaticLayout: true,
      theme,
      fontSize: 13,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection'
    })
    // Dispose the throwaway model Monaco creates so it doesn't leak.
    const initial = editor.getModel()
    editor.setModel(null)
    initial?.dispose()

    editorRef.current = editor
    setEditor(editor)

    const sub = editor.onDidChangeModelContent(() => {
      const p = useStore.getState().activePath
      if (p) useStore.getState().recomputeDirty(p)
    })

    const curSub = editor.onDidChangeCursorPosition((e) => {
      useStore.getState().setCaret(e.position.lineNumber, e.position.column)
    })

    return () => {
      // Preserve cursor/scroll so returning to this view restores it.
      const p = useStore.getState().activePath
      if (p) modelManager.saveViewState(p, editor)
      sub.dispose()
      curSub.dispose()
      setEditor(null)
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  // Swap models when the active tab changes; save/restore view state around it.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const prev = prevPathRef.current
    if (prev && prev !== activePath) {
      modelManager.saveViewState(prev, editor)
    }

    if (activePath) {
      const model = modelManager.get(activePath)
      if (model) {
        editor.setModel(model)
        modelManager.restoreViewState(activePath, editor)
        editor.focus()
      }
    } else {
      editor.setModel(null)
    }
    prevPathRef.current = activePath
  }, [activePath])

  return <div className="editor-host" ref={containerRef} />
}
