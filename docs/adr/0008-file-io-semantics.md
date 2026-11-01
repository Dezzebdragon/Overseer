# 0008 — File I/O semantics

**Status:** Accepted

## Context
Silently mishandling encoding or line endings corrupts diffs and frustrates
users. Opening a huge or binary file in Monaco degrades or hangs the editor. A
crash mid-save can truncate a file.

## Decision
UTF-8 by default with BOM detection and stripping. Detect EOL (LF vs CRLF) on
load, apply it to the model, and write it back unchanged. Guard reads: refuse
files over ~50 MB or containing NUL bytes (binary) with a clear message. Writes
are atomic — write a temp file in the same directory, then rename. Each read
returns `mtimeMs` for external-change detection (ADR-0010).

## Consequences
- Line endings are preserved, never normalized behind the user's back.
- Monaco is never handed content it cannot handle well.
- A crash during save cannot leave a half-written file.
- Broader encodings (UTF-16, legacy codepages) are deferred.
