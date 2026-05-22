# QUICKSTART.md Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `QUICKSTART.md` at the repo root that walks a new user through the full Agentic Bookmarks core loop (install → bookmark → survive refactor → MCP agent setup), illustrated with screenshots.

**Architecture:** Single `QUICKSTART.md` at repo root, linear narrative across four chapters. Screenshots stored under `docs/images/quickstart/` as relative references. README gets one added link. Marc takes screenshots alongside writing — the guide is written first with `TODO` placeholders, then screenshots are dropped in.

**Tech Stack:** Markdown, VS Code extension UI (for screenshots), git

**Spec:** `docs/superpowers/specs/2026-05-22-quickstart-guide-design.md`

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `QUICKSTART.md` | The user-facing getting started guide |
| Create | `docs/images/quickstart/` | Directory for guide screenshots |
| Modify | `README.md` | Add one link to QUICKSTART.md in the Quickstart section |

---

### Task 1: Scaffold image directory and QUICKSTART skeleton

**Files:**
- Create: `docs/images/quickstart/.gitkeep`
- Create: `QUICKSTART.md`

- [ ] **Step 1: Create image directory**

```bash
mkdir -p docs/images/quickstart
touch docs/images/quickstart/.gitkeep
```

- [ ] **Step 2: Create QUICKSTART.md skeleton**

Create `QUICKSTART.md` at repo root with the following content:

```markdown
<!-- ABOUTME: User-facing getting started guide covering the full Agentic Bookmarks core loop. -->
<!-- ABOUTME: Covers install, bookmark placement, refactor survival, and MCP agent setup. -->

# Quickstart

Most code bookmarks break the moment you rename a file or move a function.
Agentic Bookmarks fixes that: bookmarks survive refactors via self-healing anchors, check into git
so your whole team shares them, and are readable by AI agents through a bundled MCP server.

This guide takes you from a fresh install to your first shared, agent-accessible bookmark in about
five minutes.

---

## Chapter 1: Install

## Chapter 2: Place your first bookmark

## Chapter 3: Watch it survive a refactor

## Chapter 4: Connect your AI agent

---

## What's next
```

- [ ] **Step 3: Verify the file renders**

Open `QUICKSTART.md` in VS Code's Markdown preview (Cmd+Shift+V / Ctrl+Shift+V). Confirm the skeleton renders without errors.

- [ ] **Step 4: Commit**

```bash
git add docs/images/quickstart/.gitkeep QUICKSTART.md
git commit -m "docs(SML-1431): scaffold QUICKSTART.md and image directory"
```

---

### Task 2: Write Chapter 1 — Install

**Files:**
- Modify: `QUICKSTART.md` (Chapter 1 section)

- [ ] **Step 1: Write Chapter 1 content**

Replace the `## Chapter 1: Install` heading in `QUICKSTART.md` with:

```markdown
## Chapter 1: Install

Search for **"Agentic Bookmarks"** in the VS Code Extensions panel (`Cmd+Shift+X` / `Ctrl+Shift+X`)
and click **Install**. Publisher: **supermegalab**.

![Extension installed in VS Code Extensions panel](docs/images/quickstart/01-install.png)

> **One-time setup:** add this line to your project's `.gitignore` so machine-local state never
> gets committed:
>
> ```
> .bookmarks/local/
> ```
>
> Or run **Agentic Bookmarks: Add .bookmarks/local/ to .gitignore** from the command palette
> (`Cmd+Shift+P`) to have the extension do it for you.
```

- [ ] **Step 2: Take Screenshot 1**

In VS Code, open the Extensions panel and find Agentic Bookmarks with the "Installed" badge visible.
Screenshot filename: `docs/images/quickstart/01-install.png`

- [ ] **Step 3: Verify Markdown preview**

Open `QUICKSTART.md` preview. Confirm the image renders (will show broken image until the file exists, but the link path should be correct). Confirm the gitignore block renders as a blockquote with a code block inside.

- [ ] **Step 4: Commit**

```bash
git add QUICKSTART.md docs/images/quickstart/01-install.png
git commit -m "docs(SML-1431): add Chapter 1 Install with screenshot"
```

Note: if the screenshot isn't ready yet, commit without it and amend later, or use a placeholder:
```bash
git add QUICKSTART.md
git commit -m "docs(SML-1431): add Chapter 1 Install (screenshot pending)"
```

---

### Task 3: Write Chapter 2 — Place your first bookmark

**Files:**
- Modify: `QUICKSTART.md` (Chapter 2 section)

- [ ] **Step 1: Write Chapter 2 content**

Replace the `## Chapter 2: Place your first bookmark` heading with:

```markdown
## Chapter 2: Place your first bookmark

Open any file in your project. Right-click on a line you want to bookmark — the start of a
function, a tricky algorithm, a known trouble spot — and choose **Add Bookmark**.

![Right-click context menu showing Add Bookmark](docs/images/quickstart/02-context-menu.png)

A quick-pick prompt asks for a **label**. Type something meaningful — "auth boundary",
"main render loop", "the 3am hack" — and press Enter.

The bookmark is placed: a pin appears in the editor gutter and the bookmark shows up in the
**Agentic Bookmarks** sidebar panel under its group.

![Gutter pin and sidebar tree showing the new bookmark](docs/images/quickstart/03-pin-and-sidebar.png)

To navigate back to any bookmark at any time, click it in the sidebar.
```

