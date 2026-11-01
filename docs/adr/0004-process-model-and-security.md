# 0004 — Process model and security posture

**Status:** Accepted

## Context
Electron's security depends on isolating the renderer from Node and the OS. A
naive setup (nodeIntegration on, no context isolation) is a remote-code-execution
liability. We also need a process model that scales to future language servers,
terminals, and search without freezing the UI.

## Decision
v1 runs main + renderer + preload. The renderer has **no** filesystem access —
all disk I/O, watching, and dialogs live in main and cross via IPC. Window
settings: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
A strict CSP, blocked `will-navigate` to remote origins, and a deny-by-default
window-open handler are set now, not retrofitted. Future terminal (`node-pty`),
LSP servers, and cross-file search each run in their own **utility process**.

## Consequences
- Renderer compromise cannot touch the filesystem directly.
- All capability flows through the typed IPC contract (ADR-0005), which is also
  where future utility-process work attaches.
- Sandbox constrains the preload to `contextBridge` + `ipcRenderer`; anything
  more becomes a reviewed, deliberate exception.
