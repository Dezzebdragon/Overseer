import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

interface HintPosition {
  text: string
  x: number
  y: number
}

interface HintApi {
  show: (text: string, rect: DOMRect) => void
  hide: () => void
}

const HintContext = createContext<HintApi>({
  show: () => {},
  hide: () => {}
})

const SHOW_DELAY_MS = 450

/**
 * Wrap the app once. Any element can then opt into a hover hint via useHint.
 * Elements without a hint simply pass no text and get no tooltip.
 */
export function HintProvider({ children }: { children: ReactNode }): JSX.Element {
  const [hint, setHint] = useState<HintPosition | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [clamped, setClamped] = useState<{ left: number; top: number } | null>(null)

  const api = useMemo<HintApi>(
    () => ({
      show: (text, rect) =>
        setHint({ text, x: rect.left + rect.width / 2, y: rect.bottom + 6 }),
      hide: () => setHint(null)
    }),
    []
  )

  useLayoutEffect(() => {
    if (!hint) {
      setClamped(null)
      return
    }
    const el = tipRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const pad = 8
    let left = hint.x - r.width / 2
    let top = hint.y
    if (left + r.width > window.innerWidth - pad) left = window.innerWidth - pad - r.width
    if (left < pad) left = pad
    if (top + r.height > window.innerHeight - pad) top = hint.y - r.height - 12
    if (top < pad) top = pad
    setClamped({ left, top })
  }, [hint])

  return (
    <HintContext.Provider value={api}>
      {children}
      {hint &&
        createPortal(
          <div
            ref={tipRef}
            className="hint-tooltip"
            style={
              clamped
                ? { left: clamped.left, top: clamped.top, transform: 'none' }
                : { left: hint.x, top: hint.y, visibility: 'hidden' }
            }
          >
            {hint.text}
          </div>,
          document.body
        )}
    </HintContext.Provider>
  )
}

/**
 * Returns props to spread onto any element to give it a hover hint.
 * Pass no text (or undefined) to opt out — the element behaves normally.
 *
 *   <button {...useHint('Save file')}>💾</button>
 */
export function useHint(text?: string): {
  onMouseEnter?: (e: ReactMouseEvent) => void
  onMouseLeave?: () => void
} {
  const api = useContext(HintContext)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  return useMemo(() => {
    if (!text) return {}
    return {
      onMouseEnter: (e: ReactMouseEvent) => {
        const rect = e.currentTarget.getBoundingClientRect()
        timerRef.current = setTimeout(() => api.show(text, rect), SHOW_DELAY_MS)
      },
      onMouseLeave: () => {
        if (timerRef.current) clearTimeout(timerRef.current)
        api.hide()
      }
    }
  }, [text, api])
}
