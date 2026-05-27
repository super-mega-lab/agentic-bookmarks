# Agent Connections — Help

The **Agent connections** section of the Welcome panel lets you connect Agentic Bookmarks to your AI coding agent of choice via MCP (Model Context Protocol).

Each agent integration can be installed at one or two scopes:

| Agent | Scope A | Scope B |
|---|---|---|
| **Claude Code** | Local (this project only) | User (all your projects) |
| **Cursor** | Project (`.cursor/mcp.json`) | Global (`~/.cursor/mcp.json`) |
| **Codex** | Project (`.codex/config.toml`) | Global (`~/.codex/config.toml`) |

## Empty state

When no agents are connected, the panel shows a hero row of **Connect to …** buttons — one for each known agent. Click one to install Agentic Bookmarks for that agent; you'll be prompted to choose a scope.

## Connected state

Once at least one agent is installed in any scope, the panel switches to a list of connected agents.

### Update all MCPs banner

If any installed scope of any agent is on an older extension version, a primary **Update all MCPs** button appears directly below the section header. Clicking it walks every outdated scope across every agent and re-runs setup. Each step is wrapped in error handling so a failure on one agent doesn't stop the rest, and the result is reported in a summary toast — e.g. *"Updated 3 scopes."* or, on partial failure, *"Updated 2 of 3 scopes; 1 failed — see the Agentic Bookmarks output channel."*

### Per-agent rows

Each connected agent renders as a row showing:

- The agent name.
- The scope(s) it is installed in, and the recorded extension version. An `(older)` tag appears if any scope is on an older version.
- A status indicator on the right:
  - A green **✓ Up to date** pill when every installed scope is on the current extension version.
  - A blue **Update MCP** button when any installed scope is outdated. Clicking it re-runs setup at every installed scope in one pass — no scope picker prompt. For Claude this is a single combined terminal invocation so a dual-scope update doesn't have one scope wipe the other.
- A hamburger (`⋮`) menu with these items, in order:
  - **Install in &lt;other scope&gt;** — only listed for scopes not yet installed.
  - **Reinstall (&lt;scope&gt;)** — one item per currently-installed scope. Re-runs setup at that specific scope.
  - **Uninstall (&lt;scope&gt;)** — one item per currently-installed scope.
  - **Open &lt;agent&gt; docs** — link to the agent's MCP documentation page.

### Connect another agent footer

A subdued **Connect another agent…** button appears below the rows whenever at least one known agent has zero scopes installed. It opens a quick-pick of those agents and runs the standard setup flow (scope picker included) for whichever you pick.

## Installing at both scopes

If you try to add a second scope while another is already installed — for example installing at **User** when **Local** is already set up — a confirmation dialog appears first. Having both registrations active simultaneously is allowed by the agent CLIs, but it can be confusing to manage — the agent will typically use one and ignore the other. The recommended pattern is to uninstall the existing scope first if you want to switch. Choose **Proceed** to install at both anyway, **Help** to revisit this page, or **Cancel** to abort.

The warning does **not** fire when you're re-installing at a scope that's *already* installed (Update MCP, Reinstall, or Update all MCPs) — those operations don't add a new scope, so no new ambiguity is being introduced.

## Safety

Uninstall operations either use the agent's own CLI (Claude Code: `claude mcp remove`) or perform a tightly bounded edit of the agent's config file (Cursor, Codex). For the file-edit cases, the original config is backed up to `<path>.agentic-bookmarks-backup` before the write, and the new content is written via a `.tmp` file then renamed atomically. If the config file is malformed or our entry isn't present, the uninstall is a no-op — we never rewrite a file we can't safely parse.

## Collapsing sections

The **Agent connections** header, like **Learn** and **Community & Support**, can be collapsed by clicking the row's title or chevron. The collapsed state is remembered across reloads. Use this to keep frequently-needed sections close to the top of the panel.
