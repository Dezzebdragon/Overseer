import { executeCommand } from './registry'

interface Binding {
  key: string // lowercase KeyboardEvent.key
  ctrlOrCmd?: boolean
  shift?: boolean
  commandId: string
}

const bindings: Binding[] = [
  { key: 'o', ctrlOrCmd: true, commandId: 'workspace.openFolder' },
  { key: 's', ctrlOrCmd: true, commandId: 'file.save' },
  { key: 's', ctrlOrCmd: true, shift: true, commandId: 'file.saveAs' },
  { key: 'w', ctrlOrCmd: true, commandId: 'file.closeTab' },
  { key: 'b', ctrlOrCmd: true, commandId: 'view.toggleSidebar' },
  { key: ',', ctrlOrCmd: true, commandId: 'view.showSettings' },
  { key: '`', ctrlOrCmd: true, commandId: 'panel.toggle' }
]

function matches(b: Binding, e: KeyboardEvent): boolean {
  const cmd = e.ctrlKey || e.metaKey
  if (!!b.ctrlOrCmd !== cmd) return false
  if (!!b.shift !== e.shiftKey) return false
  return e.key.toLowerCase() === b.key
}

/** Attach global keybindings. Returns an unsubscribe function. */
export function installKeybindings(): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    for (const b of bindings) {
      if (matches(b, e)) {
        e.preventDefault()
        executeCommand(b.commandId)
        return
      }
    }
  }
  window.addEventListener('keydown', onKeyDown, { capture: true })
  return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
}
