import { useStore } from '../store'
import { useHint } from '../hint'
import { executeCommand } from '../commands/registry'
import { FileExplorer } from './FileExplorer'
import { ViewSettingsMenu } from './ViewSettingsMenu'

export function Sidebar(): JSX.Element {
  const workspaceName = useStore((s) => s.workspaceName)
  const openHint = useHint('Open a folder as a workspace')
  const nameHint = useHint(workspaceName ?? undefined)

  return (
    <div className="sidebar">
      <div className="sidebar-dash">
        <span className="hd">EXPLORER</span>
        <ViewSettingsMenu sectionId="explorer" label="Explorer view settings" />
      </div>

      {workspaceName ? (
        <>
          <div className="workspace-name" {...nameHint}>
            {workspaceName}
          </div>
          <FileExplorer />
        </>
      ) : (
        <div className="sidebar-empty">
          <p>No folder opened.</p>
          <button className="btn" onClick={() => executeCommand('workspace.openFolder')} {...openHint}>
            Open Folder
          </button>
        </div>
      )}
    </div>
  )
}
