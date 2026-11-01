# Views implementation plan

Derived from the Overseer PM v0.3.0 reference. Maps each requested view onto the
custom-ide architecture (electron-vite · React · Zustand · typed IPC · sandboxed
renderer · Monaco model manager · dashboard view system).

The reference views are proven, self-contained TypeScript. Most main-process
modules port almost verbatim; the renderer views are re-skinned onto our CSS and
wired through our typed IPC and store instead of the reference's context/session
modules.

---

## 0. Foundations (shared prerequisites)

Several views depend on these; build them first.

### 0.1 Managed-project model

Unify "workspace root" (what the editor opens) with Overseer's "active project".
An opened folder becomes the active project. Project management features are
**opt-in**: a folder with no `config.json` is still fully editable in Explorer;
PM views show an "initialize project" affordance instead of erroring.

- `config.json` (schemaVersion 2): name, pipeline, template, github, board,
  `paths` (builtin doc id → rel path), `requiredDocs`, `scaffoldedDocs`.
- `state.json` (schemaVersion 1): nextId, tasks. Ported minimally (see Hub).
- `registry.json` in `userData`: known projects, active project, selected
  template, github client id, `templateFileToggles`.

Port from reference: `projectFiles.ts` (defaults + v1→v2 migration), `registry.ts`,
`builtinDocs.ts`, and the `paths.ts` safety helpers (`assertInsideProject`,
`assertInsideTemplates`, `validateTemplateName`). Our existing `fs-service.ts`
stays for raw editor I/O; project I/O goes through the ported, path-guarded
helpers.

### 0.2 New IPC channels

Extend the existing typed `RequestMap` / `EventMap` and the preload allowlist.
Grouped by domain (names mirror the reference contract):

- projects: `list`, `add`, `remove`, `setActive`, `pickDirectory`, `clone`
- config/state: `config:read`, `config:write`, `state:read`, `state:write`
- git: `git:status`, `git:graph`, `git:commitFiles`, `git:fileHistory`,
  `git:fileAtCommit`, `git:deletedPaths`
- github: `github:status`, `github:connect`, `github:cancel`,
  `github:setClientId`, `github:listRepos`, `github:disconnect`,
  `github:openVerification`; event `github:verification`
- templates: `templates:list/select/create/duplicate/delete/readFile/
  writeFile/addFile/deleteFile/setFileRequired`
- hub: `hub:docStatus`, `hub:setRequiredDocs`, `hub:applyTemplate`

All handlers live in main and reuse the path guards. The renderer keeps zero fs
/ git / keychain access (ADR-0004 unchanged).

### 0.3 Editor strategy for document views

Hub, Template, and Git (file-at-commit) all need a text editor inside their own
view. Decision: generalize the single-editor holder into a **per-pane editor**.
`editorHolder` becomes a map keyed by pane id (`explorer`, `hub`, `template`,
`gitshow`). Each view mounts an `EditorPane` component backed by the shared
`modelManager`, so models, dirty tracking, and view state stay centralized while
each view keeps its own topology and its own editor instance. Markdown docs get a
rendered-preview toggle via a small renderer (markdown-it or react-markdown);
raw editing stays in Monaco.

This is cleaner than the reference's per-view `FileEditorPane` + `sessionState`
because dirty/model lifecycle is already solved by the model manager.

### 0.4 Dependencies

- `simple-git` — git status/graph/show (git must be on PATH; degrade gracefully).
- `@octokit/rest`, `@octokit/auth-oauth-device` — GitHub API + device flow.
- Token storage: **prefer Electron `safeStorage`** over the reference's native
  `keytar`. safeStorage is built into Electron (no native rebuild, no asar
  unpack); store the encrypted token as a file in `userData`. This removes the
  single biggest packaging headache in the reference. keytar remains a fallback.
- A markdown renderer for previews.

### 0.5 Store / state

