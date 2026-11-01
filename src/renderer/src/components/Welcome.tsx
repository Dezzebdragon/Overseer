import { useStore } from '../store'
import { executeCommand } from '../commands/registry'

export function Welcome(): JSX.Element {
  const hasWorkspace = useStore((s) => s.root !== null)

  return (
    <div className="welcome">
      <h1>Custom IDE</h1>
      {hasWorkspace ? (
        // A workspace is open but no file is selected: no "open folder" button here.
        <p>Select a file from the Explorer to start editing.</p>
      ) : (
        <>
          <p>Open a folder to start editing.</p>
          <button className="btn" onClick={() => executeCommand('workspace.openFolder')}>
            Open Folder
          </button>
        </>
      )}
      <p className="welcome-hint">
        Ctrl+O open folder · Ctrl+S save · Ctrl+W close tab · Ctrl+B toggle sidebar
      </p>
    </div>
  )
}
