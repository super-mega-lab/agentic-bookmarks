# Changelog

All notable user-facing changes to **Agentic Bookmarks** are recorded here.

This file follows the spirit of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). During
the beta, minor versions may include breaking changes to data formats — when
they do, that's called out explicitly below.

---

## [0.5.8] — _[PLACEHOLDER: release date]_

**Initial public beta.** First release on the VS Code Marketplace.

### Highlights

- **Durable bookmarks.** Three anchor types — _smart_ (default, context-based),
  _tag_ (inline comment marker), and _point_ (classic line number) — let
  bookmarks survive normal editing and merging.
- **Local and shared bookmarks** as first-class concepts, with different
  tradeoffs tuned for personal scratch vs. team-shared knowledge checked
  into git.
- **Groups, labels, and notes.** Organize bookmarks into styled groups,
  give each one a label, and attach a longer note explaining what it is
  and why it matters.
- **Self-healing anchors.** A layered repair system — manual relocation,
  background auto-repair (with optional git-history analysis), and
  agent-assisted repair via MCP — keeps bookmarks attached to the right
  line as code drifts.
- **Bundled MCP server.** AI coding agents (Claude Code, Cursor, and other
  MCP-capable clients) can read, place, organize, and repair bookmarks
  alongside you.
- **Bookmarks panel** with group filtering, search, and per-file views.
- **Editor overlays** show labels and notes inline; gutter decorations
  surface bookmarks at a glance, with distinct indicators for broken or
  low-confidence anchors.
- **Customizable appearance** — per-group styling, plus uniform-style and
  uniform-color overrides for users who prefer a flatter visual
  presentation.
- **Customizable keybindings.** Defaults use single-press
  `Ctrl+Alt+K/L/J` shortcuts; switch to `chorded` mode for `Ctrl+K …`
  chords, or rebind freely via `keybindings.json`.

### Beta notes

- All **Pro features are free during the beta**, regardless of
  subscription state — no account required. See the README's _Beta status_
  section for what changes post-beta.
- **No telemetry.** The extension doesn't phone home, and the bundled MCP
  server runs entirely on your machine.

### Known limitations

- _[PLACEHOLDER: any known issues or rough edges worth calling out at
  launch — fill in after the pre-publish smoke test]_

---

<!--
Future-version template:

## [X.Y.Z] — YYYY-MM-DD

### Added
- …

### Changed
- …

### Fixed
- …

### Deprecated
- …

### Removed
- …
-->