Add a `project` slice to the Zustand store: `registry`, `config`, `projectState`,
`gitAvailable`, `githubStatus`, `builtinDocs`, plus actions. Cross-view
persistence is automatic (store outlives view switches, per ADR view system).
Setting the active project also sets the editor `root` so Explorer reflects it.

### 0.6 Packaging / security

- `git` required on PATH for Git view; banner when absent.
- safeStorage needs `app.whenReady`; on Linux it still uses libsecret backends.
- Ship a default template folder (`templates/default/…`) copied to
  `userData/templates` on first run (`ensureDefaultTemplate`). Include the
  reference's `Hub.md`, `README.md`, `Documentation/architecture.md`.
- Token never written to config/state/registry/project files.

---

## 1. Overview view

**Purpose.** Project landing: show the active project, change/add/forget/switch
projects, clone a GitHub repo into a new project, and surface GitHub status.

**Reference.** `OverviewView.tsx` + `ChangeProjectModal.tsx`.

**Main / IPC.** projects.list/add/remove/setActive/pickDirectory/clone;
config:read (project summary); github:status.

**Renderer.** Summary card (name, path, pipeline, template, git/github chips).
"Change Project" modal: recent-projects list (switch / forget with confirm),
"Add New Project" (pick dir → scaffold), "Clone GitHub Repo" (needs Account
connected → list repos → pick destination → clone → scaffold missing files).

**Store.** `registry` + `setActiveProject(path)` which also loads it as the
editor workspace (unifies active project with `root`). Opening a folder via
Explorer registers it in the project registry.

**Edge cases.** Non-managed folder → "Initialize as project" (scaffold). Clone
requires GitHub + git. Forgetting a project never touches disk.

**Effort.** Small–medium. Mostly wiring registry + reusing the existing
open-folder flow.

---

## 2. Hub view

**Purpose.** Monitor scaffolded documentation (present/missing), configure which
builtin docs are required, edit docs, and run the destructive "apply template"
repair.

**Reference.** `HubView.tsx` + `hub.ts` + `builtinDocs.ts`.

**Main / IPC.** hub:docStatus, hub:setRequiredDocs, hub:applyTemplate;
config:read/write; files read/write (via project guards); templates:list.
Port `hub.ts` (docStatus, setRequiredDocs, applyTemplate, `regenerateHub`,
`renderTaskTable`).

**Renderer.** Two-pane: searchable doc list (present docs) + settings popup
(present/missing counts, required-docs checkboxes, apply-selection) on the left;
`EditorPane` on the right. Missing indicator. Apply flow: plan modal spelling out
every path, explicit `Hub.md` warning, confirm → apply → result modal.

**Store.** `config` (scaffoldedDocs/requiredDocs/paths), `builtinDocs`.

**Dependency.** Needs the managed-project model (0.1) and a source template
(view 4). Applying `Hub.md` regenerates its task table from `state.json`, so port
minimal `state.json` read + `renderTaskTable` even though the Pipeline board
itself is out of scope for now.

**Effort.** Medium–large (the apply/repair flow and doc-status round trip).

---

## 3. Git view

**Purpose.** Read-only repository view: working-tree status and a horizontal
commit graph; click a commit to see changed files; open a file at a commit.

**Reference.** `GitView.tsx` + `GitGraph.tsx` + `utils/gitGraphLayout.ts` +
`git.ts`.

**Main / IPC.** git:status/graph/commitFiles/fileHistory/fileAtCommit/
deletedPaths; `isGitAvailable` folded into a startup snapshot. Port `git.ts`
(simple-git; topo-ordered `--all` log with a field/record-separated pretty
format).

**Renderer.** Status sidebar (branch, tracking, ahead/behind, clean vs dirty
list) + commit graph (port `GitGraph` + `gitGraphLayout` — a self-contained pure
layout function + SVG renderer, portable as-is) + selected-commit changed-files
list. "Open file at commit" opens a **read-only** Monaco model
(`gitshow://<hash>/<path>`) in the shared editor. A line-diff view is a later
add-on (`lineDiff.ts` / `DiffView.tsx`).

