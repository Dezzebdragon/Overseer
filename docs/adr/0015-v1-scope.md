# 0015 — v1 scope boundary

**Status:** Accepted

## Context
"VS Code-like" is unbounded. We need a crisp line so v1 ships and later features
attach cleanly rather than forcing rework.

## Decision
**In scope:** app shell (activity bar, sidebar, editor area, status bar); open a
folder as a workspace; virtualized lazy file explorer; tabbed Monaco with model
management, view state, and dirty tracking; open / save / save-as; find & replace
(Monaco built-in); external-change detection; command + keybinding + native
menus; per-workspace state persistence; light/dark theme.

**Out of scope (seams left):** extension host, LSP/IntelliSense for arbitrary
languages, integrated terminal, debugging, git integration, cross-file search,
settings UI.

## Consequences
- A focused, shippable editor.
- Each out-of-scope item is its own project; the utility-process model (ADR-0004)
  and typed IPC (ADR-0005) are what let them land without reshaping the core.
- Note: in the initial runnable scaffold, create/rename/delete in the tree and
  Save As are wired at the IPC layer but not yet surfaced in the UI; they are the
  immediate next increment.
