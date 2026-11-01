import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from 'react'

/**
 * A fixed-position box that measures itself after mount and shifts to stay
 * fully inside the window (used for tooltips/popovers rendered near an edge).
 */
export function ClampedFloating({
  x,
  y,
  className,
  style,
  children,
  onClick,
  pad = 8
}: {
  x: number
  y: number
  className?: string
  style?: CSSProperties
  children: ReactNode
  onClick?: (e: ReactMouseEvent) => void
  pad?: number
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = x
    let top = y
    if (left + r.width > window.innerWidth - pad) left = window.innerWidth - pad - r.width
    if (left < pad) left = pad
    if (top + r.height > window.innerHeight - pad) top = window.innerHeight - pad - r.height
    if (top < pad) top = pad
    setPos({ left, top })
  }, [x, y, pad])

  return (
    <div
      ref={ref}
      className={className}
      onClick={onClick}
      style={{
        ...style,
        left: pos?.left ?? x,
        top: pos?.top ?? y,
        visibility: pos ? 'visible' : 'hidden'
      }}
    >
      {children}
    </div>
  )
}
