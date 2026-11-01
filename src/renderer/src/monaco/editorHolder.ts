import type * as monaco from 'monaco-editor'

let editor: monaco.editor.IStandaloneCodeEditor | null = null

export function setEditor(instance: monaco.editor.IStandaloneCodeEditor | null): void {
  editor = instance
}

export function getEditor(): monaco.editor.IStandaloneCodeEditor | null {
  return editor
}
