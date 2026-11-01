import { useState } from 'react'
import { useStore } from '../store'
import { useHint } from '../hint'
import { ipc } from '../ipc'
import { Trackable, type TrackableExtraItem } from '../Trackable'
import { ChangeProjectModal } from './ChangeProjectModal'
import { ToastField, NotificationCenter, TestNotifButton } from './Notifications'

const PROJECT_TRACKABLES = [
  'project.name',
  'project.path',
  'project.size',
  'project.fileCount'
]

export function TopHeader(): JSX.Element {
  const root = useStore((s) => s.root)
  const [modalOpen, setModalOpen] = useState(false)
  const buttonHint = useHint('Change project')

  const extraItems: TrackableExtraItem[] = root
    ? [{ label: 'Open in File Explorer', run: () => void ipc.revealInOS(root) }]
    : []

  return (
    <div className="app-header">
      <button className="btn change-project-btn" onClick={() => setModalOpen(true)} {...buttonHint}>
        Change Project
      </button>

      <Trackable defIds={PROJECT_TRACKABLES} anchor="header.projectPath" extraItems={extraItems}>
        <span className={`header-path${root ? '' : ' empty'}`}>
          {root ?? 'No project selected'}
        </span>
      </Trackable>

      <div className="header-right-group">
        <ToastField />
        <TestNotifButton />
        <NotificationCenter />
      </div>

      {modalOpen && <ChangeProjectModal onClose={() => setModalOpen(false)} />}
    </div>
  )
}
