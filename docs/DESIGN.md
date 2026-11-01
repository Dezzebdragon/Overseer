# Custom IDE — Design & Decisions (Handoff)

A living reference for continuing development. It records **every deliberate
decision** — architecture, views, logic, topology, security, persistence,
UI primitives — plus the conventions for extending each system. Pair this with
`docs/adr/` (the numbered ADRs) for the original rationale on the core stack.

> Status: the app is a runnable v1 scaffold plus a growing project‑management
> layer. It has never been booted in the authoring environment (no network to
> `npm install`), but the whole tree type‑checks cleanly apart from
> dependency‑resolution noise. Run `npm install && npm run dev`.

---

## 1. What this app is

A VS Code‑inspired desktop editor (Electron + Monaco) that also hosts a
local‑first **project‑management layer** ported/adapted from a reference app
("Overseer PM"). It edits any folder, and can *initialize* a folder into a
managed **project** (scaffolded docs + config/state) that unlocks PM views
(Hub, and later Pipeline/Git/Account).

---

## 2. Stack & build system (ADR‑0002)

- **Electron** (main + preload + renderer) built by **electron-vite**.
- **React 18** + **Zustand** for the renderer; **plain CSS** (`styles.css`) with
  CSS variables for theming. No Tailwind.
- **Monaco** as the editor, loaded via the manual Vite `?worker` pattern
  (ADR‑0006) — never a Monaco bundler plugin.
- **TypeScript strict** everywhere; project references split node vs web
  (`tsconfig.node.json`, `tsconfig.web.json`).
- **react-arborist** for the file tree; **react-markdown + remark-gfm** for
  markdown preview; **chokidar** for file watching; **simple git via
  `child_process` execFile** for `git init` only (no simple-git dependency yet).
- Path aliases: `@shared` → `src/shared`, `@renderer` → `src/renderer/src`.

No `"type": "module"` in `package.json` (main/preload stay CommonJS so
`__dirname` works and the sandboxed preload is CJS; the renderer is ESM via Vite).

---

## 3. Repository layout — four source roots

```
src/
  main/        app lifecycle, window, native menu, all fs I/O, watcher, IPC server,
               scaffolding, templates, registry, metrics, hub
  preload/     contextBridge surface (allowlisted, typed)
  renderer/    React shell + views + Monaco host + renderer stores
  shared/      IPC contract (ipc.ts) + domain types (types.ts) — imported by all sides
templates/     shipped "default" template (copied to userData on first run)
docs/adr/      architecture decision records
docs/DESIGN.md this file
```

`src/shared` is the single source of truth for cross‑process types and the IPC
contract; it compiles into all three sides, preventing drift.

---

## 4. Process model & security (ADR‑0004)

- Window flags: **`contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`**.
- The **renderer has zero filesystem / OS access.** All disk I/O, dialogs,
  watching, git, and reveal happen in **main** and cross a typed IPC boundary.
- Renderer hardening: strict CSP (`index.html`), `will-navigate` blocked to
  remote origins, deny‑by‑default `setWindowOpenHandler` (external `http(s)`
  opens in the OS browser).
- Preload exposes only a minimal `invoke`/`on` bridge guarded by a **channel
  allowlist** (`REQUEST_CHANNELS`, `EVENT_CHANNELS` in `shared/ipc.ts`).
- Path‑safety in main: template file ops go through `assertInsideTemplates`
  (rejects `..` / absolute paths); project file ops build absolute paths in main.
- Future terminal/LSP/search are intended to run in **utility processes**, never
  in main.

---

## 5. Typed IPC layer (ADR‑0005)

Hand‑rolled, not a framework. `shared/ipc.ts` defines:

- `RequestMap` — channel → `[argsTuple, returnType]` for request/response
  (`ipcRenderer.invoke` / `ipcMain.handle`).
- `EventMap` — channel → payload for main→renderer streams (`fs:changed`,
  `menu:command`).
- `REQUEST_CHANNELS` / `EVENT_CHANNELS` — the preload allowlist arrays.

Main registers handlers via a typed `handle(channel, fn)` wrapper in
`main/ipc.ts`. Renderer calls a typed `invoke(channel, ...args)` and a
convenience object `ipc.*` in `renderer/src/ipc.ts`. **Adding a capability =
one line in `RequestMap` + the channel in `REQUEST_CHANNELS` + one handler +
(optional) one `ipc.*` helper.**

