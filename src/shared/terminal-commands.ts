/**
 * Per-OS defaults for the terminal commands the app auto-runs (project cd + agent
 * launch). Shared so the renderer settings registry and the main process resolve
 * the exact same values. Users can override any of these per platform in Logs
 * settings (stored under AppSettings.agentCommands, keyed "<id>:<platform>").
 */

export type OSPlatform = 'mac' | 'windows' | 'linux'
export const OS_PLATFORMS: OSPlatform[] = ['mac', 'windows', 'linux']
export const OS_LABEL: Record<OSPlatform, string> = {
  mac: 'macOS',
  windows: 'Windows',
  linux: 'Linux'
}

export interface OSCommand {
  value: string
  template: string
  /** RegExp source the edited value must match (integrity check). Omit = any non-empty. */
  pattern?: string
}

/** Map Node's process.platform (or navigator hints) to our 3 buckets. */
export function toOSPlatform(nodePlatform: string): OSPlatform {
  if (nodePlatform === 'darwin') return 'mac'
  if (nodePlatform === 'win32') return 'windows'
  return 'linux'
}

/** Replace the ${projectDir} placeholder with an actual path. */
export function substituteProjectDir(command: string, projectDir: string): string {
  return command.split('${projectDir}').join(projectDir)
}

const CD_PATTERN = '\\$\\{projectDir\\}' // must still contain the placeholder

/** "cd into the current project" — the redirect command. */
export const TERMINAL_CD: Record<OSPlatform, OSCommand> = {
  mac: { value: 'cd "${projectDir}"', template: 'cd "${projectDir}"', pattern: CD_PATTERN },
  linux: { value: 'cd "${projectDir}"', template: 'cd "${projectDir}"', pattern: CD_PATTERN },
  // PowerShell-compatible (also works same-drive in cmd).
  windows: { value: 'cd "${projectDir}"', template: 'cd "${projectDir}"', pattern: CD_PATTERN }
}

/** Per-agent launch command, by agent id. Keys must match CLI_AGENTS in main. */
export const AGENT_RUN: Record<string, Record<OSPlatform, OSCommand>> = {
  'claude-code': {
    mac: { value: 'claude', template: 'claude [flags]' },
    linux: { value: 'claude', template: 'claude [flags]' },
    windows: { value: 'claude', template: 'claude [flags]' }
  },
  codex: {
    mac: { value: 'codex', template: 'codex [flags]' },
    linux: { value: 'codex', template: 'codex [flags]' },
    windows: { value: 'codex', template: 'codex [flags]' }
  }
}
