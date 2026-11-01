import { useEffect } from 'react'
import { useStore } from './store'
import { useAccountStore } from './accountStore'
import { useLogStore } from './logStore'
import { useTerminalStore } from './terminalStore'
import { HintProvider } from './hint'
import { registerBuiltinCommands } from './commands/builtins'
import { installKeybindings } from './commands/keybindings'
import { executeCommand } from './commands/registry'
import { ActivityBar } from './components/ActivityBar'
import { TitleBar } from './components/TitleBar'
import { TopHeader } from './components/TopHeader'
import { ExplorerView } from './components/ExplorerView'
import { SettingsView } from './components/SettingsView'
import { OverviewView } from './components/OverviewView'
import { HubView } from './components/HubView'
import { GitView } from './components/GitView'
import { PipelineView } from './components/PipelineView'
import { TemplateView } from './components/TemplateView'
import { LogsView } from './components/LogsView'
import { ToolsView } from './components/ToolsView'
import { AccountView } from './components/AccountView'
import { BottomPanel } from './components/BottomPanel'

export function App(): JSX.Element {
  const activeView = useStore((s) => s.activeView)
  const init = useStore((s) => s.init)
  const applyFsChanges = useStore((s) => s.applyFsChanges)

  useEffect(() => {
    registerBuiltinCommands()
    void init()
    useAccountStore.getState().init()
    const offLog = useLogStore.getState().init()
    const offTerm = useTerminalStore.getState().init()
    const removeKeys = installKeybindings()

    const offFs = window.api.on('fs:changed', (batch) => {
      void applyFsChanges(batch)
    })
    const offMenu = window.api.on('menu:command', ({ commandId }) => {
      executeCommand(commandId)
    })
    const offGit = window.api.on('git:changed', () => {
      void useStore.getState().loadGitGraph(true)
    })

    return () => {
      removeKeys()
      offFs()
      offMenu()
      offGit()
      offLog()
      offTerm()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <HintProvider>
      <div className="app-shell">
        <TitleBar />
        <TopHeader />
        <div className="app">
          <ActivityBar />
          <div className="view-column">
            <div className="view-host">
              {activeView === 'overview' && <OverviewView />}
              {activeView === 'explorer' && <ExplorerView />}
              {activeView === 'hub' && <HubView />}
              {activeView === 'git' && <GitView />}
              {activeView === 'pipeline' && <PipelineView />}
              {activeView === 'template' && <TemplateView />}
              {activeView === 'logs' && <LogsView />}
              {activeView === 'tools' && <ToolsView />}
              {activeView === 'account' && <AccountView />}
              {activeView === 'settings' && <SettingsView />}
            </div>
            <BottomPanel />
          </div>
        </div>
      </div>
    </HintProvider>
  )
}