Current channels (grouped): `workspace:open|openPath|close|saveState`,
`projects:recent|pickAndAdd|removeRecent|forget|scaffold|statuses|lastOpened`,
`dir:read`, `file:read|write|create|rename|delete`, `settings:get|set`,
`templates:list|readFile|writeFile|create|duplicate|delete|addFile|deleteFile|setFileRequired|revealFile|getSelected|setSelected`,
`shell:showItem`, `metrics:projectStats`, `hub:files`. Events: `fs:changed`,
`menu:command`.

---

## 6. State management (renderer stores)

Zustand, module‑level stores that persist for the session (cross‑view state is
automatic). Three stores:

- **`store.ts` (`useStore`)** — the app hub: workspace `root`, `workspaceName`,
  file `tree` + `expandedDirs`, editor `tabs`/`activePath`/`dirty`/
  `externallyChanged`/`savedMtime`, `sidebarVisible`, `settings` (AppSettings),
  `activeView`, `recentProjects`, and **custom `trackers`**. Owns project
  lifecycle (`openWorkspace`, `openProjectPath`, `closeProject`,
  `addProjectFolder`, `forgetProject`, `scaffoldProject`), tab/model actions,
  fs‑change application, theme/settings, view switching, and tracker CRUD.
- **`templateStore.ts` (`useTemplateStore`)** — the Templates subsystem:
  `templates`, `activeName`, `selectedName` (the persisted global current
  template), selected file + content, and CRUD/toggle/select actions.
- **`viewSettingsStore.ts` (`useViewSettingsStore`)** — ephemeral per‑view
  setting values keyed by id (for `binding: 'view'` settings).

Rationale for separate stores: templates is a self‑contained subsystem with its
own IPC; keeping it out of the main store avoids a monolith. Note the shared
per‑workspace `state.json` is written **only** by `useStore.persistState`, so
anything persisted there (tabs, expanded dirs, trackers) must live on `useStore`.

---

## 7. Core model — Workspace vs Project (Model B)

**Decided: Model B.** These are distinct concepts:

- **Workspace** = the currently open folder (`root`). The editor works on any
  folder. Opening ≠ initializing.
- **Project** = a workspace that has been **initialized** (scaffolded — the
  required files are present). PM features key off initialization.

Consequences:
- Opening an existing code repo never sprinkles files into it.
- Initialization is **explicit** (the per‑row **Initialize** button in the
  project popup), never automatic on open. Scaffolding is idempotent, so
  re‑running is a safe no‑op / repair.
