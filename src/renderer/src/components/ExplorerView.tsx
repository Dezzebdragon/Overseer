import { useStore } from '../store'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { StatusBar } from './StatusBar'
import { ExplorerEditor } from './ExplorerEditor'

export function ExplorerView(): JSX.Element {
  const sidebarVisible = useStore((s) => s.sidebarVisible)

  return (
    <div className="view view-explorer">
      {sidebarVisible && <Sidebar />}
      <div className="main">
        <TabBar />
        <ExplorerEditor />
        <StatusBar />
      </div>
    </div>
  )
}
