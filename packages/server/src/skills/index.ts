// ABOUTME: Skill guide content served as MCP resources at bookmarks://skill/*.
// ABOUTME: Each export is a markdown playbook for a distinct bookmark workflow.

export const SKILL_ADD_TO_SYSTEM = `# Add Bookmarks to a System — Skill Guide

## Purpose

Bookmark the key locations in a named subsystem (directory, feature area, or module) so agents and developers can navigate it quickly.

## When to use

Use this skill when:
- A user asks to "bookmark the auth system" or "document the payment module"
- You're starting work in a new area and want a navigable map
- You want to create a durable, organized index of a subsystem

## Workflow

### Input

The system name: a directory path, feature name, or module name (e.g., \`src/auth\`, \`"Authentication"\`, \`packages/server\`).

### Step 1: Explore the system

Read the system's files to understand its structure:
- Entry points (index files, main exports)
- Exported interfaces and types
- Key algorithms and core logic
- Non-obvious decisions or surprising behavior

Don't skim — read enough to understand what's worth bookmarking.

### Step 2: Place bookmarks

Bookmark:
- **Entry points** — where execution enters the system
- **Exported interfaces** — the public contract
- **Key algorithms** — the non-trivial logic
- **Non-obvious decisions** — code that would surprise a reader without context

Use \`bookmark_add\` for each location. Set a clear \`label\` that describes what the code does (not what the file is named). Add a \`note\` for anything that needs more context.

### Step 3: Group under the system name

Pass \`groupName: "<SystemName>"\` (e.g., \`"Authentication"\`) to every \`bookmark_add\` call. Groups are auto-created — no need to pre-create them.

### Step 4: Summarize

After placing all bookmarks, produce a brief prose summary:
- What was bookmarked and why
- Any notable patterns or design decisions discovered
- Anything unusual that future readers should know

## Tips

- Aim for 5–15 bookmarks per system. More than 20 is usually noise.
- Prefer semantic labels over file names: "Token validation logic" beats "auth/token.ts:45"
- If a system is very large, consider splitting it: \`bookmarks://skill/map-codebase\` handles multi-system surveys.
`;

export const SKILL_ADD_TO_FILES = `# Add Bookmarks to Files — Skill Guide

## Purpose

Directly annotate one or more specific files with bookmarks at their important locations.

## When to use

Use this skill when:
- A user provides one or more specific file paths to bookmark
- You want lightweight annotation without an exploration phase
- You're documenting a file you're already reading for another reason

This is lighter-weight than \`bookmarks://skill/add-to-system\` — no exploration phase, direct annotation only.

## Workflow

### Input

One or more file paths (absolute or workspace-relative).

### Step 1: Read each file

Read the full file. Identify:
- **Exported symbols** — functions, classes, types, constants that form the public API
- **Important internal functions** — core logic that isn't exported but is load-bearing
- **Surprising code** — anything that would confuse a reader without context: workarounds, subtle invariants, non-obvious constraints

### Step 2: Place bookmarks

Use \`bookmark_add\` for each location. Guidelines:
- Set a clear \`label\` that describes what the code does
- Add a \`note\` for context that isn't obvious from the label
- Use \`tags\` to categorize (e.g., \`["export", "api"]\`)

### Step 3: Grouping strategy

Choose one:
- **By file:** One group per file, named after the file (e.g., \`"auth/token.ts"\`). Good for small sets of files.
- **By theme:** One group per semantic theme across files (e.g., \`"Token Validation"\`, \`"Session Management"\`). Good when files form a coherent feature.

Use \`groupName\` in each \`bookmark_add\` call — groups are auto-created.

### Step 4: Done

No summary required for lightweight file annotation. If you notice a pattern worth calling out, mention it briefly.

## Tips

- Don't bookmark everything — prefer quality over quantity
- A file with 3 focused bookmarks is more useful than one with 20 noise entries
- For a directory/module, prefer \`bookmarks://skill/add-to-system\` which includes an exploration phase
`;

export const SKILL_ANALYZE = `# Analyze Bookmarks — Skill Guide

## Purpose

Derive structured insights from the existing bookmark set: coverage, hotspots, staleness, and themes.

## When to use

Use this skill when:
- A user asks "what's bookmarked?", "give me an overview of my bookmarks", or "are my bookmarks still accurate?"
- You want situational awareness before starting work in a new area
- A user wants to understand whether their bookmark map needs updating

## Workflow

### Input

Optional: a query or scope (file path, group name, tag). Defaults to all bookmarks.

### Step 1: Load the bookmark set

Use \`bookmark_search\` (with optional filters) or \`bookmark_list\` to load the relevant bookmarks.

### Step 2: Analyze four dimensions

**Coverage** — which parts of the codebase are bookmarked vs. absent?
- Which directories/modules have bookmarks?
- Which important areas appear uncharted?
- Is the bookmark set representative of the codebase's actual structure?

**Hotspots** — where is annotation dense?
- Files or groups with many bookmarks
- Whether hotspots reflect complexity/importance or noise

**Staleness** — which bookmarks may no longer reflect current code?
- Bookmarks with broken anchors (status from \`anchor_listBroken\`)
- Bookmarks whose labels reference things that may have changed (e.g., "old API", "deprecated")
- Bookmarks that haven't been updated in a long time relative to active files

**Themes** — what recurring patterns appear?
- Common labels, group names, or tags
- Whether the bookmark set tells a coherent story about the codebase

### Step 3: Output a structured prose summary

Do not return a raw bookmark list. Produce a prose summary organized by the four dimensions above. Include:
- Key findings per dimension
- Specific examples (group names, file paths) to make it concrete
- Recommendations: what to add, update, or remove

## Tips

- For staleness, combine \`bookmark_list\` data with \`anchor_listBroken\` output
- A good analysis is 200–400 words — enough to be useful, not a wall of text
- If the bookmark set is empty, recommend \`bookmarks://skill/map-codebase\` to build an initial map
`;

