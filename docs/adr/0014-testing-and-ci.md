# 0014 — Testing and CI

**Status:** Accepted

## Context
Correctness bugs concentrate in the model manager and IPC contract, and
platform-specific breakage (path handling, worker loading) only shows up when the
app actually boots on each OS.

## Decision
Vitest for unit tests, focused hardest on the model manager (dirty tracking,
disposal, view state) and IPC contract. Playwright's Electron support for an
end-to-end smoke test: boot, open a folder, open/edit/save a file, switch tabs.
GitHub Actions matrix on `windows-latest` and `ubuntu-latest` runs tests and
produces packaged artifacts.

## Consequences
- Model-manager invariants (no leaked models) are asserted, not assumed.
- The smoke test catches cross-platform issues unit tests miss.
- CI produces installers continuously, so release is never a surprise.
- Test scaffolding is not part of the initial runnable v1 and is the first
  follow-up to add.
