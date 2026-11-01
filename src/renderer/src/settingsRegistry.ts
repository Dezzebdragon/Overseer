import type { OSPlatform, OSCommand } from '@shared/terminal-commands'
import { TERMINAL_CD, AGENT_RUN } from '@shared/terminal-commands'

export type SettingType = 'checkbox' | 'select' | 'command'

export interface SettingOption {
  value: string
  label: string
  /** Per-option hint. */
  description: string
}

export interface SettingDef {
  id: string
  label: string
  /** Shown below the control in the Settings view, and on hover in the popover. */
  description: string
  type: SettingType
  /** 'view' = ephemeral per-view store; 'app' = persisted AppSettings (id must be a key). */
  binding: 'view' | 'app'
  default?: boolean
  /** For select settings. */
  options?: SettingOption[]
  defaultValue?: string
  /**
   * For command settings: a human-readable template shown in the hint/description,
   * and a RegExp source the edited value must match to pass the integrity check.
   * Command settings persist under AppSettings.agentCommands keyed by this def's id.
   */
  commandTemplate?: string
  commandPattern?: string
  /**
   * For per-OS command settings: default value/template/pattern per platform. When
   * present, the control shows a platform dropdown and stores each platform's value
   * under agentCommands["<id>:<platform>"]; single-value commands omit this.
   */
  osVariants?: Record<OSPlatform, OSCommand>
}

export interface SettingsSection {
  id: string
  title: string
  settings: SettingDef[]
}

