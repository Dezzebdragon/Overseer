import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { ipc } from '../ipc'
import { languageForPath } from '../monaco/languages'

type Choice = 'ours' | 'theirs' | 'both'
interface Region {
  startLine: number
  sepLine: number
  endLine: number
}

function parseRegions(model: monaco.editor.ITextModel): Region[] {
  const regions: Region[] = []
  const total = model.getLineCount()
  let start = -1
  let sep = -1
  for (let i = 1; i <= total; i++) {
    const t = model.getLineContent(i)
    if (t.startsWith('<<<<<<<')) {
      start = i
      sep = -1
    } else if (t.startsWith('=======') && start !== -1) {
      sep = i
    } else if (t.startsWith('>>>>>>>') && start !== -1 && sep !== -1) {
      regions.push({ startLine: start, sepLine: sep, endLine: i })
      start = -1
      sep = -1
    }
  }
  return regions
}

function absOf(root: string, relPath: string): string {
  const sep = root.includes('\\') ? '\\' : '/'
  return `${root}${sep}${relPath.split('/').join(sep)}`
}

export function ConflictEditor({
  root,
  relPath,
  onStaged
}: {
  root: string
  relPath: string
  onStaged: () => void
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const decoRef = useRef<string[]>([])
  const [hasMarkers, setHasMarkers] = useState(true)
  const [busy, setBusy] = useState(false)

  const refreshDecorations = (): void => {
    const ed = editorRef.current
    const model = ed?.getModel()
    if (!ed || !model) return
    const regions = parseRegions(model)
    setHasMarkers(regions.length > 0)
    const decos: monaco.editor.IModelDeltaDecoration[] = []
    for (const r of regions) {
      decos.push({
        range: new monaco.Range(r.startLine, 1, r.sepLine, 1),
        options: { isWholeLine: true, className: 'conflict-ours' }
      })
      decos.push({
        range: new monaco.Range(r.sepLine, 1, r.endLine, 1),
        options: { isWholeLine: true, className: 'conflict-theirs' }
      })
    }
    decoRef.current = ed.deltaDecorations(decoRef.current, decos)
  }

  const applyResolution = (type: Choice, startLine: number): void => {
    const ed = editorRef.current
    const model = ed?.getModel()
    if (!ed || !model) return
    const region = parseRegions(model).find((r) => r.startLine === startLine)
    if (!region) return
    const ours: string[] = []
    for (let i = region.startLine + 1; i < region.sepLine; i++) ours.push(model.getLineContent(i))
    const theirs: string[] = []
    for (let i = region.sepLine + 1; i < region.endLine; i++) theirs.push(model.getLineContent(i))
    const chosen = type === 'ours' ? ours : type === 'theirs' ? theirs : [...ours, ...theirs]
    const range = new monaco.Range(
      region.startLine,
      1,
      region.endLine,
      model.getLineMaxColumn(region.endLine)
    )
    ed.executeEdits('conflict', [{ range, text: chosen.join('\n') }])
    refreshDecorations()
  }

  const applyAll = (type: Choice): void => {
    const model = editorRef.current?.getModel()
    if (!model) return
    // bottom-up so earlier line numbers stay valid
    const regions = parseRegions(model).sort((a, b) => b.startLine - a.startLine)
    for (const r of regions) applyResolution(type, r.startLine)
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ed = monaco.editor.create(el, {
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false
    })
    editorRef.current = ed
    const acceptId =
      ed.addCommand(0, (_a, type: string, startLine: number) =>
        applyResolution(type as Choice, startLine)
      ) ?? ''
    const contentSub = ed.onDidChangeModelContent(() => refreshDecorations())
    let lensDisposable: monaco.IDisposable | null = null

    void (async () => {
      const res = await ipc.readFile(absOf(root, relPath)).catch(() => null)
      const content = res && !res.refused ? res.content : ''
      const lang = languageForPath(relPath)
      const model = monaco.editor.createModel(content, lang)
      ed.setModel(model)
      refreshDecorations()
      lensDisposable = monaco.languages.registerCodeLensProvider(lang, {
        provideCodeLenses: (m) => {
          if (m !== ed.getModel()) return { lenses: [], dispose: () => undefined }
          const regions = parseRegions(m)
          const lenses: monaco.languages.CodeLens[] = []
          regions.forEach((r, idx) => {
            const range = new monaco.Range(r.startLine, 1, r.startLine, 1)
            lenses.push({ range, id: `ours-${idx}`, command: { id: acceptId, title: 'Accept Current', arguments: ['ours', r.startLine] } })
            lenses.push({ range, id: `theirs-${idx}`, command: { id: acceptId, title: 'Accept Incoming', arguments: ['theirs', r.startLine] } })
            lenses.push({ range, id: `both-${idx}`, command: { id: acceptId, title: 'Accept Both', arguments: ['both', r.startLine] } })
          })
          return { lenses, dispose: () => undefined }
        },
        resolveCodeLens: (_m, l) => l
      })
    })()

    return () => {
      contentSub.dispose()
      lensDisposable?.dispose()
      ed.getModel()?.dispose()
      ed.dispose()
      editorRef.current = null
    }
  }, [root, relPath])

  const markResolved = async (): Promise<void> => {
    const model = editorRef.current?.getModel()
    if (!model || parseRegions(model).length > 0) return
    setBusy(true)
    const res = await ipc.gitStageResolved(root, relPath, model.getValue())
    setBusy(false)
    if (res.ok) onStaged()
  }

  return (
    <div className="conflict-editor">
      <div className="conflict-toolbar">
        <span className="conflict-file mono">{relPath}</span>
        <div className="conflict-tools">
          <button className="btn btn-sm" onClick={() => applyAll('ours')}>Accept all current</button>
          <button className="btn btn-sm" onClick={() => applyAll('theirs')}>Accept all incoming</button>
          <button className="btn btn-sm btn-primary" disabled={hasMarkers || busy} onClick={() => void markResolved()}>
            Mark resolved
          </button>
        </div>
      </div>
      <div className="conflict-monaco" ref={containerRef} />
      {hasMarkers && (
        <div className="conflict-note">
          Green = current (ours), blue = incoming (theirs). Use the inline actions or the toolbar, then Mark resolved.
        </div>
      )}
    </div>
  )
}
