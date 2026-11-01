import { create } from 'zustand'
import type { AccountState, DeviceCodeInfo, GithubAccount } from '@shared/types'
import { ipc } from './ipc'
import { useNotifications } from './notificationStore'

interface AccountStore {
  clientId: string | null
  accounts: GithubAccount[]
  selectedAccount: string | null
  connected: GithubAccount | null
  connecting: boolean
  deviceCode: DeviceCodeInfo | null
  authError: string | null

  init: () => void
  refresh: () => Promise<void>
  setClientId: (id: string) => Promise<void>
  beginConnect: () => Promise<void>
  cancelConnect: () => Promise<void>
  disconnect: () => Promise<void>
  forget: (login: string) => Promise<void>
}

const apply = (s: AccountState): Partial<AccountStore> => ({
  clientId: s.clientId,
  accounts: s.accounts,
  selectedAccount: s.selectedAccount,
  connected: s.connected
})

let wired = false

export const useAccountStore = create<AccountStore>((set, get) => ({
  clientId: null,
  accounts: [],
  selectedAccount: null,
  connected: null,
  connecting: false,
  deviceCode: null,
  authError: null,

  init: () => {
    void get().refresh()
    if (wired) return
    wired = true
    window.api.on('account:connected', (s) => {
      set({ ...apply(s), connecting: false, deviceCode: null, authError: null })
      if (s.connected) {
        useNotifications
          .getState()
          .notify({ type: 'info', description: `Connected as @${s.connected.login}`, target: { view: 'account', anchor: null } })
      }
    })
    window.api.on('account:authError', ({ message }) =>
      set({ connecting: false, deviceCode: null, authError: message })
    )
  },

  refresh: async () => {
    set(apply(await ipc.accountGet()))
  },

  setClientId: async (id) => {
    set(apply(await ipc.accountSetClientId(id)))
  },

  beginConnect: async () => {
    if (!get().clientId) {
      set({ authError: 'Set a GitHub OAuth App Client ID first.' })
      return
    }
    set({ connecting: true, authError: null, deviceCode: null })
    try {
      const code = await ipc.accountBeginConnect()
      set({ deviceCode: code })
    } catch (e) {
      set({ connecting: false, authError: e instanceof Error ? e.message : 'Connect failed' })
    }
  },

  cancelConnect: async () => {
    await ipc.accountCancelConnect()
    set({ connecting: false, deviceCode: null })
  },

  disconnect: async () => {
    set(apply(await ipc.accountDisconnect()))
  },

  forget: async (login) => {
    set(apply(await ipc.accountForget(login)))
  }
}))