- Views must define a "no project" empty state (e.g. Hub shows "Open a project
  to use the Hub").
- Terminology in code: `root` is the workspace; `projectStatus(root).initialized`
  says whether it's also a project.

---

## 8. Views & topology

The window is a **vertical shell**: a persistent **top header** over the app row.

```
app-shell (column)
├─ TopHeader                 ← always visible
└─ app (row)
   ├─ ActivityBar (dashboard / view switcher)
   └─ <active view>          ← one of the views below
```

### Top header
- Blue **Change Project** button (opens the centered project popup).
- Separate **path text** showing the full project path (or "No project
  selected"). The path is wrapped in `<Trackable>` (right‑click → track project
  name/path/size/fileCount, plus "Open in File Explorer") and is a highlight
  anchor (`header.projectPath`).

### Dashboard (ActivityBar)
A view switcher. Top group: **Overview, Explorer, Hub, Git, Templates**. Bottom
group: **Account, Settings** (Account above Settings). Clicking a view switches
`activeView`; clicking the active Explorer item toggles the sidebar (VS Code
behavior). Each button opts into a hint.

Adding a view = extend the `ViewId` union (`store.ts`), add a `ViewDef` entry to
`VIEWS` (`ActivityBar.tsx`), add a render branch in `App.tsx`.

### Views
- **Overview** — session/app dashboard built on the **trackers** system (§12).
  Default landing intent; app‑level default trackers render even with no project.
- **Explorer** — top dashbar (title + settings hamburger, like the other views),
  a 320px sidebar (file tree), tabbed Monaco, status bar. Settings: **hide hidden
  files** (dotfiles) and **show deleted files** (history‑only ghost nodes). Now hosts
  the **git versioned file system** (see below). The Welcome overlay's "Open Folder"
  shows only when no workspace is open.
- **Hub** — managed‑docs view (§11). Header (title + hamburger), left pane
  (search + collaboration‑docs drawer + `FileList`), right pane (`EditorPane`
  with generated‑section handling).
- **Templates** — template manager (§10). Header split so the selector/actions
  align with the right pane and the hamburger with the left pane's edge.
- **Git, Account** — placeholder views (not yet built). Account will provide
  GitHub device‑flow auth and unlock **Clone** in the project popup.
- **Settings** — Appearance (theme) + one section per registry section
  (Explorer, Hub, Templates), each rendering its settings with descriptions.

Views with an editor use **per‑view Monaco** (`EditorPane`), not the Explorer's
tab editor — each view keeps its own topology and editor instance.

---

## 9. Persistence & file naming

Three storage locations, deliberately named so nothing collides:

### App data (Electron `userData`) — personal to the machine
- **`registry.json`** — global app registry: `templateFileToggles`,
  `recentProjects` (most‑recent‑first, capped 12), `selectedTemplate` (global
  current template), `lastOpenedProject`.
- **`settings.json`** — `AppSettings`: `theme`, `trackerColors` (default‑tracker
  color overrides), scaffold toggles (`initGitOnScaffold`, `generateConfig`,
  `generateState`, `requireAllFiles`), `hubRequirement`.
- **`workspaces/<sha1(path)>/state.json`** — our per‑workspace UI state: open
  tabs, active tab, expanded dirs, and **custom trackers**. Generic name on
  purpose (distinct from the project's own state file).

All app‑data writes are **atomic** (temp file + rename) and (for workspace state)
debounced.

### Project files (inside the folder) — the user's data, git‑committable
- **`big-mcp.config.json`** — project config: `schemaVersion`, `name`,
  `template` (what it was scaffolded from), `paths` (builtin doc id → relpath),
  `requiredDocs`, `scaffoldedDocs`. Room for `board`/`pipeline` later.
- **`big-state.json`** — project state: `schemaVersion`, `nextId`, `tasks`.

These two names are the `GENERATED_FILES` (excluded from templates) in
`main/builtinDocs.ts`.

### Rules
- **Forget** a project = remove from `recentProjects` **and delete our app‑state**
  (`workspaces/<hash>/`, trackers included); if it's current, also
  `closeProject()`. **Never** touches anything inside the project folder.
- **Last opened project** is remembered and reopened on next launch (validated to
  still exist). `closeProject`/forget‑current clears it.
- **Selected template** persists across restarts (`registry.selectedTemplate`).
- **Custom trackers** are per‑project, persisted in the workspace `state.json`
  (Option A — personal, not committed). Shape kept storage‑agnostic so they could
  migrate into `big-state.json` later.

---

## 10. Templates subsystem (`main/templates.ts`, `main/registry.ts`)

- Templates are **global**, under `userData/templates/<name>/`. The shipped
  **`default`** template (in `templates/`, bundled via electron‑builder
  `extraResources`) is copied in on first run (`ensureDefaultTemplate`) and is
  **read‑only, enforced in main** (writes/adds/deletes/delete rejected server‑side).
- Built‑in docs catalog (`main/builtinDocs.ts`): stable `id → relPath → label`
  (`hub`, `readme`, `architecture`). Single source for scaffolding and Hub.
- Per‑file **scaffold toggles** live in `registry.templateFileToggles`, **sparse**
  ("absent means required"); only *off* files are recorded.
- `templates:list` returns `TemplateInfo[]` = `{ name, files: {relPath, sizeBytes}[],
  isDefault, disabled[] }`.
- **Current template** = global `registry.selectedTemplate`, persisted; selecting
  a template in the Template view sets it and pins it to the top of the selector.
  Each initialized project records its own template in `big-mcp.config.json`.

### Template view UI
Header: title + view‑settings hamburger (left region, width = left pane), then
selector + Create/Duplicate/Delete (right region). Left pane: reusable `FileList`
with a per‑row **scaffold checkbox** (hover hint explains it). Right pane:
`EditorPane` (read‑only + `(BUILT IN)` badge for the default template; markdown
defaults to Preview; new files open in Edit). Reveal‑in‑file‑explorer on rows.

---

## 11. Scaffolding & the Hub

### Scaffolding (`main/projects.ts`, `main/projectFiles.ts`)
`scaffoldProject(root)` is **non‑destructive & idempotent**:
1. Copy the selected template's **enabled** files into the folder (skip existing).
2. Generate `big-state.json` (if `generateState` and absent).
3. Generate `big-mcp.config.json` (if `generateConfig` and absent), recording
   template + doc `paths`/`requiredDocs`/`scaffoldedDocs` for the builtin docs
   that landed.
4. `git init` (if `initGitOnScaffold` and no `.git`; git absent → still succeeds).

`projectStatus(root)` → `{ initialized, damaged, required[], missing[] }`.
Required set = config/state (per their toggles) **+** template files when
`requireAllFiles` is on, choosing the template(s) by **`hubRequirement`**
(`default` = built‑in template, `project` = the project's scaffolded template,
`default+project` = union). `initialized` = required present; `damaged` = config
present but something required missing. Statuses are batch‑fetched
(`projects:statuses`).

### Project popup (`ChangeProjectModal.tsx`)
Portal‑rendered, **centered, blurred backdrop**, click‑outside cancels. Top:
**Choose Project Folder** (add‑only — adds to recent, does *not* open) and
**Clone Project Folder** (disabled until Account/GitHub exists; the connect‑account
prompt shows only when disconnected). Then the recent list only: current project
pinned top with a **blue bar** + `current` tag; row‑click selects. Each row has an
**Initialize** control: `Initialize` → **Initialized ✓** (green) → **Initialized ⚠**
(amber, clickable to repair). Reveal + Forget per row.

### Hub view (`main/hub.ts`, `HubView.tsx`)
- `hub:files(root)` returns the project's **managed files** present on disk
  (templated docs + `big-mcp.config.json`/`big-state.json`) with absolute paths.
- Left pane: **search bar** (filters by name) → **collaboration‑docs drawer** →
  `FileList`.
- **Collaboration‑docs drawer**: a narrow rail (status icon · triangle ▾/▴ ·
  "Collaboration docs" title; rail hint "Set file requirements for project") that
  opens downward. Status icon = green ✓ / amber ⚠ from `projectStatus`, with a
  hover hint "x present, x missing" that recomputes when `hubRequirement` changes.
  Open reveals a section with **Required docs** (TODO) and **Apply template**
  (re‑scaffold + refresh) buttons; rest TODO.
- Right pane: `EditorPane` with `highlightGenerated` for markdown.

### Generated sections (`hubSections.ts`)
Blocks delimited by `<!-- pm:SOURCE -->` … `<!-- /pm:SOURCE -->` (e.g. the
`Hub.md` task table) are treated as machine‑managed:
- **Visually distinguished** — amber whole‑line tint + a bar in the **gutter
  margin** (`linesDecorationsClassName`, so it never overlaps text).
- **Hover** inside → a shared Monaco markdown hover provider warns: "this section
  is generated by `pm:SOURCE`, modifying it might cause problems!".
- **On save**, if a generated section changed since load, `EditorPane` prompts for
  confirmation before writing.

---

## 12. Trackers (Overview)

A sibling of the hint system: elements opt in to being **trackable**, and the
Overview pins their live/async values as cells. Three layers:

- **Value types** (`trackerTypes.ts`) — the 9 types `bytes, int, float, string,
  time, duration, date, percentage, bool`, each with `format()` + a default color
  from the curated **swatch palette** (also used for recoloring). `formatValue`
  returns "—" for null.
- **Trackable definitions** (`trackables.ts`) — the universe of trackables, each a
  pure `resolve(ctx)` over a `TrackerContext` (project root/name, tab/dirty/recent
  counts, theme, uptime, async `stats`). App‑scoped defaults + project‑scoped
  (name/path/size/fileCount). `DEFAULT_TRACKER_IDS` are always shown.
- **Tracker instances** — pinned choices. Defaults are curated (app‑level colors
  in `settings.trackerColors`); custom instances are user‑added, project‑scoped,
  persisted in workspace `state.json`.

Opt‑in: `<Trackable defIds anchor extraItems>` (right‑click → Track/Untrack each,
plus element‑specific extra items). Async values (project size/fileCount) come
from `metrics:projectStats` (walks the tree ignoring `node_modules`/`.git`,
capped), fetched on mount + interval; live values tick every second.

Overview layout: **App** default grid, a "Your trackers" separator, then the
custom grid (empty‑state prompt). Each **cell**: title, vibrantly colored value,
description truncated with "…" (full on hover — the description *is* a hint).
Right‑click cell → popover: default cells get **recolor + show‑original**; custom
cells add **remove (confirm), set title, set description**. Parameterized trackers
(track *this* file vs the project) are deferred.

---

## 13. Settings system

`settingsRegistry.ts` is the single source of truth: sections (`explorer`, `hub`,
`templates`) each list `SettingDef`s. A `SettingDef` has a **binding**:
- `'view'` → ephemeral `useViewSettingsStore` (e.g. the Explorer dummy).
- `'app'` → persisted `AppSettings` key (e.g. scaffold toggles, `hubRequirement`).

Types: `'checkbox'` and `'select'` (options each carry a per‑option hint).
`SettingControl` renders either, in two modes: **`'below'`** (Settings view —
description under the control) and **`'hint'`** (view popover — description on
hover). Both surfaces render from the same registry, so a setting is defined once
and appears in the Settings view section **and** the view's hamburger popover.

Scaffold settings (Templates section, persisted, default on): Initialize git,
Generate `big-mcp.config.json`, Generate `big-state.json`, Require all template
files. Hub section: **Project file requirement** select
(`default` / `project` / `default+project`).

---

## 14. Cross‑cutting UI primitives

- **Hints** (`hint.tsx`) — `useHint(text?)` returns spreadable handlers; a single
  `HintProvider` renders a portal tooltip. Any element opts in; passing no text is
  a no‑op. Applied selectively (see the hint‑policy questions still open).
- **Highlight / anchors** (`highlight.ts`) — `useAnchor(id)` marks any element as
  a highlight target (`data-anchor`); `highlight(anchor, view?)` optionally
  switches view, scrolls to it, and flashes it **amber** (`--highlight` token,
  `anchor-flash`). Tracker "show original" is one caller.
- **Trackable** (`Trackable.tsx`) — opt‑in track/untrack menu + anchor + extra
  items (§12).
- **Popover pattern** — the reusable "floats above UI without affecting layout"
  primitive: **portal to `document.body` + `position: fixed` from a rect/cursor +
  full‑screen backdrop**. Used by the file‑tree context menu, `FileList` reveal
  menu, the view‑settings menu, tracker‑cell menu, and the project modal. When
  this needs collision handling, adopt Floating UI / Radix.
- **Reusable components**:
  - `FileList` — rows only, two lines (name without extension / relpath + size),
    optional leading/trailing slots and an `onReveal` right‑click. Reused by
    Templates and Hub.
  - `EditorPane` — per‑view Monaco; Edit/Preview toggle, self‑managed anonymous
    model + dirty tracking, `defaultMode`, `highlightGenerated`, read‑only,
    `onSave`, header extras. Lazy‑creates Monaco only while a file is open (fixes
    a focus‑steal bug where a hidden editor grabbed dialog keystrokes).
  - `InputDialog` — portal modal input (Electron blocks `window.prompt`); focus
    via rAF.
  - `ViewSettingsMenu` / `SettingControl` / `ColorSwatches`.

---

## 15. Editor architecture

Two distinct editor contexts, both on Monaco:

- **Explorer tabs** — the `ModelManager` (`monaco/modelManager.ts`) owns one model
  per file URI, view‑state save/restore on tab switch, dirty via
  `getAlternativeVersionId()`, disposal on close. A single `EditorHost` swaps
  models on tab activation (ADR‑0006/0007).
- **View editors** (Templates, Hub) — `EditorPane` manages its **own anonymous
  model**, isolated from the ModelManager, so view buffers never pollute the
  Explorer tabs.

Language detection uses Monaco's own registry (`languageForPath`). Markdown
preview via react-markdown + remark-gfm.

---

## 16. File watching (ADR‑0010)

`chokidar` in main, ignoring `node_modules`/`.git`, **debounced & batched** (~80ms)
into `fs:changed`. The renderer refreshes affected loaded tree dirs and reloads
open clean files (dirty files get a ⚠ flag). Own‑write echoes are ignored via
`savedMtime` (fixes the save→watcher→reload→re‑dirty loop). Graceful degradation
on inotify errors.

---

## 17. Packaging (ADR‑0013)

`electron-builder`: Windows NSIS, Linux AppImage + deb. `templates/` bundled via
`extraResources`. Windows code‑signing and auto‑update deferred. Git must be on
PATH for `git init` / the (future) Git view. **Recommended for GitHub tokens:
Electron `safeStorage`** (built‑in, no native module) over keytar — decided but
not yet built (Account view).

---

## 18. Testing / CI (ADR‑0014) — planned, not yet built

Vitest (unit — hardest on the ModelManager and IPC contract), Playwright‑Electron
(one boot/open/edit/save/switch smoke test), GitHub Actions matrix
(windows + ubuntu) producing artifacts. Not scaffolded yet — first thing to add.

---

## 19. Deferred / TODO (intentional seams)

- **Account / GitHub** — BUILT. `main/github.ts` runs OAuth **device flow** with a bring-your-own
  OAuth App **client id** (registry, app-wide), opens the GitHub verification page in an in-app
  `BrowserWindow`, polls, and stores the active account's token via **`safeStorage`** (only the
  current account keeps a token; recents are identity-only and reconnect on switch). Recent
  accounts / forget / last-selected-auto-restored mirror the recent-projects registry pattern.
  `AccountView.tsx` is a Settings-style sectioned view with "how to register a GitHub OAuth App"
  help. `CloneModal.tsx` + `Change Project` clone repos (API repo list + URL paste), token passed
  transiently via `http.extraheader` (never written to `.git/config`), result added to recents.
- **Git view** — BUILT (read‑only). `main/git.ts` parses `git log --all --topo-order`
  + `for-each-ref`, assigns lanes (reusing freed lanes), and computes lane‑based
  ahead/behind/in‑branch metrics (`git:graph`, `git:commitMetrics`). `GitView.tsx`
  renders an SVG graph: master spine + per‑branch colored lanes with straight
  orthogonal, slightly‑rounded connectors (vertical = branch, horizontal at
  branch/merge rows, outer lane drawn on top), hollow commit nodes / solid
  merge+branch nodes, gradient‑tinted message rows, a ref tree, hover tooltip, and
  a right‑click popover whose In‑branch/Ahead/Behind metrics are each individually
  pinnable to the Overview via parameterized commit trackers. Checkout/stage/commit
  are out of scope (read‑only).
- **Git versioned file system** — BUILT as a **commit navigator** redesign, integrated
  into the Explorer. `main/git.ts` provides `fileAtCommit`, `fileHistory` (now with
  per‑commit `+/−` line stats via `--numstat`), `commitFiles`, `deletedPaths`, and
  `treeAtCommit` (`git ls-tree -r`). The reusable **`CommitNavigator`** is a horizontal
  dot scrubber: oldest→newest left‑to‑right, the working/current version a hollow dot at
  the right, and the **selected version always dead‑center** (padded with blanks near the
  ends). Full dots = committed, hollow = working; dots are **branch‑colored** (lanes via
  `useCommitGraph`). End **arrows** step the selection (plain), jump to the last shown dot
  (Ctrl) or to oldest/current (Ctrl+Shift), each with a hint; overflow shows a
  line‑colored **⋯ that the connector line runs to**. Hover a dot → commit info + this
  file's `+/−`; right‑click → Track commit. Rendered dot count is width‑driven.
  The navigator lives in the Explorer **status bar** (a single, file‑scoped instance; the earlier left‑pane dir navigator was removed). The status bar is gray and shows, left→right: the selected commit hash (or “current” on the working version) + a **Jump to current** button (disabled on current), the **navigator** (scaled to the bar height, max 11 / min 1 dots, arrows disabled at the ends, no overflow ellipsis), and on the right **Ln/Col** (from the editor caret, tracked in the store) + the file **format**. When the folder isn't a git repo or has no commits, the navigator area shows a note instead of hiding. Selecting a commit overlays a read‑only inline Monaco diff (vs the predecessor commit) over the editor; “current” returns to the editable buffer. Per‑file version persists. Diff base is always the predecessor commit (pin removed).
- **Pipeline view** — Kanban over `big-state.json` tasks; regenerates the
  `pm:tasks` block in `Hub.md`. Shares a tasks/state layer with the Hub.
- **Hub "Required docs"** — per‑doc required toggles (Overseer TODO);
  `projectStatus.required` already supports it.
- **Hub present/missing list** — currently the Hub lists present managed files
  only; surface missing ones too.
- **Parameterized trackers** — implemented for git commits (sha + metric); extend to files (track a specific file vs the whole project).
- **Explorer tree** — create/rename/delete exist; verify arborist expand‑restore.
- **Extension host, LSP/IntelliSense, integrated terminal, cross‑file search** —
  each its own utility‑process project (ADR‑0015).
- **Hint policy** — decide what does/doesn't get hints (icon‑only vs labeled
  buttons, repeated rows, static text, destructive actions); currently selective.

