# Agentic Bookmarks

![public beta](https://img.shields.io/badge/status-public%20beta-blue)

Your AI coding agent loses context every session. **Agentic Bookmarks** fixes that: durable, self-healing bookmarks that agents can read, place, and repair through a bundled MCP server. They survive refactors, check into git, and give your whole team — humans and agents — persistent codebase knowledge.

The extension collects no usage telemetry. Pure JavaScript, no native dependencies. Source-available under [PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0/) — see [`LICENSE`](LICENSE).

> **Public beta:** all Pro features are free for everyone, no account required. Beta end date: **to be announced**.
>
> **Not stand-alone buildable.** `pnpm install` depends on the private `@agentic-bookmarks/core` sibling and will fail without it. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=supermegalab.agentic-bookmarks) — the contents here exist so the network-facing portions can be independently audited (see [`SECURITY.md`](SECURITY.md)).

## Important: add this line to your project's `.gitignore`

The extension stores machine-local runtime state (registry, lock/pulse cache, generated icons, logs) under `.bookmarks/local/`. **You should not commit any of it.** Add this single line to your project's `.gitignore`:

```
.bookmarks/local/
```

`.bookmarks/shared/` (team-distributable bookmark data) is intentionally *not* gitignored — that's the part you do want to share with collaborators. See [Workspace Layout](#workspace-layout) below for the full picture, including a transitional block of legacy paths to ignore for one release cycle if you're upgrading from a pre-0.5 version.

## What can your agent do?

Once the MCP server is connected, your AI assistant can:

- **Place bookmarks** during research — "bookmark the auth boundary and the rate limiter"
- **Read bookmarks as context** — "what bookmarks exist in this module?"
- **Map an entire codebase** — "map this codebase with bookmarks" (uses built-in skill guide)
- **Repair broken bookmarks** — structured diagnostic waterfall for bookmarks that drifted during large refactors

28 MCP tools cover the full lifecycle: create, read, search, organize, validate, and repair.

## Quickstart

1. Install **"Agentic Bookmarks"** by supermegalab from the VS Code extension browser
2. `Cmd+Shift+P` → **"Agentic Bookmarks: Setup for Claude Code"** (or Cursor / Codex) — this also handles `.gitignore`
3. Start placing bookmarks — your agent can too

→ **[Full Getting Started guide with screenshots](packages/extension/resources/getting-started.md)**

## MCP Server Setup

The extension bundles an MCP server that exposes bookmark tools to AI coding assistants. After installing or updating the extension, you need to register the server with your tool of choice.

**VS Code:** No setup needed. The extension registers the bundled server via `vscode.lm.registerMcpServerDefinitionProvider`, so it appears in VS Code's MCP server list automatically on activation.

**Claude Code, Cursor, and Codex:** run a setup command from the VS Code Command Palette (`Cmd+Shift+P`). Each command prompts for an install scope.

| Command | What it does |
|---------|-------------|
| **MCP Bookmarks: Setup for Claude Code** | Runs `claude mcp add` in a terminal. Prompts for scope: **Local** (this project only) or **User** (all your projects). |
| **MCP Bookmarks: Setup for Cursor** | Writes Cursor's `mcp.json`. Prompts for scope: **Project** (`.cursor/mcp.json`) or **Global** (`~/.cursor/mcp.json`). |
| **MCP Bookmarks: Setup for Codex** | Writes Codex's `config.toml`. Prompts for scope: **Project** (`.codex/config.toml`) or **Global** (`~/.codex/config.toml`). |

### Iteration notes

For Cursor and Codex, the setup command rewrites the `mcp_bookmarks` entry in place — re-running after a rebuild is the fastest update loop. For Claude Code, re-running emits a fresh `claude mcp add`; if it errors because an entry already exists, remove it first:

```bash
claude mcp remove mcp_bookmarks                # local scope
claude mcp remove mcp_bookmarks --scope user   # user scope
```

Then re-run **MCP Bookmarks: Setup for Claude Code** from the Command Palette.

## Workspace Layout

The extension stores its data under `.bookmarks/` at the workspace root:

| Path | Checked in? | Purpose |
|------|-------------|---------|
| `.bookmarks/shared/` | yes | Team-distributable bookmark data files |
| `.bookmarks/local/` | no (gitignored) | Per-machine state: registry, default local bookmarks file, lock/pulse cache, icon SVGs, logs |

A single `.gitignore` line — `.bookmarks/local/` — covers all machine-local runtime state.

### Migrating from earlier versions

Workspaces last touched by an older build will have files at legacy locations:

- `.vscode/bookmarks.registry.json` (and `.bak`)
- `.vscode/bookmark-icon-cache/`
- `.bookmarks/.cache/` (root-level)
- `.bookmarks/logs/` (root-level)
- `.bookmarks/styles/` (root-level — retired in v0.5; the catalog now lives in the extension bundle)

The first four are auto-migrated into `.bookmarks/local/` on activation. The migration is idempotent and never overwrites a file that already exists at the destination — so a second run, or running on a partially migrated workspace, is safe.

`.bookmarks/styles/` is **not** auto-deleted (it's inert, gitignored, and harmless). To clean it up — along with any other legacy directories left behind — run **MCP Bookmarks: Clean Legacy Files (dev helper)** from the command palette. Safe to run repeatedly.

The legacy `.gitignore` lines for those paths are kept in this repo for one release cycle so unmigrated coworkers don't accidentally commit pre-migration files.

## Running the MCP server without the VS Code extension

The MCP server is a standalone Node program bundled at `packages/extension/server-bundle/index.js` (built by `pnpm package`). It can be run on its own — without the VS Code extension — and that's a perfectly supported configuration. Common cases include:

- **Agent setups** (Claude Code, Cursor, Codex, custom MCP clients) running headless against a project directory.
- **Automation / CI** that needs to read bookmark data programmatically.
- **Cross-IDE use** where bookmarks data is shared across editors but only one of them has the extension installed.

### Default behavior — no configuration needed

When launched from inside a workspace (e.g. via stdio from an MCP client whose `cwd` is the project root), the server walks upward looking for a `.bookmarks/local/bookmarks.registry.json` sentinel and uses the workspace it finds. If your project uses the default `.bookmarks/` data root, **nothing else is required** — point your MCP client at the bundle and it works.

### Customizing the data root

If you've changed the data root from `.bookmarks/` to something else (via the `bookmarks.dataRoot` workspace setting, or because your project already had a `.bookmarks/` folder for an unrelated purpose), the server's upward-walk discovery won't find your registry on its own. In that case, **set the `BOOKMARKS_DIR` env var** to point at the local dir explicitly:

```bash
BOOKMARKS_DIR=/path/to/project/.your-data-root/local node packages/extension/server-bundle/index.js
```

The same env var goes into the `env` block of any MCP client config file. For example, in `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mcp_bookmarks": {
      "command": "node",
      "args": ["/abs/path/to/server-bundle/index.js"],
      "env": {
        "BOOKMARKS_DIR": "${workspaceFolder}/.your-data-root/local"
      }
    }
  }
}
```

The extension's "MCP Bookmarks: Write …" commands generate these config files for you with the correct `BOOKMARKS_DIR` already filled in. If you're hand-rolling the config, that env var is the one knob you need.

## Legal

### License and acceptance

Agentic Bookmarks is **source-available** under the
[PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0/)
license — see [`LICENSE`](LICENSE). In short: you can use, read, modify, and
share the source for any purpose **except** offering it as a competing
product. The proprietary core (described at the top of this README) is
not source-available and is governed solely by the Provider-Specific
Terms.

**By installing or using Agentic Bookmarks, you agree to:**

- the [End User License Agreement](https://agenticbookmarks.com/legal/eula)
  (Bonterms Standard End User Agreement v1.0),
- the [Provider-Specific Terms](https://agenticbookmarks.com/legal/terms),
  including the
  [Beta and Pro Features Policy](https://agenticbookmarks.com/legal/policy),
- the [Privacy Policy](https://agenticbookmarks.com/legal/privacy), and
- where it applies to your use of the extension, the
  [Data Processing Addendum](https://agenticbookmarks.com/legal/dpa).

If you do not agree to these, please do not install or use the extension.

### Links

- Product page: <https://agenticbookmarks.com>
- Company / Publisher: <https://supermegalab.com>
- Privacy Policy: <https://agenticbookmarks.com/legal/privacy>
- Security Overview: <https://agenticbookmarks.com/legal/security>
- Provider-Specific Terms: <https://agenticbookmarks.com/legal/terms>
- End User License Agreement: <https://agenticbookmarks.com/legal/eula>
- Data Processing Addendum: <https://agenticbookmarks.com/legal/dpa>
- Data Handling Statement: <https://agenticbookmarks.com/legal/data-handling>
- Beta and Pro Features Policy: <https://agenticbookmarks.com/legal/policy>
- Sub-processor list: <https://agenticbookmarks.com/legal/subprocessors>
- License (PolyForm Shield 1.0.0): [`LICENSE`](LICENSE)
