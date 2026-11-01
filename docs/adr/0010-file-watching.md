# 0010 — File watching

**Status:** Accepted

## Context
External tools (git, npm, formatters) change files behind the editor. The tree
and open buffers must reflect reality. A single `git checkout` can fire thousands
of events, and Linux `inotify` handles are finite.

## Decision
Watch the workspace root with `chokidar` in the main process, ignoring
`node_modules`/`.git`. Debounce and **batch** events (~80 ms) before pushing a
single `fs:changed` message. On a watcher error (e.g. inotify exhaustion),
degrade gracefully — keep the app usable without live updates rather than crash.
For an open file changed on disk: if the buffer is clean, reload it silently; if
dirty, flag it and let the user decide.

## Consequences
- Bulk operations produce compact diffs, never a per-file message storm.
- chokidar is effectively pure-JS, so v1 avoids native-module rebuild pain.
- Conflict resolution is minimal in v1 (clean-reload + dirty flag); a full
  merge/compare UI is future work.
