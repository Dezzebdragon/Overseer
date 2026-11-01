import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

export function Modal({
  title,
  onClose,
  children,
  width = 420
}: {
  title: string
  onClose: () => void
  children: ReactNode
  width?: number
}): JSX.Element {
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ width }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body
  )
}
