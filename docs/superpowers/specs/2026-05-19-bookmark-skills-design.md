# Bookmark Skills Design

**Ticket:** SML-1382  
**Date:** 2026-05-19  
**Status:** Approved (revised: removed repair skill and anchor_getRepairSkillGuide changes per Andrew's feedback)

## Problem

The agentic-bookmarks MCP exposes ~25 tools. Tool descriptions explain the mechanics but not the *when*, *why*, or *workflow* — agents must infer good patterns on their own. Skills encode reusable usage patterns so agents use the tools effectively without guesswork.

## Audience

End users of the extension in arbitrary repos. Skills must reach them without requiring manual installation.

## Distribution

**MCP resources.** Five skill guides are exposed as named MCP resources from the server. No files are written to the user's project. Content is always current (served by the running server). Discovery is wired into the tool descriptions of natural entry-point tools — a one-line hint pointing to the relevant resource.

This is consistent with the existing `anchor_getRepairSkillGuide` tool, which already delivers skill-like content through the MCP layer.

## Architecture

### Resources

Four skill resources, each a structured markdown playbook:

| Resource URI | Skill |
|---|---|
| `bookmarks://skill/add-to-system` | Bookmark key locations in a named subsystem |
| `bookmarks://skill/add-to-files` | Bookmark key locations in specific files |
| `bookmarks://skill/analyze` | Derive insights from existing bookmarks |
| `bookmarks://skill/map-codebase` | Full codebase pass, organized by system |

### Content storage

Skill markdown lives as string constants or static `.md` files in `packages/server/src/skills/`. The existing resource handler in `resource-handlers.ts` serves them.

## Skill Workflows

### `bookmarks://skill/add-to-system`

**Input:** System name (directory, feature area, or module).

**Workflow:**
1. Explore the system's files to understand its structure (entry points, exports, key types).
2. Place bookmarks at: entry points, exported interfaces, key algorithms, non-obvious decisions.
3. Group all bookmarks under a single group named after the system (e.g., `"Authentication"`).
4. Produce a brief summary of what was bookmarked and why.

### `bookmarks://skill/add-to-files`

**Input:** One or more file paths.

**Workflow:**
1. Read each file.
2. Place bookmarks at exported symbols, important internal functions, and code that would surprise a reader.
3. Group by file or by semantic theme across files.

Lighter-weight than `add-to-system` — no exploration phase, direct annotation only.

### `bookmarks://skill/analyze`

**Input:** Optional query or scope (defaults to all bookmarks).

**Workflow:**
1. Call `bookmark_search` or `bookmark_list` to load the current set.
2. Analyze for:
   - **Coverage:** which parts of the codebase are bookmarked vs. absent.
   - **Hotspots:** files/groups with dense annotation.
   - **Staleness:** bookmarks that may no longer reflect current code.
   - **Themes:** recurring patterns in labels/groups/tags.
3. Output a structured prose summary, not a raw list.

### `bookmarks://skill/map-codebase`

**Input:** None required (optional scope to limit the survey).

**Workflow:**
1. Survey the repo structure to identify major systems/modules.
   - Heuristic: aim for 5–15 systems; don't over-fragment. A system boundary is a directory or feature area with a clear single responsibility.
2. For each system, run the `add-to-system` workflow sequentially.
3. Result: a coherent, organized bookmark map of the whole codebase.

## Discovery Wiring

Tool descriptions get a one-line hint at the entry points agents naturally reach first:

| Tool(s) | Appended hint |
|---|---|
| `bookmark_add` | `"For guidance on bookmarking a system or set of files, read bookmarks://skill/add-to-system or bookmarks://skill/add-to-files."` |
| `bookmark_list`, `bookmark_search` | `"To derive insights from existing bookmarks, read bookmarks://skill/analyze. If no bookmarks exist yet, consider bookmarks://skill/map-codebase to build an initial map."` |

No other tools need hints — these three entry points cover the natural start of each workflow.
