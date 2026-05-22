# Design: QUICKSTART.md — User-Facing Getting Started Guide

**Ticket:** SML-1431  
**Date:** 2026-05-22  
**Status:** Approved

---

## Goal

Create `QUICKSTART.md` at the root of the public repo that walks a new user through the complete Agentic Bookmarks core loop, illustrated with screenshots at key UI moments.

---

## Location

`QUICKSTART.md` — repo root of `agentic-bookmarks` (this public repo), alongside `README.md`. README Quickstart section will gain a link to it.

**Rationale:** Maximum discoverability from GitHub. The public repo is the natural home for new-user onboarding content. Core repo docs are for internal/developer audiences.

---

## Format

Linear narrative — one continuous tutorial flow, chapters numbered 1–4. Screenshots appear inline immediately after the step they illustrate. No tabs or "pick your path" branching except inside Chapter 4 (agent tool selection).

---

## Structure

### Intro (~3 sentences)
- Problem: standard bookmarks break on rename, don't survive refactors, can't be read by agents
- Payoff: by the end of this guide, you'll have placed your first bookmark, watched it survive a refactor, and connected your AI agent
- Estimated time: 5 minutes

### Chapter 1: Install
- Install "Agentic Bookmarks by supermegalab" from the VS Code Marketplace
- **Screenshot 1:** Extension installed in the VS Code Extensions panel
- One-liner: add `.bookmarks/local/` to `.gitignore` (copy-paste line provided)

### Chapter 2: Place your first bookmark
- Open any file, right-click any line → "Add Bookmark"
- **Screenshot 2:** Right-click context menu showing "Add Bookmark"
- Quick-pick prompt for a label — type something meaningful
- **Screenshot 3:** Gutter pin visible in editor + sidebar tree showing the new bookmark
- Tip: bookmarks auto-sort by file/line; no manual ordering needed

### Chapter 3: Watch it survive a refactor
- Rename the function the bookmark is on (or move it a few lines)
- Navigate via the sidebar — click the bookmark entry
- **Screenshot 4:** Post-rename, pin still on the correct code (not the old line number)
- One-sentence explanation: smart anchors match surrounding context, not raw line numbers

### Chapter 4: Connect your AI agent
- One-sentence framing: the bundled MCP server lets your agent read, place, and repair bookmarks
- `Cmd+Shift+P` → "MCP Bookmarks: Setup for ___"
- **Screenshot 5:** Command palette with the three setup commands visible
- Three sub-paths (2–3 lines each, text-only except for the shared palette screenshot):
  - **Claude Code:** runs `claude mcp add` in a terminal; prompts for scope (Local/User)
  - **Cursor:** writes `.cursor/mcp.json` (Project) or `~/.cursor/mcp.json` (Global)
  - **Codex:** writes `.codex/config.toml` (Project) or `~/.codex/config.toml` (Global)
- Quick verify: ask your agent "list my bookmarks" — it should respond with the bookmark placed in Chapter 2

### What's Next
Three links:
1. Full README (workspace layout, MCP config details, custom data root)
2. Repair docs (when anchors drift and how to fix them)
3. Agent skill guides (for agents doing bookmark-driven research)

---

## Screenshots

| # | Moment | Notes |
|---|--------|-------|
| 1 | Extension panel, post-install | Show "Agentic Bookmarks by supermegalab", Installed badge |
| 2 | Right-click context menu on a code line | "Add Bookmark" entry visible |
| 3 | Editor + sidebar after bookmark placed | Gutter pin + tree entry, label visible |
| 4 | Editor after renaming the function | Pin on the correct (moved) line |
| 5 | Command palette | Three "MCP Bookmarks: Setup for …" commands visible |

**Total:** 5 screenshots. Marc takes them alongside; placeholders in first draft marked `![TODO: screenshot-N]`.

---

## Image storage

Screenshots stored in `docs/images/quickstart/` (e.g., `01-install.png`, `02-context-menu.png`, …). Referenced from `QUICKSTART.md` as relative paths.

---

## README integration

After `QUICKSTART.md` is complete, add one line to the existing README "Quickstart" section:

> → **[Full Quickstart with screenshots](QUICKSTART.md)**

---

## Out of scope

- Marketplace page content or videos
- Repair workflow walkthrough (link to existing repair docs instead)
- Coverage of every MCP client (only Claude Code, Cursor, Codex)
- Tag anchors or local vs. shared distinction (smart anchor default is sufficient for getting started)