---

## 20. How to extend (recipes)

- **Add an IPC channel** → add to `RequestMap` (or `EventMap`) + `REQUEST_CHANNELS`
  in `shared/ipc.ts`, add a `handle()` in `main/ipc.ts`, optionally a `ipc.*`
  helper in `renderer/src/ipc.ts`.
- **Add a view** → extend `ViewId` (`store.ts`), add a `VIEWS` entry
  (`ActivityBar.tsx`), add a branch in `App.tsx`, build the component (reuse
  `FileList`/`EditorPane`/header classes; define a no‑project empty state).
- **Add a value type** → one entry in `TRACKER_TYPES` (`trackerTypes.ts`).
- **Add a trackable** → one entry in `TRACKABLES` (`trackables.ts`); mark the
  source element with `<Trackable>` (+ `anchor` for show‑original).
- **Add a setting** → one entry in `settingsRegistry.ts` (`binding: 'app'` needs a
  matching `AppSettings` key + default); it appears in the Settings view section
  and the view popover automatically.
- **Add a highlightable element** → spread `useAnchor('some.id')`; call
  `highlight('some.id', view?)`.
- **Add a document view editor** → mount `EditorPane` with a source adapter
  (`content` + `onSave`), a stable `sourceKey`, and `canPreview`/`highlightGenerated`
  as needed.

