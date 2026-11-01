import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Tree } from 'react-arborist'
import type { NodeRendererProps } from 'react-arborist'
import { useStore, type TreeNode } from '../store'
import { useResizeObserver } from '../hooks/useResizeObserver'
import { ipc } from '../ipc'
import { InputDialog, type DialogState } from './InputDialog'

function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}
function dirOf(p: string): string {
  const t = p.replace(/[\\/]+$/, '')
  const cut = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'))
  return cut > 0 ? t.slice(0, cut) : t
}

/** Drop dotfiles (and dot-dirs) from the tree. */
function filterHidden(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .filter((n) => !n.name.startsWith('.'))
    .map((n) => (n.children ? { ...n, children: filterHidden(n.children) } : n))
}

function sortLevel(nodes: TreeNode[]): void {
  nodes.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)))
}

/** Insert ghost nodes for history-only (deleted) paths, creating ghost dirs. */
function mergeDeleted(nodes: TreeNode[], deleted: string[], root: string): TreeNode[] {
  const cloned: TreeNode[] = JSON.parse(JSON.stringify(nodes))
  for (const rel of deleted) {
    const parts = rel.split('/').filter(Boolean)
    let level = cloned
    let acc = root
    for (let i = 0; i < parts.length; i++) {
      acc = `${acc}/${parts[i]}`
      const isLast = i === parts.length - 1
      let existing = level.find((n) => n.name === parts[i])
      if (isLast) {
        if (!existing) level.push({ id: acc, name: parts[i], isDir: false, loaded: true, deleted: true })
      } else {
        if (!existing) {
          existing = { id: acc, name: parts[i], isDir: true, loaded: true, deleted: true, children: [] }
          level.push(existing)
        }
        if (!existing.children) existing.children = []
        level = existing.children
      }
    }
  }
  const sortRec = (list: TreeNode[]): void => {
    sortLevel(list)
    for (const n of list) if (n.children) sortRec(n.children)
  }
  sortRec(cloned)
  return cloned
}

// ---- tree node row -----------------------------------------------------

function Node({ node, style, dragHandle }: NodeRendererProps<TreeNode>) {
  const openFile = useStore((s) => s.openFile)
  const openFileAtCommit = useStore((s) => s.openFileAtCommit)
  const root = useStore((s) => s.root)
  const loadChildren = useStore((s) => s.loadChildren)
  const toggleExpanded = useStore((s) => s.toggleExpanded)
  const activePath = useStore((s) => s.activePath)
  const d = node.data

  const onClick = async (): Promise<void> => {
    if (!d.isDir) {
      if (d.deleted && root) {
        const rel = d.id.startsWith(root) ? d.id.slice(root.length).replace(/^[\\/]+/, '') : d.name
        const sha = await ipc.gitLastFileCommit(root, rel)
        if (sha) openFileAtCommit(rel, sha)
      } else {
        void openFile(d.id)
      }
      return
    }
    const willOpen = !node.isOpen
    if (willOpen && !d.loaded) await loadChildren(d.id)
    node.toggle()
    toggleExpanded(d.id, willOpen)
  }

  const isActive = !d.isDir && d.id === activePath

  return (
    <div
      ref={dragHandle}
      style={style}
      className={`tree-row${isActive ? ' active' : ''}${d.deleted ? ' deleted' : ''}`}
      onClick={onClick}
      data-path={d.id}
      data-isdir={d.isDir ? '1' : '0'}
      title={d.deleted ? `${d.name} (deleted — history only)` : undefined}
    >
      <span className="tree-twist">{d.isDir ? (node.isOpen ? '▾' : '▸') : ''}</span>
      <span className="tree-icon">{d.isDir ? '📁' : '📄'}</span>
      <span className="tree-name">{d.name}</span>
      {d.deleted && <span className="tree-deleted-badge">deleted</span>}
    </div>
  )
}

// ---- context menu ------------------------------------------------------

interface MenuState {
  x: number
  y: number
  path: string
  isDir: boolean
  isRoot: boolean
}

interface MenuItem {
  label: string
  run: () => void
}

