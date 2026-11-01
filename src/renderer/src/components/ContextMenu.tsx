import { createPortal } from 'react-dom'

export interface CtxItem {
  label?: string
  sep?: boolean
  onClick?: () => void
  disabled?: boolean
  hint?: string
}

export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: CtxItem[]
  onClose: () => void
}): JSX.Element {
  return createPortal(
    <div
      className="context-overlay"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="context-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
        {items.map((it, i) =>
          it.sep ? (
            <div key={i} className="context-sep" />
          ) : (
            <div
              key={i}
              className={`context-item${it.disabled ? ' disabled' : ''}`}
              title={it.hint}
              onClick={() => {
                if (it.disabled) return
                it.onClick?.()
                onClose()
              }}
            >
              {it.label}
            </div>
          )
        )}
      </div>
    </div>,
    document.body
  )
}
