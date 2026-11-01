import { ViewSettingsMenu } from './ViewSettingsMenu'

export function ToolsView(): JSX.Element {
  return (
    <div className="view view-hub">
      <div className="template-header">
        <div className="header-left">
          <span className="template-label">Tools</span>
          <ViewSettingsMenu sectionId="tools" label="Tools view settings" />
        </div>
        <div className="header-right" />
      </div>
      <div className="template-body">
        <aside className="template-files">
          <div className="skeleton-pane-note">Tools</div>
        </aside>
        <main className="template-editor">
          <div className="skeleton-pane-empty">
            Tools — coming soon. This view will list the tools exposed to agents.
          </div>
        </main>
      </div>
    </div>
  )
}
