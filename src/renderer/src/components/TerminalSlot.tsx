import { useEffect, useRef, useState } from 'react'
import { mountInto, unmount, fit, getSelection, hasSelection, pasteInto } from '../xtermManager'
import { ipc } from '../ipc'
import { ContextMenu, type CtxItem } from './ContextMenu'

/**
 * Renders the live xterm for `id` into this slot while `active`. On unmount/deactivate
 * it detaches the container (the session stays alive in the manager), so the terminal
 * can move to the other surface. Only one slot should be `active` for a given id.
 * Right-click opens a Copy/Paste menu (clipboard goes through main).
 */
export function TerminalSlot({ id, active }: { id: string; active: boolean }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; hasSel: boolean } | null>(null)

  useEffect(() => {
    if (!active || !ref.current) return
    const el = ref.current
    mountInto(id, el)
    const ro = new ResizeObserver(() => fit(id))
    ro.observe(el)
    return () => {
      ro.disconnect()
      unmount(id)
    }
  }, [id, active])

  const items: CtxItem[] = [
    {
      label: 'Copy',
      disabled: !menu?.hasSel,
      onClick: () => {
        const sel = getSelection(id)
        if (sel) void ipc.clipboardWrite(sel)
      }
    },
    {
      label: 'Paste',
      onClick: () => {
        void ipc.clipboardRead().then((text) => {
          if (text) pasteInto(id, text)
        })
      }
    }
  ]

  return (
    <div
      className="terminal-slot"
      ref={ref}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, hasSel: hasSelection(id) })
      }}
    >
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  )
}
