import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'
import { createWindow } from './window'
import { accountRestore } from './github'
import { disposeTerminals } from './terminals'

let mainWindow: BrowserWindow | null = null
const getWindow = (): BrowserWindow | null => mainWindow

// A single IPC registration for the app lifetime (handlers are stateless-ish).
registerIpc(getWindow)

app.whenReady().then(() => {
  mainWindow = createWindow()
  buildMenu(getWindow)

  // Reconnect the last-selected account if its token is still valid.
  void accountRestore().then((s) => {
    if (s.connected && !mainWindow?.isDestroyed()) {
      mainWindow?.webContents.send('account:connected', s)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  disposeTerminals()
})
