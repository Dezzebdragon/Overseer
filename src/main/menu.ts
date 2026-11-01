import { BrowserWindow, Menu } from 'electron'

/**
 * The window is frameless; File/Edit/View live in the renderer titlebar and
 * dispatch the same command ids / window actions. We clear the native menu so
 * it doesn't double up. Keybindings are installed in the renderer.
 */
export function buildMenu(_getWindow: () => BrowserWindow | null): void {
  Menu.setApplicationMenu(null)
}
