import { useMemo } from 'react'
import { useStore } from './store'
import type { ViewId } from './store'

/**
 * Marks an element as a highlight target (mirrors useHint's opt-in). Spread the
 * result onto any element — title, pane, section, button, text — to make it
 * addressable by highlight().
 */
export function useAnchor(id?: string): { 'data-anchor'?: string } {
  return useMemo(() => (id ? { 'data-anchor': id } : {}), [id])
}

/**
 * Momentary attention flash: optionally switch view, scroll the anchor into
 * view, and flash it amber. Used by tracker "show original" and reusable
 * anywhere navigation-to-an-element is wanted.
 */
export function highlight(anchor: string | null, view?: string | null): void {
  if (view) useStore.getState().setView(view as ViewId)
  if (!anchor) return
  // Let the target view render before locating the anchor.
  setTimeout(() => {
    const el = document.querySelector<HTMLElement>(`[data-anchor="${anchor}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.remove('anchor-flash')
    void el.offsetWidth // restart the animation if already flashing
    el.classList.add('anchor-flash')
    window.setTimeout(() => el.classList.remove('anchor-flash'), 1700)
  }, 140)
}