---

## 21. Constraints & gotchas

- **Authoring env had no network**, so the app was never run here; only
  type‑checked. Some remaining `tsc` diagnostics are **false positives** from
  uninstalled deps: "Cannot find module", "implicitly any", and the JSX **`key`**
  excess‑property error (React types not installed) — all vanish after
  `npm install`.
- **Electron blocks `window.prompt()`** → use `InputDialog`. `alert`/`confirm`
  work.
- **Monaco `?worker` + a Monaco Vite plugin must not be mixed** (ADR‑0006).
- **Sandboxed preload must be CJS** → no `"type": "module"`.
- **Own‑write watcher echo** is suppressed via `savedMtime`; keep that when
  touching save/reload logic.
- **The per‑workspace `state.json` is one blob** written only by
  `useStore.persistState` — include every field there (tabs, expanded dirs,
  trackers) or a partial write clobbers.

---

## 22. Key files

| Area | Files |
|------|-------|
| Contract/types | `src/shared/ipc.ts`, `src/shared/types.ts` |
| Main lifecycle/IPC | `src/main/index.ts`, `window.ts`, `menu.ts`, `ipc.ts` |
| Main fs/watch/state | `fs-service.ts`, `watcher.ts`, `workspace-state.ts`, `metrics.ts` |
| Projects/templates | `templates.ts`, `registry.ts`, `builtinDocs.ts`, `paths.ts`, `projects.ts`, `projectFiles.ts`, `hub.ts` |
| Renderer core | `store.ts`, `templateStore.ts`, `viewSettingsStore.ts`, `ipc.ts`, `App.tsx` |
| Primitives | `hint.tsx`, `highlight.ts`, `Trackable.tsx`, `hubSections.ts`, `trackerTypes.ts`, `trackables.ts`, `settingsRegistry.ts` |
| Editor | `monaco/modelManager.ts`, `monaco/worker.ts`, `monaco/languages.ts`, `components/EditorHost.tsx`, `components/EditorPane.tsx` |
| Reusable UI | `components/FileList.tsx`, `InputDialog.tsx`, `ViewSettingsMenu.tsx`, `SettingControl.tsx`, `ColorSwatches.tsx`, `TrackerCell.tsx` |
| Views | `components/{Overview,Explorer,Hub,Git,Template,Account,Settings}View.tsx`, `TopHeader.tsx`, `ChangeProjectModal.tsx`, `ActivityBar.tsx`, `Sidebar.tsx`, `TabBar.tsx`, `StatusBar.tsx` |

