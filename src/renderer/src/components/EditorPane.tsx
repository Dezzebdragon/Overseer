import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import * as monaco from 'monaco-editor'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../store'
import {
  clearModelRegions,
  ensureGeneratedHover,
  parseGeneratedRegions,
  regionsSignature,
  setModelRegions
} from '../hubSections'

/**
 * Reusable editor pane. Monaco for raw editing; a rendered preview toggled by
 * buttons. Manages its own anonymous model so buffers stay isolated from the
 * Explorer's model manager. Read/write is delegated to the parent.
 *
 * When highlightGenerated is set, machine-generated sections (pm: markers) are
 * visually distinguished, warn on hover, and prompt for confirmation on save.
 */
export function EditorPane({
  hasFile,
  title,
  badge = null,
  content,
  sourceKey,
  language,
  readOnly = false,
  canPreview,
  busy = false,
  emptyMessage = 'Select a file.',
  defaultMode,
  highlightGenerated = false,
  headerContainer = null,
  onSave,
  headerExtras = null
}: {
  hasFile: boolean
  title: string | null
  badge?: string | null
  content: string
  /** Changes when a different file is loaded; drives model reload. */
  sourceKey: string
  language: string
  readOnly?: boolean
  canPreview: boolean
  busy?: boolean
  emptyMessage?: string
  /** Force the initial mode on load (e.g. a new file opens in edit). */
  defaultMode?: 'edit' | 'preview'
  /** Distinguish + guard machine-generated (pm:) sections. */
  highlightGenerated?: boolean
  /** When set, the pane header is portaled here (Hub hoists it into the top bar). */
  headerContainer?: HTMLElement | null
  onSave: (value: string) => void | Promise<void>
  headerExtras?: ReactNode
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const savedVersionRef = useRef<number>(0)
  const decorationsRef = useRef<string[]>([])
  const baselineGenRef = useRef<string>('')

  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [dirty, setDirty] = useState(false)
  const [previewText, setPreviewText] = useState('')

  const refreshGenerated = (): void => {
    const editor = editorRef.current
    const model = modelRef.current
    if (!editor || !model) return
    if (!highlightGenerated) return
    const regions = parseGeneratedRegions(model.getValue())
    setModelRegions(model.uri.toString(), regions)
    decorationsRef.current = editor.deltaDecorations(
      decorationsRef.current,
      regions.map((r) => ({
        range: new monaco.Range(r.startLine, 1, r.endLine, 1),
        options: {
          isWholeLine: true,
          className: 'gen-region'
        }
      }))
    )
  }

  // Create the editor ONLY while a file is open.
  useEffect(() => {
    if (!hasFile) return
    if (highlightGenerated) ensureGeneratedHover()
    const container = containerRef.current
    if (!container) return
    const editor = monaco.editor.create(container, {
      automaticLayout: true,
      theme: useStore.getState().settings.theme === 'dark' ? 'vs-dark' : 'vs',
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      readOnly
    })
    const initial = editor.getModel()
    editor.setModel(null)
    initial?.dispose()
    editorRef.current = editor

    const sub = editor.onDidChangeModelContent(() => {
      const model = modelRef.current
      if (model) setDirty(model.getAlternativeVersionId() !== savedVersionRef.current)
      refreshGenerated()
    })
    return () => {
      sub.dispose()
      const uri = modelRef.current?.uri.toString()
      if (uri) clearModelRegions(uri)
      editor.dispose()
      modelRef.current?.dispose()
      modelRef.current = null
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFile])

  // Load a fresh model when the selected file changes.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !hasFile) return
    const prevUri = modelRef.current?.uri.toString()
    if (prevUri) clearModelRegions(prevUri)
    decorationsRef.current = []
    modelRef.current?.dispose()

    const model = monaco.editor.createModel(content, language)
    modelRef.current = model
    savedVersionRef.current = model.getAlternativeVersionId()
    editor.setModel(model)
    editor.updateOptions({ readOnly })
    setDirty(false)
    setMode(defaultMode ?? (canPreview ? 'preview' : 'edit'))
    setPreviewText(content)

    if (highlightGenerated) {
      const regions = parseGeneratedRegions(content)
      baselineGenRef.current = regionsSignature(regions)
      refreshGenerated()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey])

  // Content can arrive asynchronously after sourceKey already changed (e.g. the
  // Hub loads the file after selecting it). Sync the model when that happens,
  // as long as the user hasn't edited it.
  useEffect(() => {
    const model = modelRef.current
    if (!model || dirty) return
    if (model.getValue() === content) return
    model.setValue(content)
    savedVersionRef.current = model.getAlternativeVersionId()
    setPreviewText(content)
    if (highlightGenerated) {
      const regions = parseGeneratedRegions(content)
      baselineGenRef.current = regionsSignature(regions)
      refreshGenerated()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly })
  }, [readOnly])

  const enterPreview = (): void => {
    setPreviewText(modelRef.current?.getValue() ?? content)
    setMode('preview')
  }

  const save = async (): Promise<void> => {
    const model = modelRef.current
    if (!model) return
    const value = model.getValue()

    if (highlightGenerated) {
      const sig = regionsSignature(parseGeneratedRegions(value))
      if (sig !== baselineGenRef.current) {
        const ok = window.confirm(
          'You modified a generated section. Saving may cause problems if this file is later regenerated. Save anyway?'
        )
        if (!ok) return
      }
      baselineGenRef.current = sig
    }

    await onSave(value)
    savedVersionRef.current = model.getAlternativeVersionId()
    setDirty(false)
  }

  const hoisted = Boolean(headerContainer)
  const header = (
    <div
      className={`pane-header${!hasFile ? ' pane-header--empty' : ''}${
        hoisted ? ' pane-header--hoisted' : ''
      }`}
    >
      <div className="pane-title">
        {hasFile ? title : ''}
        {badge && <span className="pane-badge">{badge}</span>}
        {dirty && <span className="pane-dirty">●</span>}
      </div>
      <div className="pane-actions">
        {canPreview && hasFile && (
          <div className="segmented">
            <button
              className={`segmented-option${mode === 'edit' ? ' active' : ''}`}
              onClick={() => setMode('edit')}
            >
              Edit
            </button>
            <button
              className={`segmented-option${mode === 'preview' ? ' active' : ''}`}
              onClick={enterPreview}
            >
              Preview
            </button>
          </div>
        )}
        {hasFile && !readOnly && (
          <button className="btn" onClick={() => void save()} disabled={!dirty || busy}>
            Save
          </button>
        )}
        {headerExtras}
      </div>
    </div>
  )

  return (
    <div className="editor-pane">
      {headerContainer ? createPortal(header, headerContainer) : header}

      <div className="pane-body">
        {!hasFile && <div className="pane-empty">{emptyMessage}</div>}
        {hasFile && (
          <div
            className="pane-editor"
            ref={containerRef}
            style={{ display: mode === 'edit' ? 'block' : 'none' }}
          />
        )}
        {hasFile && mode === 'preview' && (
          <div className="pane-preview markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewText}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
