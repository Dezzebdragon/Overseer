# 0003 — Renderer: React + Zustand + CSS

**Status:** Accepted

## Context
The shell needs a UI framework and a state solution. Monaco is imperative and
must not be driven by a virtual DOM. We want a large component ecosystem (a
virtualized tree exists for React) and state we can read/write from outside the
React render cycle (IPC events must update UI without a component in scope).

## Decision
React for the shell, Zustand for state, plain CSS with `data-theme` theming.
Monaco is an isolated imperative island: mounted via a ref, never re-rendered by
React, never fed text through React state.

## Consequences
- Zustand's imperative `getState()` lets IPC handlers and commands mutate state
  directly — the deciding factor over Redux.
- Discipline required: the editor/React boundary must stay strict or performance
  and correctness suffer.
- Solid/Svelte would reduce reconciliation overhead but cost ecosystem; the
  shell is not update-heavy enough to justify that trade.
