import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'

export interface FileListItem {
  id: string
  /** File name including extension; the list strips the extension for line 1. */
  name: string
  /** Full relative path shown on line 2 (with extension). */
  relPath: string
  sizeBytes: number
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

interface RevealMenu {
  x: number
  y: number
  item: FileListItem
}

/**
 * Reusable file list. Rows only (no folder headers): line 1 is the file name
 * without extension, line 2 is the relative path plus size. Consumers inject
 * per-row leading/trailing content and, via onReveal, a right-click "Open in
 * File Explorer" action available on every row.
 */
export function FileList({
  items,
  selectedId,
  onSelect,
  onReveal,
  renderLeading,
  renderTrailing,
  emptyMessage = 'No files.'
}: {
  items: FileListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onReveal?: (item: FileListItem) => void
  renderLeading?: (item: FileListItem) => ReactNode
  renderTrailing?: (item: FileListItem) => ReactNode
  emptyMessage?: string
}): JSX.Element {
  const [menu, setMenu] = useState<RevealMenu | null>(null)

  if (items.length === 0) {
    return <div className="filelist-empty">{emptyMessage}</div>
  }

  const onContextMenu = (e: ReactMouseEvent, item: FileListItem): void => {
    if (!onReveal) return
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, item })
  }

  return (
    <div className="filelist">
      {items.map((item) => (
        <div
          key={item.id}
          className={`filelist-row${selectedId === item.id ? ' active' : ''}`}
          onContextMenu={(e) => onContextMenu(e, item)}
        >
          {renderLeading && <div className="filelist-lead">{renderLeading(item)}</div>}
          <button
            type="button"
            className="filelist-main"
            onClick={() => onSelect(item.id)}
            title={item.relPath}
          >
            <span className="filelist-name">{stripExtension(item.name)}</span>
            <span className="filelist-meta">
              {item.relPath} · {formatSize(item.sizeBytes)}
            </span>
          </button>
          {renderTrailing && <div className="filelist-trail">{renderTrailing(item)}</div>}
        </div>
      ))}

      {menu && onReveal && (
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
            <div
              className="context-item"
              onClick={() => {
                onReveal(menu.item)
                setMenu(null)
              }}
            >
              Open in File Explorer
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
