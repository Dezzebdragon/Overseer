import { useStore } from '../store'
import { usePanelStore } from '../panelStore'
import { registerCommand } from './registry'

/** Wire command ids (used by menus + keybindings) to store actions. */
export function registerBuiltinCommands(): void {
  registerCommand('workspace.openFolder', () => useStore.getState().openWorkspace())
  registerCommand('panel.toggle', () => usePanelStore.getState().toggle())
  registerCommand('file.save', () => useStore.getState().saveActive())
  registerCommand('file.saveAs', () => {
    // Save As needs a native save dialog channel; tracked for the next iteration.
    console.info('[commands] file.saveAs is not implemented yet')
  })
  registerCommand('file.closeTab', () => {
    const { activePath, closeTab } = useStore.getState()
    if (activePath) closeTab(activePath)
  })
  registerCommand('view.toggleSidebar', () => useStore.getState().toggleSidebar())
  registerCommand('view.toggleTheme', () => useStore.getState().toggleTheme())
  registerCommand('view.showExplorer', () => useStore.getState().setView('explorer'))
  registerCommand('view.showSettings', () => useStore.getState().setView('settings'))
}
