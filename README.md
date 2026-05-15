# Agentic Bookmarks

![public beta](https://img.shields.io/badge/status-public%20beta-blue)

**Public beta:** all Pro features are free for everyone. Beta end date: **to be announced**.

**Agentic Bookmarks** — durable code bookmarks for you and your AI agents. Bookmarks survive refactors, merge cleanly when checked into git, and LLM agents can read, place, and repair them through MCP. Implemented in pure JavaScript with atomic JSON storage (no native dependencies).

> **Source-available repository.** The code in this repository is published under [PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0/) — see [`LICENSE`](LICENSE). The proprietary core that implements Agentic Bookmarks' Pro features is maintained in a separate private repository and is distributed only as a compiled artifact bundled with the Marketplace release.

## Important: add this line to your project's `.gitignore`

The extension stores machine-local runtime state (registry, lock/pulse cache, generated icons, logs) under `.bookmarks/local/`. **You should not commit any of it.** Add this single line to your project's `.gitignore`:

```
.bookmarks/local/
```

`.bookmarks/shared/` (team-distributable bookmark data) is intentionally *not* gitignored — that's the part you do want to share with collaborators. See [Workspace Layout](#workspace-layout) below for the full picture, including a transitional block of legacy paths to ignore for one release cycle if you're upgrading from a pre-0.5 version.

## 1: Setup

This project uses pnpm.

```bash
pnpm install
mkdir dist
```

## 2: Installing and using plugin
```bash
# you have to do the setup steps once
# build and package the project with this command:
pnpm package

# this command will install/reinstall the built package to VS-CODE 
# if you are actually using the plugin to test you need to do this.
# note it will not refresh unless you turn it off and back on again...
pnpm package:update

#more below , NOT DONE YET:

```
### 3: IMPORTANT step:
### go to the plugins tab for "bookmarks mcp" and click:
1. disable
2. restart  <<- this is important
3. enable 

### 4: IMPORTANT for when there are MCP changes
First of all, for the mcp updates to work well the version will need to be bumped. you can see that below

If YOU made the MCP changes, you will need to bump the patch version (see below)

For MCP update in claude code run this first:

```bash
# uninstall the MCP server
claude mcp remove bookmarks
```
then run. (ctrl-shift-p  /  command-shift-p)
"MCP Bookmarks: setup for claude" 

This will re-intsall the latest. 
This will be different with other agents and could have some variablity.
I think there is a sanity check on MCP version, maybe status but I forget off the top of my head and need to update this doc later


## bumping version with fixes/updates:

```bash
# you need to increment the version (in this example it is the patch version)
# also possible to increment minor/major. but should plan with team.
pnpm increment:patch
```

## end of initial install iteration steps
---

## Dev commands

```bash
# Build all packages
pnpm build

# Build with watch mode
pnpm build:watch

# Package the extension into VSIX
pnpm package
```

## Testing

Tests use [Vitest](https://vitest.dev/) and run across all packages.

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test -- --watch
```

### Running specific test suites

```bash
# Core unit tests (schema, anchors, context search, filtering, etc.)
pnpm test packages/core/src/schema_v2.test.ts
pnpm test packages/core/src/anchors.test.ts
pnpm test packages/core/src/context-search/search.test.ts

# Git history tests (requires git)
pnpm test packages/core/src/git-history/git-history.test.ts

# Anchor repair tests — integration tests that create temp git repos with
# multi-commit fixture histories to verify diff diagnosis and moved code search
pnpm test packages/core/src/anchor-repair.test.ts
```

### Test structure

| Test file | What it covers |
|-----------|---------------|
| `packages/core/src/anchors.test.ts` | Anchor creation, resolution, smart/tag/point types |
| `packages/core/src/anchor-conversion.test.ts` | Converting between anchor types |
| `packages/core/src/anchor-repair.test.ts` | Diff diagnosis (shifted/exact/fuzzy/no_match), cross-file movement search |
| `packages/core/src/context-search/search.test.ts` | Fuzzy line matching and context scoring |
| `packages/core/src/git-history/git-history.test.ts` | Blame, diff, patch sequence, line tracing |
| `packages/core/src/store.test.ts` | Atomic JSON read/write with locking |
| `packages/core/src/registry.test.ts` | Workspace registry operations |
| `packages/core/src/filter.test.ts` | Bookmark filtering |
| `packages/core/src/schema_v2.test.ts` | Zod schema validation |

### Integration tests

The anchor repair and git history test suites are integration tests — they create temporary git repos with multi-commit histories, run real `git` operations against them, and clean up automatically. No manual setup required; `pnpm test` runs them alongside everything else.

```bash
# Run just the integration tests
pnpm test packages/core/src/anchor-repair.test.ts
pnpm test packages/core/src/git-history/git-history.test.ts
```

**Prerequisite:** `git` must be available in PATH.

**What the anchor repair tests cover:**
- Line shift detection (insertions above push a bookmarked line down)
- Exact match (anchor content found at a new location in the file)
- Fuzzy match (anchor content was edited slightly)
- No match / full diff fallback (content deleted entirely)
- Cross-file movement (code moved from one file to another)
- Point anchors (no content to search — immediate fallback)
- Deleted files (empty hunks)

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

## Codanna (Code Intelligence)

```bash
# Index the codebase (init downloads ML models)
codanna init
codanna index packages

# Setup docs RAG
codanna documents add-collection docs ./docs
codanna documents index
```

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
