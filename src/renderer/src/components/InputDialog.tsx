import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface DialogState {
  title: string
  defaultValue: string
  confirmLabel: string
  placeholder?: string
  onConfirm: (value: string) => void
}

export function InputDialog({
  dialog,
  onClose
}: {
  dialog: DialogState
  onClose: () => void
}): JSX.Element {
  const [value, setValue] = useState(dialog.defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus after paint. rAF avoids the case where focus() runs before the input
  // is focusable, which left the field unresponsive until the window refocused.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [])

  const submit = (): void => {
    const trimmed = value.trim()
    if (trimmed) dialog.onConfirm(trimmed)
    onClose()
  }

  // Rendered through a portal so no view's stacking/focus context can trap it.
  return createPortal(
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">{dialog.title}</div>
        <input
          ref={inputRef}
          className="dialog-input"
          autoFocus
          value={value}
          placeholder={dialog.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onClose()
          }}
        />
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={submit}>
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
