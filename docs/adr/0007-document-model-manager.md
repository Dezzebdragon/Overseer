# 0007 — Document / model manager

**Status:** Accepted

## Context
IDEs rot when "the file", "the open tab", and "the editor buffer" are conflated.
Monaco models, view state, and dirty state all have distinct lifecycles that
must be managed deliberately or leaks and lost-cursor bugs appear.

## Decision
Three separate concepts: **File** (path on disk, a main concern), **OpenEditor**
(tab + persisted view state, UI state), **TextModel** (Monaco buffer keyed by
`file://` URI). A single `modelManager` owns model lifecycle: one model per URI;
view state saved on tab-blur and restored on tab-focus; dirty tracked via
`getAlternativeVersionId()` against a saved baseline; models disposed on tab
close.

## Consequences
- `alternativeVersionId` reports "clean" correctly after edit-then-undo, unlike a
  change counter.
- Disposal is a hard invariant — the top memory-leak risk — and should be
  asserted in tests (ADR-0014).
- Cross-session persistence of full view state (cursor/scroll) is deferred; v1
  persists open tabs and active tab only (ADR-0011).
