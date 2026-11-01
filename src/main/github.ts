import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { BrowserWindow, safeStorage } from 'electron'
import type {
  AccountState,
  DeviceCodeInfo,
  GithubAccount,
  GithubRepo
} from '@shared/types'
import { getAppDataDir } from './paths'
import {
  getAccounts,
  getOauthClientId,
  getSelectedAccount,
  removeAccount,
  setOauthClientId,
  setSelectedAccount,
  upsertAccount,
  addRecentProject
} from './registry'

const exec = promisify(execFile)
const SCOPE = 'repo read:user'
const TOKEN_FILE = (): string => join(getAppDataDir(), 'github-token.bin')

// ---- token storage (safeStorage; only the active account keeps one) ----

async function saveToken(token: string): Promise<void> {
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(token)
    : Buffer.from(token, 'utf8')
  await fs.writeFile(TOKEN_FILE(), buf)
}

async function loadToken(): Promise<string | null> {
  try {
    const buf = await fs.readFile(TOKEN_FILE())
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf8')
  } catch {
    return null
  }
}

async function clearToken(): Promise<void> {
  try {
    await fs.unlink(TOKEN_FILE())
  } catch {
    /* already gone */
  }
}

// ---- github REST helpers ---------------------------------------------

async function gh<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'custom-ide'
    }
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  return (await res.json()) as T
}

interface GhUser {
  login: string
  name: string | null
  avatar_url: string | null
}

async function fetchUser(token: string): Promise<GithubAccount> {
  const u = await gh<GhUser>('/user', token)
  return { login: u.login, name: u.name ?? null, avatarUrl: u.avatar_url ?? null }
}

// ---- connection state ------------------------------------------------

let connected: GithubAccount | null = null

async function state(): Promise<AccountState> {
  return {
    clientId: await getOauthClientId(),
    accounts: await getAccounts(),
    selectedAccount: await getSelectedAccount(),
    connected
  }
}

export async function accountGet(): Promise<AccountState> {
  return state()
}

export async function accountSetClientId(id: string | null): Promise<AccountState> {
  await setOauthClientId(id)
  return state()
}

/** Restore the last account on launch if its token is still valid. */
export async function accountRestore(): Promise<AccountState> {
  const selected = await getSelectedAccount()
  const token = await loadToken()
  if (selected && token) {
    try {
      const user = await fetchUser(token)
      if (user.login === selected) connected = user
    } catch {
      connected = null // token expired/revoked; keep in recents to reconnect
    }
  }
  return state()
}

export async function accountDisconnect(): Promise<AccountState> {
  connected = null
  await clearToken()
  await setSelectedAccount(null)
  return state()
}

export async function accountForget(login: string): Promise<AccountState> {
  if (connected?.login === login) {
    connected = null
    await clearToken()
  }
  await removeAccount(login)
  return state()
}

// ---- device flow (fully in-app) --------------------------------------

interface DeviceStart {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}
interface DevicePoll {
  access_token?: string
  error?: string
  interval?: number
}

let authWindow: BrowserWindow | null = null
let cancelFlag = false

function openAuthWindow(url: string, parent: BrowserWindow | null): void {
  authWindow?.close()
  authWindow = new BrowserWindow({
    width: 520,
    height: 680,
    parent: parent ?? undefined,
    modal: false,
    title: 'Authorize on GitHub',
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })
  void authWindow.loadURL(url)
  authWindow.on('closed', () => {
    authWindow = null
  })
}

/**
 * Start device flow: request a code, open the GitHub verification page in an
 * in-app window, and begin polling. Resolves with the code to display; the
 * connected account arrives via the `onDone`/`onError` callbacks.
 */
export async function accountBeginConnect(
  parent: BrowserWindow | null,
  onDone: (s: AccountState) => void,
  onError: (msg: string) => void
): Promise<DeviceCodeInfo> {
  const clientId = await getOauthClientId()
  if (!clientId) throw new Error('Set a GitHub OAuth App Client ID first.')
  cancelFlag = false

  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: SCOPE })
  })
  if (!res.ok) throw new Error(`Device code request failed (${res.status})`)
  const start = (await res.json()) as DeviceStart

  openAuthWindow(start.verification_uri, parent)

  // poll in the background
  void (async () => {
    let interval = (start.interval || 5) * 1000
    const deadline = Date.now() + start.expires_in * 1000
    while (!cancelFlag && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval))
      if (cancelFlag) return
      try {
        const pr = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: clientId,
            device_code: start.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          })
        })
        const poll = (await pr.json()) as DevicePoll
        if (poll.access_token) {
          await saveToken(poll.access_token)
          const user = await fetchUser(poll.access_token)
          connected = user
          await upsertAccount(user)
          authWindow?.close()
          onDone(await state())
          return
        }
        if (poll.error === 'authorization_pending') continue
        if (poll.error === 'slow_down') {
          interval += 5000
          continue
        }
        // access_denied / expired_token / etc.
        authWindow?.close()
        onError(poll.error ?? 'Authorization failed')
        return
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Authorization failed')
        return
      }
    }
    if (!cancelFlag) onError('Authorization timed out')
  })()

  return { userCode: start.user_code, verificationUri: start.verification_uri }
}

export function accountCancelConnect(): void {
  cancelFlag = true
  authWindow?.close()
}

// ---- repos + clone ---------------------------------------------------

interface GhRepo {
  full_name: string
  name: string
  clone_url: string
  private: boolean
  description: string | null
  updated_at: string
}

export async function githubListRepos(): Promise<GithubRepo[]> {
  const token = await loadToken()
  if (!token || !connected) throw new Error('Not connected.')
  const repos = await gh<GhRepo[]>('/user/repos?per_page=100&sort=updated', token)
  return repos.map((r) => ({
    fullName: r.full_name,
    name: r.name,
    cloneUrl: r.clone_url,
    private: r.private,
    description: r.description,
    updatedAt: r.updated_at
  }))
}

/** Clone into <destParent>/<repo-name>; token passed transiently, never saved. */
export async function githubClone(
  cloneUrl: string,
  destParent: string
): Promise<{ path: string }> {
  const token = await loadToken()
  const name = (cloneUrl.split('/').pop() ?? 'repo').replace(/\.git$/, '')
  const dest = join(destParent, name)

  const args = ['clone']
  if (token) {
    // transient auth header — nothing written to .git/config
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
    args.push('-c', `http.extraheader=AUTHORIZATION: basic ${basic}`)
  }
  args.push(cloneUrl, dest)
  await exec('git', args, { maxBuffer: 32 * 1024 * 1024 })
  await addRecentProject(dest)
  return { path: dest }
}
