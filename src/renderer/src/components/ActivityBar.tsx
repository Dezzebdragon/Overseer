import { useStore, type ViewId } from '../store'
import { useHint } from '../hint'

interface ViewDef {
  id: ViewId
  label: string
  icon: string
  position: 'top' | 'bottom'
}

// Futureproofing: adding a view is a one-line entry here plus a render branch
// in App. Buttons are grouped top vs bottom (settings sits at the bottom).
const VIEWS: ViewDef[] = [
  { id: 'overview', label: 'Overview', icon: '🏠', position: 'top' },
  { id: 'explorer', label: 'Explorer', icon: '🗂', position: 'top' },
  { id: 'hub', label: 'Hub', icon: '📖', position: 'top' },
  { id: 'git', label: 'Git', icon: '🌿', position: 'top' },
  { id: 'pipeline', label: 'Pipeline', icon: '📋', position: 'top' },
  { id: 'template', label: 'Templates', icon: '🧩', position: 'top' },
  { id: 'logs', label: 'Logs', icon: '📜', position: 'top' },
  { id: 'tools', label: 'Tools', icon: '🛠', position: 'top' },
  { id: 'account', label: 'Account', icon: '👤', position: 'bottom' },
  { id: 'settings', label: 'Settings', icon: '⚙', position: 'bottom' }
]

function ViewButton({ view }: { view: ViewDef }): JSX.Element {
  const activeView = useStore((s) => s.activeView)
  const setView = useStore((s) => s.setView)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const hint = useHint(view.label)

  const isActive = activeView === view.id

  const onClick = (): void => {
    // Clicking the active Explorer item toggles the sidebar (VS Code behavior).
    if (view.id === 'explorer' && isActive) {
      toggleSidebar()
      return
    }
    setView(view.id)
  }

  return (
    <button
      className={`activity-item${isActive ? ' active' : ''}`}
      onClick={onClick}
      {...hint}
    >
      {view.icon}
    </button>
  )
}

export function ActivityBar(): JSX.Element {
  const top = VIEWS.filter((v) => v.position === 'top')
  const bottom = VIEWS.filter((v) => v.position === 'bottom')

  return (
    <div className="activity-bar">
      <div className="activity-group">
        {top.map((v) => (
          <ViewButton key={v.id} view={v} />
        ))}
      </div>
      <div className="activity-group activity-group-bottom">
        {bottom.map((v) => (
          <ViewButton key={v.id} view={v} />
        ))}
      </div>
    </div>
  )
}
