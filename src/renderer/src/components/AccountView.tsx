import { useEffect, useState } from 'react'
import type { GithubAccount } from '@shared/types'
import { useAccountStore } from '../accountStore'

function Avatar({ account, small }: { account: GithubAccount; small?: boolean }): JSX.Element {
  const size = small ? 22 : 32
  const [failed, setFailed] = useState(false)
  const letter = (account.name || account.login || '?').trim().charAt(0).toUpperCase()
  if (account.avatarUrl && !failed) {
    return (
      <img
        className="account-avatar"
        src={account.avatarUrl}
        width={size}
        height={size}
        alt=""
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <span
      className="account-avatar account-avatar-fallback"
      style={{ width: size, height: size, fontSize: small ? 10 : 14 }}
    >
      {letter}
    </span>
  )
}

export function AccountView(): JSX.Element {
  const store = useAccountStore()
  const [clientIdInput, setClientIdInput] = useState('')

  useEffect(() => {
    store.init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setClientIdInput(store.clientId ?? '')
  }, [store.clientId])

  const saveClientId = (): void => {
    const v = clientIdInput.trim()
    if (v !== (store.clientId ?? '')) void store.setClientId(v)
  }

  return (
    <div className="view view-settings view-account">
      <div className="settings-panel">
        <h1>Account</h1>
        <p className="settings-desc">
          Connect a GitHub account to clone your repositories — all in-app.
        </p>

        <div className="settings-section">
          <div className="settings-section-title">GitHub OAuth App</div>
          <label className="account-field">
            <span className="settings-label">Client ID</span>
            <input
              className="account-input"
              value={clientIdInput}
              placeholder="Iv23li…"
              onChange={(e) => setClientIdInput(e.target.value)}
              onBlur={saveClientId}
              onKeyDown={(e) => e.key === 'Enter' && saveClientId()}
            />
          </label>
          <details className="account-help">
            <summary>How to register a GitHub OAuth App</summary>
            <ol>
              <li>On GitHub: Settings → Developer settings → OAuth Apps → “New OAuth App”.</li>
              <li>Enter any App name and Homepage URL (the callback URL can be http://localhost).</li>
              <li>Tick “Enable Device Flow”, then click “Register application”.</li>
              <li>Copy the Client ID and paste it above — no client secret is needed.</li>
            </ol>
            <p className="account-help-note">
              The Client ID isn’t a secret; it’s safe to store in the app.
            </p>
          </details>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Connection</div>
          {store.connected ? (
            <div className="account-card">
              <Avatar account={store.connected} />
              <div className="account-id">
                <div className="account-login">@{store.connected.login}</div>
                <div className="settings-desc">
                  {store.connected.name ? `${store.connected.name} · ` : ''}connected
                </div>
              </div>
              <button className="btn btn-ghost" onClick={() => void store.disconnect()}>
                Disconnect
              </button>
            </div>
          ) : store.connecting ? (
            <div className="account-flow">
              {store.deviceCode ? (
                <>
                  <div className="settings-desc">
                    Enter this code in the GitHub window that opened:
                  </div>
                  <div className="account-code">{store.deviceCode.userCode}</div>
                  <div className="settings-desc">Waiting for authorization…</div>
                </>
              ) : (
                <div className="settings-desc">Starting…</div>
              )}
              <button className="btn btn-ghost" onClick={() => void store.cancelConnect()}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button
                className="btn btn-primary"
                disabled={!store.clientId}
                onClick={() => void store.beginConnect()}
              >
                Connect GitHub account
              </button>
              {!store.clientId && (
                <div className="settings-desc">Add a Client ID above to enable connecting.</div>
              )}
            </>
          )}
          {store.authError && <div className="account-error">{store.authError}</div>}
          <details className="account-help">
            <summary>How to connect</summary>
            <p>
              Click Connect — a GitHub window opens inside the app. Enter the code shown, authorize,
              and you’re signed in. Your token is stored in the OS keychain; only the current account
              keeps a saved token.
            </p>
          </details>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Recent accounts</div>
          {store.accounts.length === 0 ? (
            <div className="settings-desc">No accounts yet.</div>
          ) : (
            store.accounts.map((a) => {
              const isCurrent = a.login === store.connected?.login
              return (
                <div key={a.login} className={`account-row${isCurrent ? ' current' : ''}`}>
                  <Avatar account={a} small />
                  <span className="account-login">@{a.login}</span>
                  {isCurrent ? (
                    <span className="account-current">current</span>
                  ) : (
                    <button className="account-link" onClick={() => void store.beginConnect()}>
                      Reconnect
                    </button>
                  )}
                  <button className="account-forget" onClick={() => void store.forget(a.login)}>
                    Forget
                  </button>
                </div>
              )
            })
          )}
          <div className="settings-desc account-note">
            Only the current account keeps a saved token; others reconnect when selected. The last
            account is reselected on restart.
          </div>
        </div>
      </div>
    </div>
  )
}
