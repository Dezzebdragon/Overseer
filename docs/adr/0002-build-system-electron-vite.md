# 0002 — Build system: electron-vite

**Status:** Accepted

## Context
An Electron app has three build targets — main, preload, renderer — each with
different module formats and constraints. Hand-rolling multi-target Vite or
Webpack config is error-prone, especially for fast renderer HMR plus correct
CommonJS output for a sandboxed preload.

## Decision
Use `electron-vite`. Single repository, four source roots: `src/main`,
`src/preload`, `src/renderer`, `src/shared`. TypeScript `strict: true` from the
start. Path aliases `@shared` and `@renderer`.

## Consequences
- Preconfigured main/preload/renderer builds with renderer HMR out of the box.
- `src/shared` is the single source of truth for types and the IPC contract,
  compiled into all three sides, which prevents main/renderer drift.
- We accept a dependency on electron-vite's conventions (entry points, `out/`
  layout). This is a cheap, well-supported trade.
