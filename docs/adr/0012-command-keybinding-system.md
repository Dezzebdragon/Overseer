# 0012 — Command and keybinding system

**Status:** Accepted

## Context
Menus, keyboard shortcuts, and (eventually) a command palette must all trigger
the same actions. If each wires its own handlers, they drift and the palette
later forces a rewrite.

## Decision
A central command registry (`commandId` → handler) in the renderer. A keybinding
service maps chords to command ids. Native menus in main dispatch the same
command ids via a `menu:command` event. Build all three in v1 even though the
palette is deferred.

## Consequences
- One dispatch path shared by menus, shortcuts, and future palette/extensions.
- Adding the command palette later is mostly a UI over an existing registry.
- Command ids become a small internal API worth keeping stable.
