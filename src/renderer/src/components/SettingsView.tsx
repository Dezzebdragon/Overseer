import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { useHint } from '../hint'
import type { AppSettings } from '@shared/ipc'
import { SETTINGS_SECTIONS } from '../settingsRegistry'
import { SettingControl } from './SettingControl'

// Session-scoped scroll memory: survives view switches, resets on app reload.
let savedScrollTop = 0

function ThemeOption({
  value,
  label,
  current,
  onSelect
}: {
  value: AppSettings['theme']
  label: string
  current: AppSettings['theme']
  onSelect: (v: AppSettings['theme']) => void
}): JSX.Element {
  const hint = useHint(`Use the ${label.toLowerCase()} theme`)
  return (
    <button
      className={`segmented-option${current === value ? ' active' : ''}`}
      onClick={() => onSelect(value)}
      {...hint}
    >
      {label}
    </button>
  )
}

export function SettingsView(): JSX.Element {
  const theme = useStore((s) => s.settings.theme)
  const setTheme = useStore((s) => s.setTheme)

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = savedScrollTop
    const onScroll = (): void => {
      savedScrollTop = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="view view-settings" ref={scrollRef}>
      <div className="settings-panel">
        <h1>Settings</h1>

        <section className="settings-section">
          <h2 className="settings-section-title">Appearance</h2>
          <div className="settings-row">
            <div className="settings-label">
              <div className="settings-title">Theme</div>
              <div className="settings-desc">Switch between dark and light.</div>
            </div>
            <div className="segmented">
              <ThemeOption value="dark" label="Dark" current={theme} onSelect={setTheme} />
              <ThemeOption value="light" label="Light" current={theme} onSelect={setTheme} />
            </div>
          </div>
        </section>

        {/* View-scoped settings; the same ones surface in each view's popover. */}
        {SETTINGS_SECTIONS.map((section) => (
          <section
            key={section.id}
            className="settings-section"
            data-anchor={`section.${section.id}`}
          >
            <h2 className="settings-section-title">{section.title}</h2>
            {section.settings.map((def) => (
              <SettingControl key={def.id} def={def} descriptionMode="below" />
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
