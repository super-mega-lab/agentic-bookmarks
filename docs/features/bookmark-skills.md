# Feature Status: Bookmark Skill Guides

**Status:** Shipped (MCP-resource delivery only — no slash commands yet)
**Ticket:** SML-1382
**Landed:** commit `4c7f4af` — *feat(SML-1382): expose bookmark skill guides as MCP resources (#10)*
**Last reviewed:** 2026-05-20

## Summary

Four reusable "skill guides" — structured markdown playbooks that tell an AI agent
*when*, *why*, and *how* to use the bookmark tools — now ship with the MCP server.
They are exposed as **named MCP resources** under the `bookmarks://skill/*` URI space.

The motivation: the MCP exposes ~25 tools whose descriptions cover mechanics but not
workflow. The skills encode reusable usage patterns so agents apply the tools well
without guessing.

### Delivery mechanism

- **Distribution is via MCP resources, not slash commands and not files on disk.**
  Nothing is written into the user's project; the running server serves the content,
  so it is always current.
- Content lives as string constants in `packages/server/src/skills/index.ts`.
- The resource map and the `list`/`read` resource handlers live in
  `packages/server/src/resource-handlers.ts` (`SKILL_RESOURCES`).
- Each guide is served as `mimeType: text/markdown`.

> Note: these are *not yet* surfaced as slash commands in any client. Today an agent
> reaches them only by reading the MCP resource (typically prompted by the discovery
> hints below). Promoting them to slash commands is possible follow-up work.

### Discovery

Discovery is wired into the descriptions of the natural entry-point tools, so an agent
is pointed at the right guide as it starts a workflow:

| Tool(s)                        | Appended hint                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `bookmark_add`                 | "For guidance on bookmarking a system or set of files, read `bookmarks://skill/add-to-system` or `bookmarks://skill/add-to-files`."             |
| `bookmark_list`, `bookmark_search` | "To derive insights from existing bookmarks, read `bookmarks://skill/analyze`. If no bookmarks exist yet, consider `bookmarks://skill/map-codebase` to build an initial map." |

## The four skills

### 1. `bookmarks://skill/add-to-system`

**Resource name:** *Skill: Bookmark a subsystem*

Bookmark the key locations in a named subsystem (directory, feature area, or module)
so it can be navigated quickly.

- **Use when:** a user says "bookmark the auth system", you're starting work in a new
  area, or you want a durable index of a subsystem.
- **Input:** a system name (e.g. `src/auth`, `"Authentication"`, `packages/server`).
- **Workflow:** (1) explore the system's files to understand structure; (2) place
  bookmarks at entry points, exported interfaces, key algorithms, and non-obvious
  decisions via `bookmark_add`; (3) group everything under a single group named after
  the system (auto-created); (4) produce a brief prose summary of what was bookmarked
  and why.
- **Guidance:** aim for 5–15 bookmarks per system (>20 is usually noise); prefer
  semantic labels over file names. For very large or multi-system surveys, defer to
  `map-codebase`.

### 2. `bookmarks://skill/add-to-files`

**Resource name:** *Skill: Bookmark specific files*

Directly annotate one or more specific files at their important locations. Lighter
weight than `add-to-system` — **no exploration phase**, direct annotation only.

- **Use when:** a user provides specific file paths, or you're documenting a file you're
  already reading for another reason.
- **Input:** one or more file paths (absolute or workspace-relative).
- **Workflow:** (1) read each file; (2) bookmark exported symbols, load-bearing internal
  functions, and surprising code (workarounds, subtle invariants), adding `label`,
  `note`, and `tags`; (3) choose a grouping strategy — one group per file (small sets)
  or per semantic theme across files (coherent features).
- **Guidance:** quality over quantity; 3 focused bookmarks beat 20 noisy ones. For a
  whole directory/module prefer `add-to-system` (which includes exploration).

### 3. `bookmarks://skill/analyze`

**Resource name:** *Skill: Analyze bookmark coverage*

Derive structured insights from the *existing* bookmark set rather than creating new
bookmarks.

- **Use when:** a user asks "what's bookmarked?", wants an overview, or asks whether the
  bookmarks are still accurate; or you want situational awareness before starting work.
- **Input:** optional query/scope (file, group, tag); defaults to all bookmarks.
- **Workflow:** (1) load the set via `bookmark_search`/`bookmark_list`; (2) analyze four
  dimensions — **Coverage** (what's bookmarked vs. absent), **Hotspots** (dense
  annotation), **Staleness** (broken anchors via `anchor_listBroken`, stale labels), and
  **Themes** (recurring labels/groups/tags); (3) output a structured prose summary (not a
  raw list), with examples and recommendations.
- **Guidance:** target 200–400 words. If the set is empty, recommend `map-codebase`.

### 4. `bookmarks://skill/map-codebase`

**Resource name:** *Skill: Map the full codebase*

Build a coherent, organized bookmark map of the whole codebase by surveying all major
systems and bookmarking each.

- **Use when:** no bookmarks exist yet, or a user asks to "index the whole project".
- **Input:** none required; optional scope to limit the survey.
- **Workflow:** (1) survey repo structure to identify major systems — aim for 5–15, one
  per clear single-responsibility directory/feature (each package in a monorepo is a
  candidate); (2) run the full `add-to-system` workflow for each system **sequentially**
  to keep groups coherent; (3) summarize systems bookmarked, areas skipped (generated
  code, vendor) and why, and suggested next actions (e.g. run `analyze`).
- **Guidance:** exclude generated code (`dist/`, `node_modules/`); split a system if 15
  bookmarks can't cover it.

## How the skills relate

```
map-codebase ──(per system)──▶ add-to-system ──┐
                                                ├──▶ (bookmarks created)
                            add-to-files  ──────┘
analyze ◀── reads the resulting bookmark set
```

- `map-codebase` is the "start from nothing" entry point; it drives `add-to-system`
  repeatedly.
- `add-to-system` (explore + bookmark a module) and `add-to-files` (annotate given files)
  are the two creation skills.
- `analyze` is the read/review skill over whatever bookmarks already exist.

## Source pointers

- Skill content: `packages/server/src/skills/index.ts`
- Resource map + handlers: `packages/server/src/resource-handlers.ts` (`SKILL_RESOURCES`)
- Discovery hints: `packages/server/src/tools/definitions.ts`
- Tests: `packages/server/src/resource-handlers.test.ts` (includes a sync test between
  `SKILL_RESOURCES` and the `handleListResources` listing)
- Design spec: `docs/superpowers/specs/2026-05-19-bookmark-skills-design.md`
- Plan: `docs/plans/SML-1382.md`

## Known gaps / possible follow-ups

- No slash-command surface in any client — resource-only today.
- Discovery relies on agents reading the appended tool-description hints; there is no
  hint on, e.g., `anchor_listBroken` even though `analyze` references it.
- The original spec text says "Five skill guides" in one place and "Four" in another; a
  repair skill was dropped during review, so **four** is correct.
