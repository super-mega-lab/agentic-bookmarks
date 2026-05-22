# Getting Started Guide — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the existing `packages/extension/resources/getting-started.md` with an install step, refactor-survival section, and screenshot references, so it serves as the canonical user-facing quickstart both inside VS Code and on GitHub.

**Architecture:** One source of truth: `packages/extension/resources/getting-started.md`. Screenshots stored at `packages/extension/resources/images/` (bundled in the VSIX, works in VS Code preview and GitHub). README gets one link. Marc takes screenshots after the text is written — guide is written first with relative image references, screenshots dropped in.

**Tech Stack:** Markdown, VS Code extension UI (for screenshots), git

**Spec:** `docs/superpowers/specs/2026-05-22-quickstart-guide-design.md`

**Note on approach change:** Original plan targeted a new `QUICKSTART.md` at repo root. During implementation an in-extension Getting Started guide was discovered at `packages/extension/resources/getting-started.md`. Enriching that file is less redundant.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `packages/extension/resources/getting-started.md` | Add install step, refactor-survival section, screenshot refs, reorder content |
| Create | `packages/extension/resources/images/.gitkeep` | Image directory for screenshots (committed empty; populated by Marc) |
| Modify | `README.md` | Add one link to the getting-started guide |

---

### Task 1: Set up images directory

**Files:**
- Create: `packages/extension/resources/images/.gitkeep`

- [ ] **Step 1: Create directory**

```bash
mkdir -p packages/extension/resources/images
touch packages/extension/resources/images/.gitkeep
```

- [ ] **Step 2: Commit**

```bash
git add packages/extension/resources/images/.gitkeep
git commit -m "docs(SML-1431): add images directory for getting-started screenshots"
```

---

### Task 2: Rewrite getting-started.md with full core loop

**Files:**
- Modify: `packages/extension/resources/getting-started.md`

The current file content to replace:

```markdown
# Getting Started with Agentic Bookmarks

Agentic Bookmarks gives you durable, self-healing bookmarks that survive refactors — and lets your AI assistant create, navigate, and manage them through the MCP.

## Quick Start

**1. Open the Welcome panel**  
Click the bookmark icon in the Activity Bar to open the Agentic Bookmarks panel.

**2. Set up the MCP** (for AI-assisted workflows)  
In the Welcome panel, click **Set up for Claude Code** (or Cursor/Codex). This lets your AI assistant read and place bookmarks through the MCP tools.

**3. Place your first bookmark**  
Right-click any line in an editor and choose **Agentic Bookmarks: Add Bookmark**. Give it a label and optionally assign it to a group.

**4. Navigate and search**  
Click any bookmark in the panel to jump to it. Use the search input to filter by label, group, or tag.

## What's Next: AI Skill Playbooks

Once the MCP is set up, ask your AI assistant to use these built-in playbooks:

| Playbook | What it does |
|---|---|
| `bookmarks://skill/map-codebase` | Build a complete bookmark map of the whole repo |
| `bookmarks://skill/add-to-system` | Deeply bookmark one module or feature area |
| `bookmarks://skill/add-to-files` | Annotate specific files you're already reading |
| `bookmarks://skill/analyze` | Review coverage, staleness, and themes in your bookmarks |

Or just ask your assistant: **"Map this codebase with bookmarks"** — it knows what to do.

## Get Help

- **Discord** (fastest): https://discord.gg/zukZdvqf8q
- **GitHub Issues**: https://github.com/super-mega-lab/agentic-bookmarks/issues/new
- **Email**: contact@supermegalab.com
```

- [ ] **Step 1: Write the new content**

Replace the entire file with:

```markdown
<!-- ABOUTME: User-facing getting started guide for Agentic Bookmarks. -->
<!-- ABOUTME: Covers install, bookmark placement, refactor survival, MCP setup, and AI skill playbooks. -->

# Getting Started with Agentic Bookmarks

Agentic Bookmarks gives you durable, self-healing bookmarks that survive refactors — and lets
your AI assistant create, navigate, and manage them through the MCP.

This guide takes you from install to your first agent-accessible bookmark in about five minutes.

---

## 1. Install

Search for **"Agentic Bookmarks"** in the VS Code Extensions panel (`Cmd+Shift+X` / `Ctrl+Shift+X`)
and click **Install**. Publisher: **supermegalab**.

![Extension installed in VS Code Extensions panel](images/01-install.png)

> **One-time setup:** add this line to your project's `.gitignore` so machine-local state never
> gets committed:
>
> ```
> .bookmarks/local/
> ```
>
> Or run **Agentic Bookmarks: Add .bookmarks/local/ to .gitignore** from the command palette
> (`Cmd+Shift+P`) to have the extension do it for you.

---

## 2. Place your first bookmark

Open any file. Right-click on a line you want to bookmark and choose **Add Bookmark**.

![Right-click context menu showing Add Bookmark](images/02-context-menu.png)

A quick-pick prompt asks for a **label**. Type something meaningful — "auth boundary",
"main render loop", "the 3am hack" — and press Enter.

A pin appears in the editor gutter and the bookmark shows up in the **Agentic Bookmarks** sidebar.

![Gutter pin and sidebar tree showing the new bookmark](images/03-pin-and-sidebar.png)

---

## 3. Watch it survive a refactor

Rename the function your bookmark is on — or move a few lines somewhere else in the file.

Now click the bookmark in the sidebar. It navigates to the **correct code** at its new location,
not the stale line number where it used to be.

