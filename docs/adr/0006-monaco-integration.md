# 0006 — Monaco integration and worker loading

**Status:** Accepted

## Context
Monaco offloads language services (TypeScript, JSON, CSS, HTML) to web workers.
Worker loading is the single most common Monaco-under-a-bundler failure. Under
Vite the supported mechanism is `getWorker` returning workers via `?worker`
imports; mixing that with a Monaco Vite plugin breaks loading.

## Decision
Use the full `monaco-editor` package with the manual `?worker` pattern in
`src/renderer/src/monaco/worker.ts`, imported for its side effect before any
editor is created. Do **not** add a Monaco bundler plugin. Run **one**
`IStandaloneCodeEditor` per editor group; v1 has one group and swaps models on
tab activation.

## Consequences
- Matches Monaco's official Vite sample; de-risks the top integration failure.
- One editor instance is memory-efficient and is exactly how split-view scales
  later (one editor per group).
- Undo history lives on the model, so model-swap preserves per-file undo for
  free; only view state needs manual save/restore (ADR-0007).
- Bundle slimming (importing only needed languages) is deferred.
