# 0009 — File explorer / tree

**Status:** Accepted

## Context
A repo tree can hold tens of thousands of nodes. Rendering all of them, or
eagerly walking the filesystem, is untenable. We also want standard tree
behaviors (keyboard nav, selection, rename, drag) without rebuilding them.

## Decision
Use `react-arborist` as a controlled tree (`data` prop). Directories are
"internal" (children is an array); files are leaves (no children). Load a
directory's children lazily on expand via IPC `dir:read`. The tree is
virtualized, so only visible rows render.

## Consequences
- An unexpanded `node_modules` costs nothing until opened.
- We own data mutations (arborist is controlled), which is what lets fs-watch
  events merge cleanly into the tree (ADR-0010).
- Escape hatch: if arborist's model constrains us, a headless tree over
  `react-window` is a localized swap confined to `FileExplorer.tsx`.
