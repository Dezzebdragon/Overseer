# Architecture Decision Records

These ADRs capture the decisions that shape the IDE. Each is intentionally short:
context, the decision, and the consequences (including what it commits us to and
what it leaves open). They are the reference for future development — when a v2
feature (extensions, LSP, terminal, search) lands, it should slot into the seams
these records describe rather than reshape the core.

Status values: **Accepted** (ratified for v1), **Proposed**, **Superseded**.

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-build-own-shell-on-monaco.md) | Build our own shell on Monaco | Accepted |
| [0002](0002-build-system-electron-vite.md) | Build system: electron-vite | Accepted |
| [0003](0003-renderer-react-zustand.md) | Renderer: React + Zustand + CSS | Accepted |
| [0004](0004-process-model-and-security.md) | Process model and security posture | Accepted |
| [0005](0005-typed-ipc-layer.md) | Typed IPC layer | Accepted |
| [0006](0006-monaco-integration.md) | Monaco integration and worker loading | Accepted |
| [0007](0007-document-model-manager.md) | Document / model manager | Accepted |
| [0008](0008-file-io-semantics.md) | File I/O semantics | Accepted |
| [0009](0009-file-explorer-tree.md) | File explorer / tree | Accepted |
| [0010](0010-file-watching.md) | File watching | Accepted |
| [0011](0011-workspace-state-persistence.md) | Workspace and state persistence | Accepted |
| [0012](0012-command-keybinding-system.md) | Command and keybinding system | Accepted |
| [0013](0013-packaging.md) | Packaging | Accepted |
| [0014](0014-testing-and-ci.md) | Testing and CI | Accepted |
| [0015](0015-v1-scope.md) | v1 scope boundary | Accepted |
