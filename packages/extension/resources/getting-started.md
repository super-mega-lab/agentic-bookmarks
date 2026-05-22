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

Open any file. Right-click the **line number** (the gutter on the left) and choose
**Add Labeled Bookmark**.

![Right-click context menu showing Add Bookmark](images/02-context-menu.png)

A quick-pick prompt asks for a **label**. Type something meaningful — "auth boundary",
"main render loop", "the 3am hack" — and press Enter.

A pin appears in the editor gutter and the bookmark shows up in the **Agentic Bookmarks** sidebar
(click the bookmark icon in the Activity Bar to open it if it isn't already visible).

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
**"Agentic Bookmarks: Setup for"**.

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
to filter by label, group, or tag.

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
