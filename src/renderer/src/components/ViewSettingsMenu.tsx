import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useHint } from '../hint'
import { getSettingsSection } from '../settingsRegistry'
import { SettingControl } from './SettingControl'

const MENU_WIDTH = 264

/**
 * Hamburger (three lines) opening a popover: a portal-rendered, fixed-positioned
 * overlay anchored to the button (floats above the UI, never affects layout).
 * The settings shown are the same ones defined for this section in the Settings
 * view; here their descriptions appear on hover.
 */
export function ViewSettingsMenu({
  sectionId,
  label
}: {
  sectionId: string
  label?: string
}): JSX.Element {
  const section = getSettingsSection(sectionId)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const hintLabel = label ?? `${section?.title ?? 'View'} settings`
  const hint = useHint(hintLabel)

  const toggle = (): void => {
    if (pos) {
      setPos(null)
      return
    }
    const rect = btnRef.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8))
    setPos({ top: rect.bottom + 6, left })
  }

  return (
    <>
      <button
        ref={btnRef}
        className="hamburger-btn"
        onClick={toggle}
        aria-label={hintLabel}
        aria-expanded={pos !== null}
        {...hint}
      >
        <span />
        <span />
        <span />
      </button>
      {pos &&
        createPortal(
          <div
            className="popover-backdrop"
            onClick={() => setPos(null)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div
              className="popover-menu"
              style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="popover-title">{section?.title ?? 'Settings'}</div>
              {section && section.settings.length > 0 ? (
                section.settings.map((def) => (
                  <SettingControl key={def.id} def={def} descriptionMode="hint" />
                ))
              ) : (
                <div className="popover-empty">No settings for this view yet.</div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