**Deps.** simple-git; git on PATH (graceful banner otherwise).

**Independence.** Only needs a git repo at the workspace root — not the
config.json model — so it can land right after foundations.

**Effort.** Medium. The graph layout is the bulk but is a direct port.

---

## 4. Template view

**Purpose.** Manage template profiles (create/duplicate/delete), edit their
files, and toggle per-file scaffold inclusion. The built-in `default` template is
read-only; its files can still be toggled off.

**Reference.** `TemplateView.tsx` + `templates.ts` + registry toggle helpers +
`scaffold.ts`.

**Main / IPC.** templates:list/select/create/duplicate/delete/readFile/
writeFile/addFile/deleteFile/setFileRequired. Port `templates.ts`
(`ensureDefaultTemplate`, `listTemplateFiles`, CRUD) and the registry toggle
functions. Templates live in `userData/templates`; the shipped default under
`resources/templates`. Built-in writes rejected in main, not just hidden.

**Renderer.** Header (template selector dropdown, Create / Duplicate / Delete) +
file tree with per-file scaffold checkboxes (`buildTree` port) + `EditorPane`
(read-only for built-in, `(BUILT IN)` badge). Add/Delete file for non-default.

**Store.** `registry.selectedTemplate`; `TemplateInfo.disabled` drives the
checkboxes.

**Ship.** Bundle `templates/default/*` and copy to `userData` on first run.

**Dependency.** Foundations (registry, builtinDocs, scaffold). Is the source for
Hub's apply flow, so build it before Hub.

**Effort.** Medium–large (template CRUD + toggles + read-only enforcement).

---

## 5. Account view

**Purpose.** GitHub account: device-flow sign-in, client-id configuration,
connected identity (avatar/login/name), disconnect. Sits at the bottom of the
dashboard, above Settings.

**Reference.** `GitHubConnectModal.tsx` + `github.ts` (`GitHubAuthProvider`).

**Main / IPC.** github:status/connect/cancel/setClientId/listRepos/disconnect/
openVerification + `github:verification` event. Port `GitHubAuthProvider`
(octokit + device auth), swapping keytar for **safeStorage** (0.4).

**Renderer.** Connected: avatar, name, `@login`, edit-client-id, disconnect.
Disconnected: client-id field, Connect button, device-code panel (big user code,
copy, "Open GitHub", waiting state driven by the verification event).

**Store.** `githubStatus`; client id in `registry.githubClientId` (seedable from
an env var for dev).

**Deps.** octokit + device-auth; safeStorage. Client ID is public (device flow —
no secret). Token only in encrypted storage, never in files.

**Independence.** Self-contained; unlocks clone in Overview. Good first real view
to build after foundations.

**Effort.** Medium (device-flow states + secure token handling).

---

## Open decisions (need sign-off before implementing)

1. **Adopt the managed-project model** (config.json/state.json + global
   registry.json), opt-in per folder? Required for Overview/Hub/Template.
2. **Per-pane embedded editor** (recommended) vs reusing shared Explorer tabs for
   Hub/Template/Git-at-commit.
3. **Token storage:** Electron `safeStorage` (recommended, no native module) vs
   the reference's `keytar`.
4. **Default landing view:** keep Explorer, or default to Overview on first run
   with no workspace?
5. **Tasks/Pipeline:** port minimal `state.json` + task-table rendering for Hub's
   apply fidelity now; defer the Pipeline board UI (not requested)?
6. **Markdown renderer:** markdown-it vs react-markdown.
7. **GitHub client ID:** ship a configurable id (env/registry), device flow only.

## Suggested build order

Foundations (0) → Git (3, independent quick win) → Account (5, unlocks clone) →
Overview (1) → Template (4) → Hub (2).
