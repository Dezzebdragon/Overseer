import { useState } from 'react'
import type { AgentInfo, AgentHealth, AgentDetect, RegisterPlan } from '@shared/types'
import { useStore } from '../store'
import { useNotifications } from '../notificationStore'
import { ipc } from '../ipc'
import { getTrackable } from '../trackables'
import { useHint } from '../hint'
import { highlight } from '../highlight'
import { ContextMenu, type CtxItem } from './ContextMenu'
import { ViewSettingsMenu } from './ViewSettingsMenu'
import { Modal } from './Modal'

const HEALTH_COLOR: Record<AgentHealth, string> = {
  active: '#3fb950',
  mismatch: '#f5a623',
  missing: '#e5484d',
  not_found: '#8a8a8a'
}
const HEALTH_LABEL: Record<AgentHealth, string> = {
  active: 'active',
  mismatch: 'mismatch',
  missing: 'missing',
  not_found: 'not found'
}
const BUTTON_LABEL: Record<AgentHealth, string> = {
  active: 'Unregister',
  mismatch: 'Fix',
  missing: 'Register',
  not_found: 'Register'
}

function HealthIcon({ health }: { health: AgentHealth }): JSX.Element {
  const c = HEALTH_COLOR[health]
  if (health === 'active') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="7" fill="none" stroke={c} strokeWidth="1.6" />
        <path d="M5 8l2 2 4-4" fill="none" stroke={c} strokeWidth="1.6" />
      </svg>
    )
  }
  if (health === 'mismatch') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16">
        <path d="M8 2l6 12H2z" fill="none" stroke={c} strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M8 6.5v3.5M8 12v.5" stroke={c} strokeWidth="1.6" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="7" fill="none" stroke={c} strokeWidth="1.6" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke={c} strokeWidth="1.6" />
    </svg>
  )
}

function statusText(a: AgentInfo): string {
  if (a.health === 'active') return 'Registered — serves all managed projects'
  if (a.health === 'mismatch') return a.problem ?? 'Registered with a different URL'
  if (a.health === 'missing') return 'Present, not registered'
  return 'Not found'
}

function healthHintText(a: AgentInfo): string {
  if (a.health === 'active') return "Our server is registered; it serves every project this app manages"
  if (a.health === 'mismatch') return a.problem ?? 'Registered with a different URL'
  if (a.health === 'missing') return 'Agent present but our server is not registered'
  return 'Agent not found on this machine'
}

/** Confirmation showing exactly what will be written, over what. */
function RegisterDialog({
  plan,
  busy,
  onConfirm,
  onClose
}: {
  plan: RegisterPlan
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}): JSX.Element {
  const verb = plan.willOverwrite ? 'Replace registration' : 'Register'
  return (
    <Modal title={`${verb}: ${plan.name}`} onClose={onClose} width={520}>
      <div className="agent-plan">
        <div className="agent-plan-row">
          <span className="agent-plan-key">Config</span>
          <span className="agent-plan-val mono">{plan.configPath}</span>
        </div>
        <div className="agent-plan-row">
          <span className="agent-plan-key">Scope</span>
          <span className="agent-plan-val">{plan.scope}</span>
        </div>
        {plan.willOverwrite ? (
          <>
            <div className="agent-plan-diff">
              <div className="agent-plan-diff-label">Replace</div>
              <div className="agent-plan-old mono">{plan.before}</div>
              <div className="agent-plan-diff-label">with</div>
              <div className="agent-plan-new mono">{plan.after}</div>
            </div>
          </>
        ) : plan.present ? (
          <div className="agent-plan-note">
            Already registered with this URL — re-writing is a no-op.
          </div>
        ) : (
          <div className="agent-plan-diff">
            <div className="agent-plan-diff-label">Add</div>
            <div className="agent-plan-new mono">{plan.after}</div>
          </div>
        )}
        <div className="agent-plan-note">A backup of the current file is saved first.</div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-sm" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-sm btn-primary" onClick={onConfirm} disabled={busy}>
          {busy ? 'Writing…' : verb}
        </button>
      </div>
    </Modal>
  )
}

