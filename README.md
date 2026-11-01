# Overseer

A VS Code-inspired code editor built on Electron, Vite, React, and the Monaco
editor. Cross-platform (Windows + Linux). This repository is the runnable **v1**
scaffold plus the architecture decision records that guide future work.
Project is a proof of concept for using MCP protocol as a agent/project coordiantion server where
AI agents are guided by predefined guidelines, tools and coordination files provided by server 

# How to use:
-Change project (select local dir or clone from git)
-Scaffold coordination files needed for agent coordination
-Change coordination files for said task 
-Sit back as agents work on tasks from PBI and manage their work in Hub


## Requirements

- Node.js 18+ (Node 20 LTS recommended)
- npm 9+

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` launches the app with Electron + Vite HMR. Use **File → Open
Folder** (or `Ctrl/Cmd+O`) to open a project.

> Note: this scaffold was authored in an offline environment, so dependencies
> were not installed and the app was not booted there. Run `npm install` locally
> to fetch dependencies before `npm run dev`.

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Run the app in development with HMR |
| `npm run build` | Type-agnostic production build into `out/` |
| `npm run preview` | Preview the production build |
| `npm run typecheck` | Type-check main/preload and renderer (after `npm install`) |
| `npm run package:win` | Build a Windows NSIS installer |
| `npm run package:linux` | Build Linux AppImage + deb |

## Keyboard shortcuts

- `Ctrl/Cmd+O` — Open folder
- `Ctrl/Cmd+S` — Save
- `Ctrl/Cmd+Shift+S` — Save As (stubbed, see below)
- `Ctrl/Cmd+W` — Close tab
- `Ctrl/Cmd+B` — Toggle sidebar
- `Ctrl/Cmd+,` — Open Settings
- Middle-click a tab to close it
- Right-click in the file tree for New File / New Folder / Rename / Delete
- Find/replace is Monaco's built-in (`Ctrl/Cmd+F`, `Ctrl/Cmd+H`)

## What works

- App shell: activity bar, file explorer sidebar, tabbed editor, status bar
- Open a folder as a workspace
- Virtualized, lazily-loaded file explorer
- Monaco editor with one instance swapping models per tab; per-tab view state
  (cursor/scroll/folding) preserved on tab switch
- Dirty tracking (● indicator) via Monaco's alternative version id
- Open / Save
- Live file watching: the tree refreshes on external changes; a clean open file
  reloads automatically, a dirty one is flagged (⚠)
- Command registry + keybindings + native menus (one dispatch path)
- Per-workspace persistence (open tabs, active tab, expanded folders)
- File-tree context menu: New File / New Folder / Rename / Delete
- Middle-click a tab to close it
- Multiple **views** with different UI topologies (Explorer, Settings),
  switched from the left dashboard. State is preserved across views — leaving
  Explorer and returning keeps your open files, tabs, and cursor positions.
- **Settings view** with the dark/light theme switch (persisted)
- A reusable **hover-hint** system: any element can opt into a tooltip via
  `useHint('...')`; elements without a hint behave normally

## Adding a new view

Views are the primary extension point for new top-level UI. To add one: extend
the `ViewId` union in `store.ts`, add an entry to `VIEWS` in `ActivityBar.tsx`
(with `position: 'top' | 'bottom'`), and add a render branch in `App.tsx`.
Because all state lives in the store and Monaco models live in the model
manager, switching views preserves everything automatically.

## Wired but not yet surfaced (next increment)

- Save As (needs a native save-dialog channel)
- Rename of a file with unsaved edits is blocked with a prompt to save first
  (in-place buffer migration on rename is future work)

## Out of scope for v1 (see ADRs)

Extension host, LSP/IntelliSense, integrated terminal, debugging, git,
cross-file search, settings UI. Each has a seam left in the architecture.

## Architecture

Decisions are recorded in [`docs/adr`](docs/adr/README.md). The short version:

- **electron-vite** with four source roots — `main`, `preload`, `renderer`,
  `shared`.
- The renderer has **no** filesystem access. All disk I/O, watching, and dialogs
  live in `main` and cross a **typed IPC contract** defined in `src/shared`.
- Security: `contextIsolation`, `sandbox`, no `nodeIntegration`, strict CSP,
  blocked remote navigation.
- Monaco is an imperative island — React never re-renders it. Workers load via
  the manual Vite `?worker` pattern.
- A **model manager** separates the file on disk, the open tab, and the Monaco
  buffer, and owns model lifecycle, view state, and dirty tracking.

## Project structure

```
src/
  main/        app lifecycle, window, native menu, fs I/O, watcher, IPC server
  preload/     contextBridge surface (allowlisted, typed)
  renderer/    React shell + Monaco host
  shared/      IPC contract + domain types (imported by all sides)
docs/adr/      architecture decision records
```

## License

MIT
