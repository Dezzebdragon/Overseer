import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useHint } from '../hint'
import { ColorSwatches } from './ColorSwatches'
import { InputDialog, type DialogState } from './InputDialog'

export function TrackerCell({
  title,
  description,
  valueText,
  color,
  isNA,
  naReason,
  currentColor,
  canShowOriginal,
  onShowOriginal,
  onRecolor,
  onRemove,
  onSetTitle,
  onSetDescription
}: {
  title: string
  description: string
  valueText: string
  color: string
  isNA: boolean
  /** When set, this tracker's target is gone; shown as a muted cell with this reason on hover. */
  naReason?: string
  currentColor?: string
  canShowOriginal: boolean
  onShowOriginal?: () => void
  onRecolor: (color: string) => void
  onRemove?: () => void
  onSetTitle?: (value: string) => void
  onSetDescription?: (value: string) => void
}): JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const descHint = useHint(description)
  const valueHint = useHint(naReason)

  return (
    <div
      className="tracker-cell"
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <div className="tracker-title">{title}</div>
      <div
        className={`tracker-value${naReason ? ' tracker-value--lost' : ''}`}
        style={isNA ? undefined : { color }}
        {...valueHint}
      >
        {valueText}
      </div>
      <div className="tracker-desc" {...descHint}>
        {description}
      </div>

      {menu &&
        createPortal(
          <div
            className="context-overlay"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div
              className="context-menu"
              style={{ left: menu.x, top: menu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="context-swatches">
                <ColorSwatches
                  value={currentColor}
                  onPick={(c) => {
                    onRecolor(c)
                    setMenu(null)
                  }}
                />
              </div>
              {canShowOriginal && onShowOriginal && (
                <div
                  className="context-item"
                  onClick={() => {
                    onShowOriginal()
                    setMenu(null)
                  }}
                >
                  Show original
                </div>
              )}
              {onSetTitle && (
                <div
                  className="context-item"
                  onClick={() => {
                    setMenu(null)
                    setDialog({
                      title: 'Custom title',
                      defaultValue: title,
                      confirmLabel: 'Save',
                      onConfirm: (v) => onSetTitle(v)
                    })
                  }}
                >
                  Set title…
                </div>
              )}
              {onSetDescription && (
                <div
                  className="context-item"
                  onClick={() => {
                    setMenu(null)
                    setDialog({
                      title: 'Custom description',
                      defaultValue: description,
                      confirmLabel: 'Save',
                      onConfirm: (v) => onSetDescription(v)
                    })
                  }}
                >
                  Set description…
                </div>
              )}
              {onRemove && (
                <div
                  className="context-item danger"
                  onClick={() => {
                    setMenu(null)
                    if (window.confirm(`Stop tracking "${title}"?`)) onRemove()
                  }}
                >
                  Remove
                </div>
              )}
            </div>
          </div>,
          document.body
        )}

      {dialog && <InputDialog dialog={dialog} onClose={() => setDialog(null)} />}
    </div>
  )
}