function ContextMenu({
  menu,
  items,
  onClose
}: {
  menu: MenuState
  items: MenuItem[]
  onClose: () => void
}): JSX.Element {
  return (
    <div className="context-overlay" onClick={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div
        className="context-menu"
        style={{ left: menu.x, top: menu.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((item) => (
          <div
            key={item.label}
            className="context-item"
            onClick={() => {
              item.run()
              onClose()
            }}
          >
            {item.label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- explorer ----------------------------------------------------------

export function FileExplorer(): JSX.Element {
  const tree = useStore((s) => s.tree)
  const root = useStore((s) => s.root)
  const expandedDirs = useStore((s) => s.expandedDirs)
  const createEntry = useStore((s) => s.createEntry)
  const renamePath = useStore((s) => s.renamePath)
  const deletePath = useStore((s) => s.deletePath)
  const showHidden = useStore((s) => s.settings.explorerShowHidden ?? false)
  const showDeleted = useStore((s) => s.settings.explorerShowDeleted ?? false)

  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [deletedPaths, setDeletedPaths] = useState<string[]>([])
  const [containerRef, size] = useResizeObserver<HTMLDivElement>()
  const treeRef = useRef<{ open?: (id: string) => void } | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!root || !showDeleted) {
      setDeletedPaths([])
      return
    }
    void ipc
      .gitDeletedPaths(root)
      .then((d) => !cancelled && setDeletedPaths(d))
      .catch(() => !cancelled && setDeletedPaths([]))
    return () => {
      cancelled = true
    }
  }, [root, showDeleted])

  const data = useMemo(() => {
    let out = tree
    if (showDeleted && deletedPaths.length > 0 && root) out = mergeDeleted(out, deletedPaths, root)
    if (!showHidden) out = filterHidden(out)
    return out
  }, [tree, showDeleted, deletedPaths, root, showHidden])

  useEffect(() => {
    if (!root || !treeRef.current) return
    try {
      for (const id of expandedDirs) treeRef.current.open?.(id)
    } catch {
      /* non-critical */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])

  const onContextMenu = (e: ReactMouseEvent): void => {
    e.preventDefault()
    const rowEl = (e.target as HTMLElement).closest('[data-path]')
    if (rowEl) {
      setMenu({
        x: e.clientX,
        y: e.clientY,
        path: rowEl.getAttribute('data-path') as string,
        isDir: rowEl.getAttribute('data-isdir') === '1',
        isRoot: false
      })
    } else if (root) {
      setMenu({ x: e.clientX, y: e.clientY, path: root, isDir: true, isRoot: true })
    }
  }

  const buildItems = (m: MenuState): MenuItem[] => {
    const parent = m.isDir ? m.path : dirOf(m.path)
    const items: MenuItem[] = [
      {
        label: 'New File',
        run: () =>
          setDialog({
            title: 'New file name',
            defaultValue: '',
            confirmLabel: 'Create',
            onConfirm: (name) => void createEntry(parent, name, false)
          })
      },
      {
        label: 'New Folder',
        run: () =>
          setDialog({
            title: 'New folder name',
            defaultValue: '',
            confirmLabel: 'Create',
            onConfirm: (name) => void createEntry(parent, name, true)
          })
      }
    ]
    if (!m.isRoot) {
      items.push({
        label: 'Rename',
        run: () =>
          setDialog({
            title: 'Rename to',
            defaultValue: baseName(m.path),
            confirmLabel: 'Rename',
            onConfirm: (name) => void renamePath(m.path, name)
          })
      })
      items.push({
        label: 'Delete',
        run: () => {
          if (window.confirm(`Delete ${baseName(m.path)}?`)) void deletePath(m.path)
        }
      })
    }
    items.push({
      label: 'Open in File Explorer',
      run: () => void ipc.revealInOS(m.path)
    })
    return items
  }

  return (
    <div className="explorer-tree" ref={containerRef} onContextMenu={onContextMenu}>
      {size.height > 0 && (
        <Tree<TreeNode>
          ref={treeRef as never}
          data={data}
          openByDefault={false}
          width={size.width}
          height={size.height}
          indent={14}
          rowHeight={24}
          disableDrag
          disableDrop
        >
          {Node}
        </Tree>
      )}

      {menu && (
        <ContextMenu
          menu={menu}
          items={buildItems(menu)}
          onClose={() => setMenu(null)}
        />
      )}
      {dialog && (
        <InputDialog dialog={dialog} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}
