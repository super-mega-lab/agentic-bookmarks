# Changelog

All notable user-facing changes to **Agentic Bookmarks** are recorded here.

This file follows the spirit of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). During
the beta, minor versions may include breaking changes to data formats — when
they do, that's called out explicitly below.

---

## [0.8.17] — 2026-05-27

**Agents panel.** Everything about your AI agents now lives in one dedicated sidebar view, alongside ready-to-run skill playbooks.

- **New Agents panel.** A dedicated sidebar view for working with AI agents — separate from the Welcome view, so agent setup and day-to-day agent actions have their own home.
- **Skill playbook pills.** One-click buttons launch curated bookmark skills (map a codebase, annotate files, audit existing bookmarks, and more) through your connected agent — no need to remember tool names or prompts.
- **Agent Connections moved here.** The install / update / connect status rows for Claude Code, Cursor, and Codex now live in the Agents panel, keeping all agent-related controls together. The Welcome view stays focused on Getting Started, Learn, and Community.

---

## [0.8.15] — 2026-05-26

**MCP Control Panel.** Connecting Agentic Bookmarks to your AI agents — and keeping those connections current as the extension updates — is now a one-stop experience.

- **New MCP Control Panel.** A dedicated home for installing, diagnosing, and removing MCP integrations across Claude Code, Cursor, and Codex. Setup status, fixes, and uninstall flows live in one place, making it dramatically clearer to connect to an agent or update an existing connection.
- **Collapsible welcome sections.** Tidy up the Welcome panel by collapsing sections you've already worked through.
- **Live repair feedback.** When an agent repairs a bookmark through MCP, the sidebar reflects it immediately — no rescan needed.

---

## [0.8.2] — 2026-05-25

A small polish release focused on wording.

- Consistent voice and naming across the Welcome panel, command palette, and README — same product, a little more refined.

---

## [0.8.0] — 2026-05-22

A big quality-of-life release: a refreshed first-run experience, new ways to work with bookmarks in bulk via **Scan All** and the per-bookmark **Repair** action, and a much smoother MCP setup for AI agents.

### Getting started feels like getting started

- Refreshed Welcome panel with a clearer first-install layout, community and support links, and direct paths to docs.
- New illustrated Getting Started guide covering install, the "refactor survival" demo, and MCP setup.
- Friendlier "no folder open" messaging and a LEARN section with external links to deeper docs.

### Work with bookmarks in bulk

- **Scan all** bookmarked files from a single command, with progress and cancellation when the set is large.
- **Per-bookmark Repair action** right in the tree — fix a drifted anchor without leaving the sidebar.
- **Open all** bookmarked files in one command alongside Scan All.
- Toggle the structure of the "All Bookmarks" and "Files & Groups" views to match how you think.
- Drag-and-drop now moves groups **between files**, not just within one.

### AI agents, set up in one click

- MCP setup is now idempotent and understands user vs. workspace scope, so re-running it does the right thing.
- The extension prompts to refresh agent registrations after it updates itself.
- MCP setup now handles the relevant `.gitignore` entries for you.
- New **skill guides** delivered through MCP teach agents *when* and *how* to use the bookmark tools — including how to map a new codebase, annotate specific files, and audit an existing bookmark set. Always current, nothing added to your project.
- New help and report-issue MCP skills for quick agent-assisted support.

### Under the hood

- Workspace activation is deferred until you actually open a folder, keeping the extension out of cold-start paths.
- Cross-file repairs reflect instantly in the tree (stale-cache fix).
- Tag-comment cleanup now handles ids ending in `-` correctly.
- Public-beta cutoff extended to 2027-01-01.
- A handful of small fixes to welcome wording and settings defaults.

---

## [0.7.2] — 2026-05-15

Post-beta polish.

- **Pick your hotkey style.** New setting lets you choose chorded, basic, or fully custom keybindings to match how you already work.
- **Snappier startup.** The extension now waits until VS Code finishes starting before activating, keeping it out of your cold-start path.
- README refresh.

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