export const SKILL_HELP = `# How to Use Agentic Bookmarks — Help Guide

## Purpose

Answer user questions about Agentic Bookmarks and walk them through common tasks.

## When to use

Use this skill when:
- A user asks "how do I...?" about bookmarks
- A user asks what a feature does or how it works
- A user is getting started and needs orientation

## Common Workflows

### Adding a bookmark

**Via the panel:** Right-click a line in any editor and choose **Agentic Bookmarks: Add Bookmark**. Or open the panel and use the inline add button.

**Via agent:** Use \`bookmark_add\` with \`filePath\`, \`line\` (0-based), and \`label\`. Pass \`groupName\` to assign to a group (auto-created if it doesn't exist):

\`\`\`
bookmark_add({ filePath: "src/auth/token.ts", line: 42, label: "Token validation logic", groupName: "Authentication" })
\`\`\`

### Navigating to a bookmark

Click any bookmark in the Agentic Bookmarks panel to jump to it. The panel lives in the Activity Bar.

Via agent: \`bookmark_open\` with a \`bookmarkId\` from \`bookmark_list\` or \`bookmark_search\`.

### Organizing with groups

Groups are auto-created when you pass \`groupName\` to \`bookmark_add\`. To rename a group: \`group_rename\`. To move a bookmark to a different group: \`group_moveFile\`. Groups can be reordered in the panel by drag-and-drop.

### Searching bookmarks

Via the panel: use the search/filter input.

Via agent: \`bookmark_search\` accepts a text \`query\`, optional \`groupName\`, and optional \`tags\` array. Returns matching bookmarks with their locations.

### Repairing broken anchors

Anchors break when code is deleted or heavily refactored. To check: \`anchor_listBroken\`. To repair: \`anchor_repair\` with the bookmark ID.

For a full staleness assessment, use the \`bookmarks://skill/analyze\` playbook.

### Which AI skill playbook to use

- \`bookmarks://skill/map-codebase\` — full repo map, use when starting fresh
- \`bookmarks://skill/add-to-system\` — deeply bookmark one module or feature area
- \`bookmarks://skill/add-to-files\` — annotate specific files you're already working in
- \`bookmarks://skill/analyze\` — assess coverage, hotspots, staleness, and themes

## Tips

- Bookmarks are stored in \`.bookmarks/shared/\` and committed to git — they travel with the repo.
- Machine-local state (\`.bookmarks/local/\`) should be in \`.gitignore\`.
- Groups named after module paths (e.g., \`"packages/server"\`) make navigation intuitive in monorepos.
`;

export const SKILL_MAP_CODEBASE = `# Map Codebase — Skill Guide

## Purpose

Build a coherent, organized bookmark map of the entire codebase by surveying all major systems and bookmarking each one.

## When to use

Use this skill when:
- No bookmarks exist yet and you need a complete starting point
- A user asks for a full codebase map
- A user asks to "index the whole project"

## Workflow

### Input

None required. Optional: a scope (directory or file glob) to limit the survey.

### Step 1: Survey the repo structure

Explore the repository to identify major systems/modules. Heuristics:
- Aim for **5–15 systems** — don't over-fragment
- A system boundary is a directory or feature area with a clear, single responsibility
- Monorepos: treat each package as a system candidate
- Large packages: look for subdirectories with distinct responsibilities

Examples of good system boundaries:
- \`packages/server\` → "MCP Server"
- \`packages/extension/src/auth\` → "Authentication"
- \`packages/extension/src/views\` → "Tree Views"

Examples of over-fragmentation to avoid:
- One bookmark group per file
- Groups named after file paths rather than responsibilities

### Step 2: Bookmark each system sequentially

For each identified system, run the full \`bookmarks://skill/add-to-system\` workflow:
1. Explore the system's files
2. Place bookmarks at entry points, exported interfaces, key algorithms, non-obvious decisions
3. Group under the system name

Work sequentially — complete one system before starting the next. This keeps each group coherent and avoids interleaving groups.

### Step 3: Result

A complete, organized bookmark map of the codebase. Every major system has a group. Each group has 5–15 focused bookmarks.

After completion, briefly summarize:
- Systems identified and bookmarked
- Any areas skipped (generated code, vendor, etc.) and why
- Suggested next actions (e.g., run \`bookmarks://skill/analyze\` to review coverage)

## Tips

- Generated code (\`dist/\`, \`node_modules/\`, \`.build/\`) should be excluded
- Configuration files (tsconfig, package.json) rarely need bookmarks unless they have unusual patterns
- If a system is complex enough that 15 bookmarks doesn't cover it, split it into sub-systems
`;
