import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from './store'
import { useAnchor } from './highlight'
import { DEFAULT_TRACKER_IDS, getTrackable } from './trackables'

export interface TrackableExtraItem {
  label: string
  run: () => void
}

/**
 * Marks its children trackable (mirrors useHint's opt-in) and highlight-able
 * (via useAnchor). Right-click opens a menu to Track / Untrack each definition,
 * plus any element-specific extraItems (e.g. "Open in File Explorer").
 */
export function Trackable({
  defIds,
  anchor,
  extraItems = [],
  children
}: {
  defIds: string[]
  anchor?: string
  extraItems?: TrackableExtraItem[]
  children: ReactNode
}): JSX.Element {
  const trackers = useStore((s) => s.trackers)
  const addTracker = useStore((s) => s.addTracker)
  const removeTracker = useStore((s) => s.removeTracker)
  const anchorProps = useAnchor(anchor)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const onContextMenu = (e: ReactMouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <span className="trackable" {...anchorProps} onContextMenu={onContextMenu}>
      {children}
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
              {defIds.map((id) => {
                const def = getTrackable(id)
                if (!def) return null
                const isDefault = DEFAULT_TRACKER_IDS.includes(id)
                const instance = trackers.find((t) => t.definitionId === id)
                if (isDefault) {
                  return (
                    <div key={id} className="context-item disabled">
                      Tracked by default: {def.label}
                    </div>
                  )
                }
                if (instance) {
                  return (
                    <div
                      key={id}
                      className="context-item"
                      onClick={() => {
                        removeTracker(instance.instanceId)
                        setMenu(null)
                      }}
                    >
                      Untrack {def.label}
                    </div>
                  )
                }
                return (
                  <div
                    key={id}
                    className="context-item"
                    onClick={() => {
                      addTracker(def.id, {
                        view: def.origin?.view ?? null,
                        anchor: anchor ?? def.origin?.anchor ?? null
                      })
                      setMenu(null)
                    }}
                  >
                    Track {def.label}
                  </div>
                )
              })}
              {extraItems.length > 0 && <div className="context-sep" />}
              {extraItems.map((item) => (
                <div
                  key={item.label}
                  className="context-item"
                  onClick={() => {
                    item.run()
                    setMenu(null)
                  }}
                >
                  {item.label}
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </span>
  )
}
