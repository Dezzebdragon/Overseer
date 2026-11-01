import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AppSettings } from '@shared/ipc'
import { useStore } from '../store'
import { useViewSettingsStore } from '../viewSettingsStore'
import { useNotifications } from '../notificationStore'
import { useHint } from '../hint'
import { highlight } from '../highlight'
import { toOSPlatform, OS_PLATFORMS, OS_LABEL, type OSPlatform } from '@shared/terminal-commands'
import type { SettingDef, SettingOption } from '../settingsRegistry'

const MENU_WIDTH = 240

function SelectOptionRow({
  option,
  active,
  onSelect
}: {
  option: SettingOption
  active: boolean
  onSelect: () => void
}): JSX.Element {
  const hint = useHint(option.description)
  return (
    <button className={`select-option${active ? ' active' : ''}`} onClick={onSelect} {...hint}>
      {option.label}
    </button>
  )
}

/** Custom dropdown (portal popover) so each option keeps its own hover hint. */
function SelectDropdown({
  options,
  value,
  onChange
}: {
  options: SettingOption[]
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const current = options.find((o) => o.value === value) ?? options[0]

  const toggle = (): void => {
    if (pos) {
      setPos(null)
      return
    }
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, MENU_WIDTH) })
  }

  return (
    <>
      <button ref={btnRef} className="select-trigger" onClick={toggle} aria-expanded={pos !== null}>
        <span>{current?.label}</span>
        <span className="select-caret">▾</span>
      </button>
      {pos &&
        createPortal(
          <div className="popover-backdrop" onClick={() => setPos(null)}>
            <div
              className="popover-menu select-menu"
              style={{ top: pos.top, left: pos.left, width: pos.width }}
              onClick={(e) => e.stopPropagation()}
            >
              {options.map((o) => (
                <SelectOptionRow
                  key={o.value}
                  option={o}
                  active={o.value === value}
                  onSelect={() => {
                    onChange(o.value)
                    setPos(null)
                  }}
                />
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

/** Checkbox + select settings (bound to view store or AppSettings). */
function StandardSetting({
  def,
  descriptionMode
}: {
  def: SettingDef
  descriptionMode: 'below' | 'hint'
}): JSX.Element {
  const isApp = def.binding === 'app'

  const viewValue = useViewSettingsStore((s) => s.values[def.id] ?? false)
  const viewToggle = useViewSettingsStore((s) => s.toggle)
  const appValue = useStore((s) => (isApp ? s.settings[def.id as keyof AppSettings] : undefined))
  const setAppSetting = useStore((s) => s.setAppSetting)
  const toast = useNotifications((s) => s.toast)

  const hint = useHint(descriptionMode === 'hint' ? def.description : undefined)
  // Toasting is scoped to the hamburger popover per product spec.
  const announce = (msg: string): void => {
    if (descriptionMode === 'hint') toast({ title: msg, color: '#3b82f6' })
  }

  let control: JSX.Element
  if (def.type === 'select') {
    const current =
      (appValue as string | undefined) ?? def.defaultValue ?? def.options?.[0]?.value ?? ''
    control = (
      <div className="setting-row setting-row-select" {...hint}>
        <span className="setting-select-label">{def.label}</span>
        <SelectDropdown
          options={def.options ?? []}
          value={current}
          onChange={(v) => {
            void setAppSetting(def.id as keyof AppSettings, v as never)
            announce(`${def.label}: ${def.options?.find((o) => o.value === v)?.label ?? v}`)
          }}
        />
      </div>
    )
  } else {
    const value = isApp ? (appValue as boolean | undefined) ?? def.default ?? false : viewValue
    const onToggle = (): void => {
      const next = !value
      if (isApp) void setAppSetting(def.id as keyof AppSettings, next as never)
      else viewToggle(def.id)
      announce(`${def.label}: ${next ? 'On' : 'Off'}`)
    }
    control = (
      <label className="setting-row" {...hint}>
        <input type="checkbox" checked={value} onChange={onToggle} />
        <span>{def.label}</span>
      </label>
    )
  }

  if (descriptionMode === 'hint') return control

  return (
    <div className="setting-block" data-anchor={`setting.${def.id}`}>
      {control}
      <div className="setting-desc">{def.description}</div>
    </div>
  )
}

const C_SAVE = '#3fb950'
const C_CANCEL = '#8b92a5'
const C_ERROR = '#e5484d'

/**
 * Command setting: an editable string written into agent configs. Editing is gated
 * behind an Edit toggle + a confirm dialog (dangerous), validated against a template,
 * with a Revert-to-default and save/cancel toasts. In a popover it never edits inline —
 * it links to the setting in the Settings view instead.
 */
function CommandSetting({
  def,
  descriptionMode
}: {
  def: SettingDef
  descriptionMode: 'below' | 'hint'
}): JSX.Element {
  const settings = useStore((s) => s.settings)
  const setAppSetting = useStore((s) => s.setAppSetting)
  const toast = useNotifications((s) => s.toast)

  // Per-OS command settings edit one platform's variant at a time; default to this OS.
  const detectedOS = toOSPlatform(window.api.platform)
  const [platform, setPlatform] = useState<OSPlatform>(detectedOS)
  const variant = def.osVariants ? def.osVariants[platform] : null

  const storageKey = variant ? `${def.id}:${platform}` : def.id
  const fallback = variant ? variant.value : def.defaultValue ?? ''
  const template = variant ? variant.template : def.commandTemplate
  const patternSrc = variant ? variant.pattern : def.commandPattern
  const stored = settings.agentCommands?.[storageKey] ?? fallback
  const isDefault = stored === fallback
  const pattern = patternSrc ? new RegExp(patternSrc) : null

  const [editing, setEditing] = useState(false)
  const [buffer, setBuffer] = useState(stored)
  const dirty = editing && buffer !== stored

  // Track the field to external changes (and platform switches) while not editing.
  useEffect(() => {
    if (!editing) setBuffer(stored)
  }, [stored, editing])

  // Silently discard an unsaved edit if this unmounts mid-edit (e.g. view change) — toast only.
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  const labelRef = useRef(def.label)
  labelRef.current = def.label
  useEffect(() => {
    return () => {
      if (dirtyRef.current) {
        toast({ title: `Discarded unsaved change to ${labelRef.current}`, color: C_CANCEL })
      }
    }
  }, [toast])

  // Popover mode: never edit inline; jump to the Settings view and flash the row.
  if (descriptionMode === 'hint') {
    return (
      <button
        className="setting-goto"
        title={def.description}
        onClick={() => highlight(`setting.${def.id}`, 'settings')}
      >
        <span className="setting-goto-label">{def.label}</span>
        <span className="setting-goto-arrow">Open in Settings →</span>
      </button>
    )
  }

  const persist = (value: string): void => {
    const map = { ...(settings.agentCommands ?? {}) }
    if (value === fallback) delete map[storageKey]
    else map[storageKey] = value
    void setAppSetting('agentCommands', map)
  }

  const changePlatform = (p: OSPlatform): void => {
    // Switching platforms discards any unsaved edit for the previous one.
    setEditing(false)
    setPlatform(p)
  }

  const save = (): void => {
    const value = buffer.trim()
    if (pattern && !pattern.test(value)) {
      toast({ title: `${def.label}: doesn't match the required format`, color: C_ERROR })
      return
    }
    const ok = window.confirm(
      `Change ${def.label}${variant ? ` (${OS_LABEL[platform]})` : ''}?\n\n` +
        `From:\n${stored}\n\nTo:\n${value}\n\nContinue?`
    )
    if (!ok) return
    persist(value)
    setEditing(false)
    toast({ title: `${def.label} saved`, color: C_SAVE })
  }

  const cancel = (): void => {
    setBuffer(stored)
    setEditing(false)
    toast({ title: `${def.label} change canceled`, color: C_CANCEL })
  }

  const revert = (): void => {
    persist(fallback)
    setBuffer(fallback)
    setEditing(false)
    toast({ title: `${def.label} reverted to default`, color: C_SAVE })
  }

  return (
    <div className="setting-block" data-anchor={`setting.${def.id}`}>
      <div className="setting-command-head">
        <div className="setting-command-label">{def.label}</div>
        {variant && (
          <select
            className="setting-os-select"
            value={platform}
            onChange={(e) => changePlatform(e.target.value as OSPlatform)}
            title="Show the command for this platform"
          >
            {OS_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {OS_LABEL[p]}
                {p === detectedOS ? ' (this OS)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="setting-command-row">
        <input
          className="setting-command-input"
          value={buffer}
          readOnly={!editing}
          spellCheck={false}
          onChange={(e) => setBuffer(e.target.value)}
        />
        {editing ? (
          <>
            <button className="btn btn-sm btn-primary" onClick={save} disabled={!dirty}>
              Save
            </button>
            <button className="btn btn-sm" onClick={cancel}>
              Cancel
            </button>
          </>
        ) : (
          <button className="btn btn-sm" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        <button className="btn btn-sm btn-ghost" onClick={revert} disabled={isDefault && !dirty}>
          Revert
        </button>
      </div>
      <div className="setting-desc setting-desc-command">
        {def.description}
        {template && (
          <span className="setting-command-template">
            {' '}
            Template: <code>{template}</code>
          </span>
        )}
      </div>
    </div>
  )
}

export function SettingControl({
  def,
  descriptionMode
}: {
  def: SettingDef
  descriptionMode: 'below' | 'hint'
}): JSX.Element {
  if (def.type === 'command') return <CommandSetting def={def} descriptionMode={descriptionMode} />
  return <StandardSetting def={def} descriptionMode={descriptionMode} />
}
