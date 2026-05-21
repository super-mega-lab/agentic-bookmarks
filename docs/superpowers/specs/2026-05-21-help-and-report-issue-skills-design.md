# Design: Help, Report-Issue Skills + Getting Started README

**Date:** 2026-05-21
**Status:** Approved

## Overview

Add two new MCP skill resources (`bookmarks://skill/help` and `bookmarks://skill/report-issue`) alongside a bundled first-use README that opens from the Welcome panel. All three are independent deliverables that can be implemented and shipped separately.

---

## 1. New MCP Skill Resources

Both follow the existing pattern: exported string constants in `packages/server/src/skills/index.ts`, registered in `packages/server/src/resource-handlers.ts`.

### `bookmarks://skill/help`

A workflow guide for common bookmark tasks. Written as instructions for an AI agent to read and then walk the user through or answer their question. Covers:

- **Adding bookmarks** — manually via the panel, and via `bookmark_add` through an agent
- **Navigating to a bookmark** — opening a bookmark from the panel or via MCP
- **Organizing with groups** — creating groups, moving bookmarks, naming conventions
- **Searching** — using `bookmark_search` with filters (group, tag, query)
- **Repairing broken anchors** — when and why anchors break, using `anchor_listBroken` and `anchor_repair`
- **Choosing the right skill playbook** — when to use `map-codebase` vs. `add-to-system` vs. `add-to-files` vs. `analyze`

Tone and length: similar to the existing `SKILL_ANALYZE` — direct, concise, agent-readable.

### `bookmarks://skill/report-issue`

A diagnostic-gathering workflow that ends with a ready-to-submit GitHub issue and contact links. Agent steps:

1. Call `mcp_debug` to collect version and configuration info
2. Ask the user to describe the problem: steps to reproduce, what was expected, what actually happened
3. Format the gathered info as a GitHub issue body (markdown, with a `### Diagnostics` section from `mcp_debug` output)
4. Present the issue body to the user and provide the three contact points:
   - **File an issue:** `https://github.com/super-mega-lab/agentic-bookmarks/issues/new`
   - **Discord (faster response):** `https://discord.gg/zukZdvqf8q`
   - **Email:** `contact@supermegalab.com`

### Registration

In `resource-handlers.ts`, add to the existing `SKILL_RESOURCES` map and the `listResources` array alongside the four existing skill entries. No other server changes needed.

---

## 2. First-Use README

### File

`packages/extension/resources/getting-started.md` — bundled inside the VSIX. The `resources/` directory is not listed in `.vscodeignore`, so it is included automatically.

### Content outline

```
# Getting Started with Agentic Bookmarks

One-line description: what the extension does.

## Quick Start (4 steps)
1. Install the extension
2. Open the Welcome panel (Activity Bar → bookmark icon)
3. Run MCP setup for your AI assistant
4. Place your first bookmark

## What's Next
Brief intro to the four AI skill playbooks with one-line descriptions each:
- /map-codebase — survey the whole repo
- /add-to-system — bookmark a specific module
- /add-to-files — annotate specific files
- /analyze — review and health-check existing bookmarks

## Get Help
- Discord: https://discord.gg/zukZdvqf8q
- GitHub Issues: https://github.com/super-mega-lab/agentic-bookmarks/issues/new
- Email: contact@supermegalab.com
```

### VS Code command

`agenticBookmarks.openGettingStarted` — registered in `extension.ts`, opens `resources/getting-started.md` as a markdown preview:

```ts
vscode.commands.registerCommand('agenticBookmarks.openGettingStarted', () => {
  const uri = vscode.Uri.joinPath(context.extensionUri, 'resources', 'getting-started.md');
  void vscode.commands.executeCommand('markdown.showPreview', uri);
})
```

Also added to `package.json` `contributes.commands` so it appears in the command palette as "Agentic Bookmarks: Open Getting Started Guide".

---

## 3. Welcome Panel Integration

In `welcomeHtml.ts`, add a "Getting Started" section at the top of `activeBody()`, before the existing "Learn" section:

```html
<section>
  <div class="button-row">
    <a class="button" href="${runCmd('agenticBookmarks.openGettingStarted')}">Getting Started Guide</a>
  </div>
</section>
```

This is a primary-style button (same as the MCP setup buttons). Placement above "Learn" ensures new users see it first. No change to `emptyBody()` — the guide isn't useful without a folder open.

---

## Out of scope

- Slash command delivery for the new skills (covered by the existing open design question about static vs. refresh delivery for all six skills)
- In-extension feedback form
- Changes to the `mcp_debug` tool output format