- [ ] **Step 2: Take Screenshot 2**

Right-click on a line in a code file to show the context menu with "Add Bookmark" visible.
Screenshot filename: `docs/images/quickstart/02-context-menu.png`

- [ ] **Step 3: Take Screenshot 3**

After placing a bookmark with a label, capture the editor (showing the gutter pin) alongside the
Agentic Bookmarks sidebar (showing the bookmark entry with label).
Screenshot filename: `docs/images/quickstart/03-pin-and-sidebar.png`

- [ ] **Step 4: Verify Markdown preview**

Open preview. Confirm both images render (or show expected broken-image placeholders until files exist). Confirm the prose flows naturally between screenshots.

- [ ] **Step 5: Commit**

```bash
git add QUICKSTART.md docs/images/quickstart/02-context-menu.png docs/images/quickstart/03-pin-and-sidebar.png
git commit -m "docs(SML-1431): add Chapter 2 Place your first bookmark with screenshots"
```

---

### Task 4: Write Chapter 3 — Watch it survive a refactor

**Files:**
- Modify: `QUICKSTART.md` (Chapter 3 section)

- [ ] **Step 1: Write Chapter 3 content**

Replace the `## Chapter 3: Watch it survive a refactor` heading with:

```markdown
## Chapter 3: Watch it survive a refactor

This is where Agentic Bookmarks earns its name.

Rename the function your bookmark is on — or cut a few lines and paste them somewhere else in
the file. Go ahead, do a real edit.

Now click the bookmark in the sidebar. It navigates to the **correct code** at its new location,
not the stale line number where it used to be.

![Editor after renaming the function — pin still on the right line](docs/images/quickstart/04-post-refactor.png)

**How it works:** the bookmark stores enough surrounding context to re-find its line as code
drifts. This is called a *smart anchor*. Small edits — renames, insertions, moves — don't break
it. When a change is too drastic for automatic recovery, the extension shows a warning and a
one-click repair flow.
```

- [ ] **Step 2: Take Screenshot 4**

Rename a function that has a bookmark on it, then show the editor with the bookmark pin
still correctly placed on the renamed code.
Screenshot filename: `docs/images/quickstart/04-post-refactor.png`

- [ ] **Step 3: Verify Markdown preview**

Confirm the chapter renders cleanly. The italicized "smart anchor" term should render correctly.

- [ ] **Step 4: Commit**

```bash
git add QUICKSTART.md docs/images/quickstart/04-post-refactor.png
git commit -m "docs(SML-1431): add Chapter 3 refactor survival with screenshot"
```

---

### Task 5: Write Chapter 4 — Connect your AI agent

**Files:**
- Modify: `QUICKSTART.md` (Chapter 4 section)

- [ ] **Step 1: Write Chapter 4 content**

Replace the `## Chapter 4: Connect your AI agent` heading with:

```markdown
## Chapter 4: Connect your AI agent

The extension bundles an MCP server that lets your AI coding assistant read, place, and repair
bookmarks. Setup takes one command.

Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and type **"Agentic Bookmarks: Setup"**.
You'll see setup commands for Claude Code, Cursor, and Codex.

![Command palette showing Agentic Bookmarks setup commands](docs/images/quickstart/05-mcp-setup.png)

Pick the one for your tool:

### Claude Code

Select **Agentic Bookmarks: Setup for Claude Code**. A terminal opens and runs `claude mcp add`.
Choose **Local** (this project only) or **User** (all your projects).

### Cursor

Select **Agentic Bookmarks: Setup for Cursor**. Choose **Project** (writes `.cursor/mcp.json`)
or **Global** (writes `~/.cursor/mcp.json`).

### Codex

Select **Agentic Bookmarks: Setup for Codex**. Choose **Project** (writes `.codex/config.toml`)
or **Global** (writes `~/.codex/config.toml`).

---

**Verify it's working:** ask your agent:

> "List my bookmarks"

It should respond with the bookmark you placed in Chapter 2, including its label and file location.
```

- [ ] **Step 2: Take Screenshot 5**

Open the command palette and type "Agentic Bookmarks: Setup" so all three setup commands are visible.
Screenshot filename: `docs/images/quickstart/05-mcp-setup.png`

- [ ] **Step 3: Verify Markdown preview**

Confirm the three sub-headings render correctly (h3 inside h2). Confirm the blockquote for the verify step renders as a blockquote.

- [ ] **Step 4: Commit**

```bash
git add QUICKSTART.md docs/images/quickstart/05-mcp-setup.png
git commit -m "docs(SML-1431): add Chapter 4 MCP agent setup with screenshot"
```

---

### Task 6: Write What's Next and finalize