See `docs/adr/0001`–`0015` for the core‑stack rationale and `docs/views-plan.md`
for the original view build plan.

### Commit-navigator ecosystem (latest)
- **Tab commit dot** — a tab whose file is showing a historical version gets a small
  branch‑colored dot at its top‑right (`TabBar` via `useCommitGraph`); hovering it hints
  the commit (sha · subject — author).
- **Git‑view commit selection** — clicking a commit row selects it (`gitSelectedSha` in the
  store) and opens a **left‑pane detail** (`GitCommitDetail`) under the ref tree: full
  commit info + the list of changed files (`commitFiles`) with A/M/D badges. Clicking a
  file opens it at that commit in the Explorer (`openFileAtCommit`; deletions open the
  parent version).
- **See in Git view** — the status‑bar navigator's right‑click menu adds “See commit in
  Git view”, which calls `focusCommitInGit`: switches to the Git view, selects the commit
  (left‑pane detail), scrolls the row into view, and flashes it via the highlight system.
- **Deleted files** — Explorer setting “Show deleted files” brings back red ghost nodes in
  the live tree; clicking one resolves its last add/modify commit (`git:lastFileCommit`)
  and opens that version.
- **Viewport clamping** — hints and the navigator/Git‑view tooltips & menus render through
  `ClampedFloating` (and a clamped `HintProvider`), measuring themselves and shifting to
  stay inside the window.