/** Popup listing only the agents actually detected on the machine. */
function DetectDialog({
  detected,
  busy,
  onRegisterAll,
  onClose
}: {
  detected: AgentDetect[]
  busy: boolean
  onRegisterAll: () => void
  onClose: () => void
}): JSX.Element {
  return (
    <Modal title="Detected agents" onClose={onClose} width={520}>
      {detected.length === 0 ? (
        <div className="agent-plan-note">No agent configs were found on this machine.</div>
      ) : (
        <div className="detect-list">
          {detected.map((d) => (
            <div className="detect-row" key={d.id}>
              <div className="detect-main">
                <div className="detect-name">{d.name}</div>
                <div className="detect-path mono">{d.configPath}</div>
              </div>
              <span className="agent-health" style={{ color: HEALTH_COLOR[d.health] }}>
                {HEALTH_LABEL[d.health]}
                <HealthIcon health={d.health} />
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="modal-actions">
        <button className="btn btn-sm" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={onRegisterAll}
          disabled={busy || detected.length === 0}
        >
          {busy ? 'Registering…' : 'Register all'}
        </button>
      </div>
    </Modal>
  )
}

function AgentRow({
  a,
  root,
  onRefresh
}: {
  a: AgentInfo
  root: string | null
  onRefresh: () => void
}): JSX.Element {
  const toast = useNotifications((s) => s.toast)
  const addTracker = useStore((s) => s.addTracker)
  const trackers = useStore((s) => s.trackers)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [plan, setPlan] = useState<RegisterPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const healthHint = useHint(healthHintText(a))

  const tracked = trackers.some(
    (t) => t.definitionId === 'agent.health' && t.params?.agent === a.id
  )
  const items: CtxItem[] = [
    {
      label: 'Reveal config in file explorer',
      disabled: !a.found,
      onClick: () => void ipc.revealInOS(a.configPath)
    },
    {
      label: 'Reveal project in file explorer',
      disabled: !root,
      onClick: () => {
        if (root) void ipc.revealInOS(root)
      }
    },
    {
      label: 'Open latest backup',
      onClick: () => {
        void ipc.agentsOpenBackup(a.id).then((ok) => {
          if (!ok) toast({ title: `No backups yet for ${a.name}`, color: '#8b92a5' })
        })
      }
    },
    { sep: true },
    tracked
      ? { label: `Tracking ${a.name} health`, disabled: true, hint: 'Already tracked' }
      : {
          label: `Track ${a.name} health`,
          onClick: () => {
            const d = getTrackable('agent.health')
            if (d) addTracker('agent.health', { view: 'overview', anchor: null }, { agent: a.id })
          }
        }
  ]

  const startRegister = (): void => {
    setBusy(true)
    void ipc
      .agentsPlanRegister(a.id)
      .then((p) => setPlan(p))
      .catch((e) => toast({ title: `Plan failed: ${String(e)}`, color: '#e5484d' }))
      .finally(() => setBusy(false))
  }

  const confirmRegister = (): void => {
    setBusy(true)
    void ipc
      .agentsRegister(a.id)
      .then(() => {
        toast({ title: `${a.name} registered`, color: '#3fb950' })
        setPlan(null)
        onRefresh()
      })
      .catch((e) => toast({ title: `Register failed: ${String(e)}`, color: '#e5484d' }))
      .finally(() => setBusy(false))
  }

  const unregister = (): void => {
    if (!window.confirm(`Unregister ${a.name}?\n\nOur server entry will be removed from:\n${a.configPath}\n\nA backup is saved first.`)) {
      return
    }
    setBusy(true)
    void ipc
      .agentsUnregister(a.id)
      .then(() => {
        toast({ title: `${a.name} unregistered`, color: '#8b92a5' })
        onRefresh()
      })
      .catch((e) => toast({ title: `Unregister failed: ${String(e)}`, color: '#e5484d' }))
      .finally(() => setBusy(false))
  }

  const onButton = (): void => {
    if (a.health === 'active') unregister()
    else startRegister()
  }

  return (
    <div
      className={`agent-row${a.health === 'not_found' ? ' disabled' : ''}`}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <div className="agent-left">
        <div className="agent-name">{a.name}</div>
        {a.found ? (
          <>
            <div className="agent-meta">{statusText(a)}</div>
            <div className="agent-meta">Config: {a.configPath}</div>
          </>
        ) : (
          <div className="agent-meta">Not found</div>
        )}
      </div>
      <div className="agent-right">
        <span className="agent-health" style={{ color: HEALTH_COLOR[a.health] }} {...healthHint}>
          {HEALTH_LABEL[a.health]}
          <HealthIcon health={a.health} />
        </span>
        <button className="btn btn-sm" disabled={a.health === 'not_found' || busy} onClick={onButton}>
          {BUTTON_LABEL[a.health]}
        </button>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
      {plan && (
        <RegisterDialog
          plan={plan}
          busy={busy}
          onConfirm={confirmRegister}
          onClose={() => setPlan(null)}
        />
      )}
    </div>
  )
}

export function AgentConfigSection({
  agents,
  root,
  onRefresh
}: {
  agents: AgentInfo[]
  root: string | null
  onRefresh: () => void
}): JSX.Element {
  const toast = useNotifications((s) => s.toast)
  const addTracker = useStore((s) => s.addTracker)
  const trackers = useStore((s) => s.trackers)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [detected, setDetected] = useState<AgentDetect[] | null>(null)
  const [busy, setBusy] = useState(false)

  const titleHint = useHint(
    "Register this app's MCP server in the config files of your local AI agents"
  )

  const detect = (): void => {
    setBusy(true)
    void ipc
      .agentsDetect()
      .then((list) => setDetected(list))
      .catch((e) => toast({ title: `Detect failed: ${String(e)}`, color: '#e5484d' }))
      .finally(() => setBusy(false))
  }

  const registerAll = (): void => {
    if (!detected) return
    setBusy(true)
    const ids = detected.map((d) => d.id)
    void (async () => {
      let ok = 0
      for (const id of ids) {
        try {
          await ipc.agentsRegister(id)
          ok++
        } catch (e) {
          toast({ title: `Register failed for ${id}: ${String(e)}`, color: '#e5484d' })
        }
      }
      toast({ title: `Registered ${ok}/${ids.length} agent(s)`, color: '#3fb950' })
      setDetected(null)
      setBusy(false)
      onRefresh()
    })()
  }

  const trackItem = (id: string, label: string): CtxItem => {
    const on = trackers.some((t) => t.definitionId === id && !t.params)
    return on
      ? { label: `Tracking ${label}`, disabled: true, hint: 'Already tracked' }
      : {
          label: `Track ${label}`,
          onClick: () => addTracker(id, { view: 'overview', anchor: null })
        }
  }
  const sectionItems: CtxItem[] = [
    { label: 'Agent settings…', onClick: () => highlight('section.agents', 'settings') },
    { sep: true },
    trackItem('agents.count', 'number of agents'),
    trackItem('agents.missing', 'number of missing agents'),
    trackItem('agents.active', 'number of active agents'),
    trackItem('agents.mismatch', 'number of mismatch agents')
  ]

  return (
    <div
      className="agent-section"
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <div className="agent-head">
        <span className="agent-title" {...titleHint}>
          Agent configurations
        </span>
        <div className="agent-head-actions">
          <ViewSettingsMenu sectionId="agents" label="Agent configuration settings" />
          <button className="btn btn-sm" disabled={busy} onClick={detect}>
            Register detected configs
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              onRefresh()
              toast({ title: 'Refreshed agents', color: '#3fb950' })
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="agent-list">
        {agents.map((a) => (
          <AgentRow key={a.id} a={a} root={root} onRefresh={onRefresh} />
        ))}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={sectionItems} onClose={() => setMenu(null)} />
      )}
      {detected && (
        <DetectDialog
          detected={detected}
          busy={busy}
          onRegisterAll={registerAll}
          onClose={() => setDetected(null)}
        />
      )}
    </div>
  )
}
