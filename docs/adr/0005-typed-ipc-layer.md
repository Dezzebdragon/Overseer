# 0005 — Typed IPC layer

**Status:** Accepted

## Context
With the renderer sandboxed, every capability crosses an IPC boundary. Untyped
`ipcMain.handle` / `ipcRenderer.invoke` sprawl drifts out of sync and offers no
compile-time safety. We also need first-class push streams (file-watch events),
not only request/response.

## Decision
A hand-rolled typed layer with the contract in `src/shared/ipc.ts`: a
`RequestMap` (channel → args/return) for invoke/handle, and an `EventMap` for
main→renderer streams. The preload exposes a minimal `invoke`/`on` bridge that
enforces a channel allowlist. Not electron-trpc — the dependency and tRPC
concepts are not worth it when needs are this concrete and streaming is central.

## Consequences
- New capability = one contract line + one handler, both type-checked.
- The allowlist means the renderer can only reach known channels.
- We maintain a small amount of glue ourselves rather than adopting a framework;
  intentional, for transparency and control.