**Files:**
- Modify: `QUICKSTART.md` (What's next section and any final polish)

- [ ] **Step 1: Write What's Next content**

Replace the `## What's next` heading with:

```markdown
## What's next

- **[README](README.md)** — workspace layout, custom data root, running the MCP server without VS Code
- **Repair** — when an anchor drifts beyond automatic recovery, the sidebar shows a warning. Right-click the broken bookmark for the one-click repair flow, or ask your agent to run a guided repair.
- **Agent skill guides** — your AI agent has built-in playbooks for bookmark-driven research: bookmarking a subsystem, annotating files, mapping a codebase from scratch. Ask it: "What bookmark skills do you have?"
```

- [ ] **Step 2: Do a full read-through of QUICKSTART.md**

Read the entire document from top to bottom. Check:
- [ ] No orphaned TODO or placeholder text
- [ ] All five image references use the correct relative path `docs/images/quickstart/NN-name.png`
- [ ] Chapter numbers are sequential (1–4)
- [ ] Command palette strings match exactly: "Agentic Bookmarks: Setup for Claude Code", "Agentic Bookmarks: Setup for Cursor", "Agentic Bookmarks: Setup for Codex"
- [ ] The gitignore line in Chapter 1 is `.bookmarks/local/` (with trailing slash)

- [ ] **Step 3: Commit**

```bash
git add QUICKSTART.md
git commit -m "docs(SML-1431): add What's next section and final polish"
```

---

### Task 7: Update README to link to QUICKSTART.md

**Files:**
- Modify: `README.md` (Quickstart section)

- [ ] **Step 1: Find the current Quickstart section in README.md**

The README currently has a `## Quickstart` section with three bullet points ending in "videos coming soon."

- [ ] **Step 2: Add the link**

After the existing bullet points in the `## Quickstart` section, add one line:

```markdown
→ **[Full Quickstart with screenshots](QUICKSTART.md)**
```

The resulting section should look like:

```markdown
## Quickstart

- install "Agentic Bookmarks" by supermegalab extension from VS Code extension browser
- Optional, but awesome: setup the MCP to work with the agent of your choice
  - ctrl-shift-p / cmd-shift-p and type "Agentic Bookmarks: setup" to see options for setting up the MCP server
  - for claude, select Local (this project only) or User (all your projects) based on your preference

That's all. See the Marketplace page for more details — videos coming soon.

→ **[Full Quickstart with screenshots](QUICKSTART.md)**
```

- [ ] **Step 3: Verify README preview**

Open `README.md` in Markdown preview. Confirm the link renders correctly and points to `QUICKSTART.md`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(SML-1431): link QUICKSTART.md from README"
```

---

### Task 8: Screenshot integration pass

**Files:**
- Modify: `docs/images/quickstart/` (add any missing screenshots)
- Modify: `QUICKSTART.md` (fix any image paths if screenshots were named differently)

This task is for integrating screenshots taken during Tasks 2–5. If all five screenshots are already committed, this task is a verification pass only.

- [ ] **Step 1: Verify all five screenshots exist**

```bash
ls -la docs/images/quickstart/
```

Expected output includes:
```
01-install.png
02-context-menu.png
03-pin-and-sidebar.png
04-post-refactor.png
05-mcp-setup.png
```

- [ ] **Step 2: Open QUICKSTART.md in Markdown preview**

All five images should render without broken-image icons. If any are broken, check the file name matches the reference in `QUICKSTART.md` exactly (case-sensitive).

- [ ] **Step 3: Remove .gitkeep if all screenshots are in place**

```bash
git rm docs/images/quickstart/.gitkeep
```

- [ ] **Step 4: Final commit**

```bash
git add docs/images/quickstart/
git commit -m "docs(SML-1431): add all quickstart screenshots"
```

---

### Task 9: Final review pass

**Files:** (read-only review)

- [ ] **Step 1: Read the complete QUICKSTART.md from start to finish**

Verify:
- [ ] Intro clearly states the problem (bookmarks break on rename) and the payoff (5 minutes to first agent-accessible bookmark)
- [ ] All four chapters are present and sequentially numbered
- [ ] Every screenshot renders in VS Code Markdown preview
- [ ] Command palette strings are exact (search for "Agentic Bookmarks" in the file — should match what the extension uses)
- [ ] The What's Next section has three entries and the README link is a working relative link
- [ ] No broken Markdown syntax (unclosed bold/italic, malformed image tags)

- [ ] **Step 2: Click-test the README link**

From `README.md` preview, click `QUICKSTART.md` link. Confirm it opens the file.

- [ ] **Step 3: Verify ABOUTME headers are present**

```bash
head -2 QUICKSTART.md
```

Expected:
```
<!-- ABOUTME: User-facing getting started guide covering the full Agentic Bookmarks core loop. -->
<!-- ABOUTME: Covers install, bookmark placement, refactor survival, and MCP agent setup. -->
```

- [ ] **Step 4: Final commit (if any fixes were made)**

```bash
git add QUICKSTART.md README.md
git commit -m "docs(SML-1431): final review fixes"
```
