# Design: README Polish (SML-1408)

## Summary

Two additive changes to the root `README.md` intro block to improve first impressions and surface privacy transparency. All existing sections are preserved.

## Approach

Approach A — expand in-place. Prepend one pain-framing sentence to the existing description paragraph, revise the second sentence to make shareability explicit, and append a telemetry one-liner after the paragraph.

## Changes

### 1. Opening hook

Replace the existing one-liner description paragraph with an expanded version that leads with the pain (local + fragile), then states the solution (refactor survival, git shareability, MCP usability):

**Before:**
```
**Agentic Bookmarks** — durable code bookmarks for you and your AI agents. Bookmarks survive refactors, merge cleanly when checked into git, and LLM agents can read, place, and repair them through MCP. Implemented in pure JavaScript with atomic JSON storage (no native dependencies).
```

**After:**
```
Most code bookmarks are local to your machine and break the moment you rename a file or move a function. **Agentic Bookmarks** fixes both: self-healing bookmarks that survive refactors, check into git so your whole team shares them, and are usable by LLM agents through a bundled MCP server. Implemented in pure JavaScript with atomic JSON storage (no native dependencies).
```

### 2. No-telemetry statement

Add immediately after the expanded description paragraph, before the source-available callout:

```
The extension collects no usage telemetry.
```

## Final intro block structure

```
# Agentic Bookmarks

![public beta badge]

**Public beta:** all Pro features are free for everyone. Beta end date: **to be announced**.

Most code bookmarks are local to your machine and break the moment you rename a file or move
a function. **Agentic Bookmarks** fixes both: self-healing bookmarks that survive refactors,
check into git so your whole team shares them, and are usable by LLM agents through a
bundled MCP server. Implemented in pure JavaScript with atomic JSON storage (no native
dependencies).

The extension collects no usage telemetry.

> **Source-available repository.** ...
```

Everything from `## Important: add this line to your project's .gitignore` onward is untouched.

## Acceptance criteria (from ticket)

- A developer skimming the top of the README immediately understands why this is worth trying
- Telemetry/no-telemetry is stated clearly without requiring a scroll to the Legal section
- Existing sections (Quickstart, Dev Setup, MCP docs, Workspace Layout, etc.) are preserved as-is

## Implementation notes

- Implement in a git worktree
- Edit is purely additive except for the one-liner → paragraph replacement; no sections are removed or reordered
