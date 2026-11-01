import * as monaco from 'monaco-editor'
import type { Eol } from '@shared/types'
import { languageForPath } from './languages'

interface Entry {
  model: monaco.editor.ITextModel
  /** alternativeVersionId captured at last open/save; dirty = current !== this. */
  savedVersionId: number
  viewState: monaco.editor.ICodeEditorViewState | null
}

function toUri(path: string): monaco.Uri {
  return monaco.Uri.file(path)
}

/**
 * Central owner of Monaco text models (ADR-0007). Decouples the file on disk,
 * the open tab, and the Monaco buffer. One model per file URI; nothing else in
 * the app creates or disposes models.
 */
class ModelManager {
  private entries = new Map<string, Entry>()

  private key(path: string): string {
    return toUri(path).toString()
  }

  getOrCreate(path: string, content: string, eol: Eol): monaco.editor.ITextModel {
    const key = this.key(path)
    const existing = this.entries.get(key)
    if (existing) return existing.model

    const model = monaco.editor.createModel(content, languageForPath(path), toUri(path))
    model.setEOL(eol === 'crlf' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF)
    this.entries.set(key, {
      model,
      savedVersionId: model.getAlternativeVersionId(),
      viewState: null
    })
    return model
  }

  has(path: string): boolean {
    return this.entries.has(this.key(path))
  }

  get(path: string): monaco.editor.ITextModel | undefined {
    return this.entries.get(this.key(path))?.model
  }

  /** True when the buffer differs from the last saved/loaded state. */
  isDirty(path: string): boolean {
    const entry = this.entries.get(this.key(path))
    if (!entry) return false
    return entry.model.getAlternativeVersionId() !== entry.savedVersionId
  }

  /** Record the current version as the clean baseline (after save). */
  markSaved(path: string): void {
    const entry = this.entries.get(this.key(path))
    if (entry) entry.savedVersionId = entry.model.getAlternativeVersionId()
  }

  /** Replace buffer contents from disk (external change on a clean file). */
  replaceContent(path: string, content: string, eol: Eol): void {
    const entry = this.entries.get(this.key(path))
    if (!entry) return
    entry.model.setValue(content)
    entry.model.setEOL(eol === 'crlf' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF)
    entry.savedVersionId = entry.model.getAlternativeVersionId()
  }

  saveViewState(path: string, editor: monaco.editor.ICodeEditor): void {
    const entry = this.entries.get(this.key(path))
    if (entry) entry.viewState = editor.saveViewState()
  }

  restoreViewState(path: string, editor: monaco.editor.ICodeEditor): void {
    const entry = this.entries.get(this.key(path))
    if (entry?.viewState) editor.restoreViewState(entry.viewState)
  }

  dispose(path: string): void {
    const key = this.key(path)
    const entry = this.entries.get(key)
    if (!entry) return
    entry.model.dispose()
    this.entries.delete(key)
  }
}

export const modelManager = new ModelManager()