![Editor after renaming the function — pin still on the right line](images/04-post-refactor.png)

**How it works:** the bookmark stores enough surrounding context to re-find its line as code
drifts. This is called a *smart anchor*. Small edits — renames, insertions, moves — don't break
it.

---

## 4. Connect your AI assistant

The extension bundles an MCP server that lets your AI coding assistant read, place, and repair
bookmarks. Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and type
**"Agentic Bookmarks: Setup"**.

![Command palette showing Agentic Bookmarks setup commands](images/05-mcp-setup.png)

Pick the command for your tool:

- **Setup for Claude Code** — runs `claude mcp add` in a terminal. Choose Local (this project)
  or User (all projects).
- **Setup for Cursor** — writes `.cursor/mcp.json` (Project) or `~/.cursor/mcp.json` (Global).
- **Setup for Codex** — writes `.codex/config.toml` (Project) or `~/.codex/config.toml` (Global).

**Verify it's working:** ask your assistant "List my bookmarks" — it should respond with the
bookmark you placed in step 2.

---

## 5. Navigate and search

Click any bookmark in the sidebar to jump to it. Use the search input at the top of the panel
to filter by label, group, or file.

---

## What's Next: AI Skill Playbooks

Once the MCP is set up, ask your AI assistant to use these built-in playbooks:

| Playbook | What it does |
|---|---|
| `bookmarks://skill/map-codebase` | Build a complete bookmark map of the whole repo |
| `bookmarks://skill/add-to-system` | Deeply bookmark one module or feature area |
| `bookmarks://skill/add-to-files` | Annotate specific files you're already reading |
| `bookmarks://skill/analyze` | Review coverage, staleness, and themes in your bookmarks |

Or just ask your assistant: **"Map this codebase with bookmarks"** — it knows what to do.

---

## Get Help

- **Discord** (fastest): https://discord.gg/zukZdvqf8q
- **GitHub Issues**: https://github.com/super-mega-lab/agentic-bookmarks/issues/new
- **Email**: contact@supermegalab.com
```

- [ ] **Step 2: Verify the Markdown**

Check:
- [ ] ABOUTME headers are the first two lines (HTML comments, invisible when rendered)
- [ ] Five numbered sections (1–5) plus What's Next and Get Help
- [ ] All five image references use relative path `images/NN-name.png` (no leading slash, no `packages/extension/resources/`)
- [ ] The gitignore blockquote in step 1 has a code block inside (`.bookmarks/local/`)
- [ ] Command palette strings are exact: "Agentic Bookmarks: Setup for Claude Code", "Agentic Bookmarks: Setup for Cursor", "Agentic Bookmarks: Setup for Codex"
- [ ] The existing "What's Next" playbook table and Get Help section are preserved verbatim

- [ ] **Step 3: Commit**

```bash
git add packages/extension/resources/getting-started.md
git commit -m "docs(SML-1431): enrich getting-started.md with install, refactor survival, and MCP steps"
```

---

### Task 3: Update README to link to getting-started guide

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Find the Quickstart section**

The README has a `## Quickstart` section with a few bullets ending in "videos coming soon."

- [ ] **Step 2: Add the link**

After the existing "That's all. See the Marketplace page..." line, add:

```markdown
→ **[Full Getting Started guide with screenshots](packages/extension/resources/getting-started.md)**
```

- [ ] **Step 3: Verify**

Read the section to confirm the link renders and points to the correct relative path.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(SML-1431): link getting-started.md from README Quickstart section"
```

---

### Task 4: Screenshot integration pass (Marc takes screenshots)

**Files:**
- Add: `packages/extension/resources/images/01-install.png`
- Add: `packages/extension/resources/images/02-context-menu.png`
- Add: `packages/extension/resources/images/03-pin-and-sidebar.png`
- Add: `packages/extension/resources/images/04-post-refactor.png`
- Add: `packages/extension/resources/images/05-mcp-setup.png`

Marc takes the five screenshots in VS Code and drops them into the images directory.

- [ ] **Step 1: Verify all five exist**

```bash
ls -la packages/extension/resources/images/
```

Expected: 5 `.png` files plus `.gitkeep`.

- [ ] **Step 2: Open getting-started.md in VS Code Markdown preview**

All five images should render without broken-image icons.

- [ ] **Step 3: Remove .gitkeep**

```bash
git rm packages/extension/resources/images/.gitkeep
```

- [ ] **Step 4: Commit**

```bash
git add packages/extension/resources/images/
git commit -m "docs(SML-1431): add getting-started screenshots"
```

---

### Task 5: Final review pass

**Files:** (read-only review)

- [ ] **Step 1: Read getting-started.md from top to bottom**

Check:
- [ ] ABOUTME headers present on lines 1–2
- [ ] Sections 1–5 present and in order (Install → Place → Refactor → MCP → Navigate)
- [ ] All five images render in VS Code Markdown preview
- [ ] Command palette strings match package.json exactly
- [ ] Existing "What's Next" playbook table unchanged
- [ ] Existing "Get Help" links unchanged
- [ ] README Quickstart section has the link

- [ ] **Step 2: Verify image paths work on GitHub**

Image references are `images/NN-name.png` (relative). Since the file is at
`packages/extension/resources/getting-started.md`, GitHub will resolve images from
`packages/extension/resources/images/` — correct.

- [ ] **Step 3: Final commit if fixes needed**

```bash
git add packages/extension/resources/getting-started.md README.md
git commit -m "docs(SML-1431): final review fixes"
```