- **Hub generated sections** — restyled to a light‑gray full‑row tint (no gutter bar).

### Git performance + read-write actions (latest)
- **Cached shared graph** — the commit graph now lives in the store (`gitGraph`,
  `gitGraphRoot`, `loadGitGraph(force)`) with concurrency de-dup, so the Git view, tabs,
  and status bar share **one** load; view switches are instant. Main‑side `gitGraph` keeps
  a **fingerprint cache** (hash of `for-each-ref` + HEAD) and skips the expensive
  `git log` when nothing changed. Commit **bodies are lazy** (dropped from the bulk log;
  fetched per‑sha via `git:commitBody` for the detail panel).
- **Reload triggers** — Refresh, our own git actions, and a **narrow `.git` watcher**
  (`WorkspaceWatcher` now also watches `.git/HEAD|refs|packed-refs|logs/HEAD|MERGE_HEAD`,
  debounced → `git:changed` event → `loadGitGraph(true)`), so external commits/checkouts/
  merges/fetches refresh the view. The graph resets on project switch.
- **Read-write Git view** (reverses the earlier read‑only lock). Header right region has a
  left‑aligned button cluster **Commit · Branch · Merge · Checkout** (Refresh stays right),
  each opening a Change‑Project‑style portal modal (`Modal` + `GitActionModals`):
  Commit (message + stage‑all, default on), Branch (name + base = selected commit or HEAD +
  checkout toggle), Merge (other‑branch dropdown + `--no-ff`), Checkout (branch dropdown, or
  the selected commit with a detached‑HEAD warning). Main fns `gitCommit/gitCreateBranch/
  gitCheckout/gitMerge/gitBranches` return `{ok,error?}`; on success the graph reloads.