/**
 * Single source of truth for view-scoped settings. Each section renders in the
 * Settings view (description below each control) and in that view's settings
 * popover (description on hover).
 */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: 'explorer',
    title: 'Explorer',
    settings: [
      {
        id: 'explorerShowHidden',
        label: 'Show hidden files',
        description: 'Show files and folders whose names start with “.” in the file tree.',
        type: 'checkbox',
        binding: 'app',
        default: false
      },
      {
        id: 'explorerShowDeleted',
        label: 'Show deleted files',
        description:
          'Show files that no longer exist (deleted from disk but present in git history) as red ghost nodes; opening one shows its last committed version.',
        type: 'checkbox',
        binding: 'app',
        default: false
      }
    ]
  },
  {
    id: 'notifications',
    title: 'Notifications',
    settings: [
      {
        id: 'toastDuration',
        label: 'Toast duration',
        description: 'How long a toast stays before it fades.',
        type: 'select',
        binding: 'app',
        defaultValue: '3500',
        options: [
          { value: '2000', label: '2 seconds', description: 'Dismiss toasts after 2s.' },
          { value: '3500', label: '3.5 seconds', description: 'Dismiss toasts after 3.5s.' },
          { value: '6000', label: '6 seconds', description: 'Dismiss toasts after 6s.' }
        ]
      },
      {
        id: 'muteError',
        label: 'Mute error notifications',
        description: 'Suppress error toasts and notifications.',
        type: 'checkbox',
        binding: 'app',
        default: false
      },
      {
        id: 'muteWarning',
        label: 'Mute warning notifications',
        description: 'Suppress warning toasts and notifications.',
        type: 'checkbox',
        binding: 'app',
        default: false
      },
      {
        id: 'muteInfo',
        label: 'Mute info notifications',
        description: 'Suppress info toasts and notifications.',
        type: 'checkbox',
        binding: 'app',
        default: false
      }
    ]
  },
  {
    id: 'git',
    title: 'Git',
    settings: []
  },
  {
    id: 'pipeline',
    title: 'Pipeline',
    settings: [
      {
        id: 'pipelineShowAgent',
        label: 'Show agent on cards',
        description: 'Display the assigned agent on each task card.',
        type: 'checkbox',
        binding: 'app',
        default: true
      },
      {
        id: 'pipelineShowPriority',
        label: 'Show priority on cards',
        description: 'Display the priority tag on each task card.',
        type: 'checkbox',
        binding: 'app',
        default: true
      }
    ]
  },
  {
    id: 'hub',
    title: 'Hub',
    settings: [
      {
        id: 'hubRequirement',
        label: 'Project file requirement',
        description: 'Which template(s) determine the required files for a project.',
        type: 'select',
        binding: 'app',
        defaultValue: 'project',
        options: [
          {
            value: 'default',
            label: 'Default',
            description: 'Required files for the project are based on the default (built-in) template.'
          },
          {
            value: 'project',
            label: 'Project',
            description: 'Required files for the project are based on the scaffolded template.'
          },
          {
            value: 'default+project',
            label: 'Default + Project',
            description:
              'Required files are based on the default (built-in) plus the scaffolded template.'
          }
        ]
      }
    ]
  },
  {
    id: 'logs',
    title: 'Logs',
    settings: [
      {
        id: 'logsAutoScroll',
        label: 'Auto-scroll to newest',
        description: 'Keep the log pinned to the most recent entry as new lines arrive.',
        type: 'checkbox',
        binding: 'app',
        default: true
      },
      {
        id: 'logsUseProjectDir',
        label: 'Auto set to project directory',
        description: 'Open new terminals in the current project by running the cd command below.',
        type: 'checkbox',
        binding: 'app',
        default: true
      },
      {
        id: 'logsAutoStartAgents',
        label: 'Auto start agents',
        description:
          'When opening an agent terminal, automatically run that agent’s launch command.',
        type: 'checkbox',
        binding: 'app',
        default: true
      },
      {
        id: 'terminalCd',
        label: 'Project directory command',
        description:
          'Typed into a new terminal to switch to the current project. Use ${projectDir} for the path.',
        type: 'command',
        binding: 'app',
        osVariants: TERMINAL_CD
      },
      {
        id: 'agentRun.claude-code',
        label: 'Claude Code launch command',
        description: 'Typed into an agent terminal to start Claude Code.',
        type: 'command',
        binding: 'app',
        osVariants: AGENT_RUN['claude-code']
      },
      {
        id: 'agentRun.codex',
        label: 'Codex launch command',
        description: 'Typed into an agent terminal to start Codex.',
        type: 'command',
        binding: 'app',
        osVariants: AGENT_RUN.codex
      }
    ]
  },
  {
    id: 'tools',
    title: 'Tools',
    settings: [
      {
        id: 'toolsShowDisabled',
        label: 'Show disabled tools',
        description: 'List tools that are currently turned off alongside active ones.',
        type: 'checkbox',
        binding: 'app',
        default: false
      }
    ]
  },
  {
    id: 'templates',
    title: 'Templates',
    settings: [
      {
        id: 'initGitOnScaffold',
        label: 'Initialize git on scaffold',
        description: 'Run "git init" when initializing a project (only if it is not already a repo).',
        type: 'checkbox',
        binding: 'app',
        default: true
      },
      {
        id: 'generateConfig',
        label: 'Generate big-mcp.config.json',
        description: 'Create the project config file when initializing a project.',
        type: 'checkbox',
        binding: 'app',
        default: true
      },
      {
        id: 'generateState',
        label: 'Generate big-state.json',
        description: 'Create the project state file when initializing a project.',
        type: 'checkbox',
        binding: 'app',
        default: true
      },
      {
        id: 'requireAllFiles',
        label: 'Require all template files',
        description:
          'A project counts as initialized only if every enabled template file is present.',
        type: 'checkbox',
        binding: 'app',
        default: true
      }
    ]
  },
  {
    id: 'agents',
    title: 'Agent configuration',
    settings: [
      {
        id: 'mcpServerUrl',
        label: 'MCP server URL',
        description:
          "The URL written into each agent's MCP config when you register this app's server. " +
          'Root-agnostic: the active project is resolved at request time, so one URL serves every ' +
          'managed project. Changing this is dangerous — it must point at this app\'s MCP server.',
        type: 'command',
        binding: 'app',
        defaultValue: 'http://127.0.0.1:4517/mcp',
        commandTemplate: 'http://127.0.0.1:{port}/mcp',
        commandPattern: '^https?://[^\\s/]+/mcp(\\?\\S*)?$'
      }
    ]
  }
]

export function getSettingsSection(id: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((s) => s.id === id)
}
