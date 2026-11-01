# 0001 — Build our own shell on Monaco

**Status:** Accepted

## Context
We need a VS Code-like editor for Windows and Linux. The main options are:
fork Code-OSS, adopt Eclipse Theia, or build a purpose-built shell directly on
the Monaco editor. Forking Code-OSS inherits enormous surface area and an
extension model we do not need yet; Theia is powerful but heavy and opinionated.

## Decision
Build our own application shell (explorer, tabs, panels, status bar) on top of
the standalone `monaco-editor`. Monaco provides the hard part — a production
text editor — and we own everything around it.

## Consequences
- Small, comprehensible codebase we fully control.
- Every deferred capability (extensions, LSP, terminal, debug, search) becomes a
  deliberate integration against a clean seam, not a fork we must maintain.
- We are responsible for features Code/Theia give for free (command palette,
  settings UI, extension host). These are explicitly out of v1 scope (ADR-0015).