- **Inline merge conflict resolution** — `gitMerge` reports conflicts; the store's
  `gitMergeState` drives a `MergeConflictView` overlay (conflict file list + Complete/Abort).
  Each file opens in a `ConflictEditor`: a Monaco editor over the marker file with ours/theirs
  region **tinting** (green/blue) and **CodeLens** actions per region (Accept Current /
  Incoming / Both), plus toolbar “Accept all current/incoming” and **Mark resolved**
  (`git:stageResolved` writes + `git add`). When all files are staged, **Complete merge**
  (`git:completeMerge`) commits; **Abort** (`git:abortMerge`) bails. An in‑progress merge is
  detected on load via `.git/MERGE_HEAD`, so terminal‑started merges are resumable.

### Pipeline view (latest)
- New right-pane **Pipeline** view (activity-bar entry, `ViewId 'pipeline'`, `pipeline`
  settings section with show-agent / show-priority card toggles). Header is a single
  left-aligned cluster: title + settings menu, `workflow mode <mode>`, **Switch workflow**,
  **Add task**.
- **Kanban board** driven by workflow mode: **Flat** = develop/review/done; **Git native**
  = analyze/architect/develop/qa/security/review/approval/merge (board scrolls horizontally).
  Cards show title, truncated description, agent, and a priority tag; each has back/forward
  **arrows** (disabled at the ends) that move the task one column — no drag-and-drop, no git
  actions.
- **Data** lives in the project's `big-state.json` (`{schemaVersion,nextId,tasks[]}`; task =
  `{id,agent,title,description,stage,priority,createdAt}`, all required) and workflow mode in
  `big-config.json`. New IPC `pm:getState/setState/getConfig/setConfig` + `readState`/
  `readBigConfig`/`writeBigConfig` in `projectFiles`. A `pipelineStore` (zustand) loads on
  view open and writes back on add/move/switch — the same source of truth the Hub's pm:tasks
  reads.
- **Add task** uses the Change-Project-style `Modal` (blurred backdrop, click-outside cancels)
  with title/agent/description/stage/priority, all required. No task editing yet.
- **Workflow switch** is a confirm modal that performs a **lossy remap** of every task's stage
  (gitNative→flat: analyze/architect/develop→develop, qa/security/review/approval→review,
  merge→done; flat→gitNative: develop→develop, review→review, done→merge) and warns when tasks
  aren't in the current final stage.
