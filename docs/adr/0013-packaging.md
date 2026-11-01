# 0013 — Packaging

**Status:** Accepted

## Context
We ship to Windows and Linux and will eventually want auto-update. Installer
tooling and code signing carry real cost and lead time that should be planned,
not discovered at release.

## Decision
Use `electron-builder`. Windows target: NSIS. Linux targets: AppImage (primary)
and `.deb`. One config produces all targets and leaves `electron-updater` a
drop-in later. Auto-update is deferred for v1.

## Consequences
- Windows code signing (ideally an OV/EV certificate) is a cost and procurement
  lead time to start early — unsigned installers trip SmartScreen.
- Native-module rebuilds (`electron-rebuild`) only become relevant when
  `node-pty` arrives with the terminal; v1's dependency set avoids them.
- Auto-update, when added, needs signing plus a release/update feed.
