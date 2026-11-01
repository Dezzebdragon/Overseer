# 0011 — Workspace and state persistence

**Status:** Accepted

## Context
Users expect to reopen a folder and land where they left off — same tabs, same
expanded folders. Global preferences (theme) should persist independently of any
one workspace. Concurrent or crash-interrupted writes must not corrupt state.

## Decision
Per-workspace state (open tabs, active tab, expanded dirs) is stored at
`userData/workspaces/<sha1(path)>/state.json`. Global settings live in
`userData/settings.json`. Writes are debounced and atomic (temp + rename). On
open, main returns the persisted state with the root listing; the renderer
restores expanded dirs and re-opens tabs, tolerating paths that no longer exist.

## Consequences
- Reopening a workspace restores its layout; settings are shared across all.
- A workspace is one folder in v1; multi-root is a config-file feature later,
  and the state shape leaves room for it.
- Cross-session cursor/scroll restore is deferred (ADR-0007).
