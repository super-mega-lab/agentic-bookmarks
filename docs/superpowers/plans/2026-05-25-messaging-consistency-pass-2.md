# Messaging Consistency Pass 2 — Extension README + Cleanup

**Goal:** Align the VS Code Marketplace details page (`packages/extension/README.md`) with the messaging framework from pass 1, and clean up remaining placeholder/stale copy across all surfaces.

**Why a second pass:** Pass 1's file map listed `README.md` (GitHub) but missed `packages/extension/README.md` (the Marketplace). The Marketplace page is the primary discovery surface for new users and still carries pre-consistency copy, deprecated terminology, and 7 PLACEHOLDER references.

**Architecture:** Pure text/copy changes — no behavior, no logic, no tests.

---

## File Map

| Surface | File | Repo | Action |
|---------|------|------|--------|
| Marketplace README | `packages/extension/README.md` | agentic-bookmarks | Rewrite top sections, remove PLACEHOLDERs |
| GitHub README | `README.md` | agentic-bookmarks | Minor fixes |
| Landing page | `src/app/agentic-bookmarks/page.tsx` | website | Remove video placeholder |
| Getting started | `packages/extension/resources/getting-started.md` | agentic-bookmarks | No changes (verified consistent) |
| package.json | `packages/extension/package.json` | agentic-bookmarks | No changes (verified consistent) |

---

### Task 1: Extension README — rewrite top matter for agent-first messaging

**File:** `packages/extension/README.md`

The top of the README (lines 1–66) is the first thing a marketplace visitor sees. Rewrite to match the messaging framework: agent-first lede, consistent tagline, no PLACEHOLDERs.

- [ ] **Step 1: Rewrite lede (lines 3–9)**

Replace:
```markdown
**Durable code bookmarks for you and your AI agents.** Bookmarks that survive
refactors, merge cleanly when checked into git, and that LLM agents can read,
place, and repair through MCP — turning the bookmark set into shared project
memory for a team and the agents working with it.

> _[PLACEHOLDER: hero GIF / screenshot — bookmarks panel + gutter decorations +
> overlay notes in an editor]_
```

With:
```markdown
Your AI coding agent loses context every session. **Agentic Bookmarks** fixes that: durable, self-healing bookmarks that agents can read, place, and repair through a bundled MCP server. They survive refactors, check into git, and give your whole team — humans and agents — persistent codebase knowledge.
```

(Matches the GitHub README lede. PLACEHOLDER removed — screenshots live in the getting-started guide and are linked from Quickstart.)

- [ ] **Step 2: Replace "Why another bookmarks extension?" with "What can your agent do?" (lines 13–33)**

Replace entire section with:
```markdown
## What can your agent do?

Once the MCP server is connected, your AI assistant can:

- **Place bookmarks** during research — "bookmark the auth boundary and the rate limiter"
- **Read bookmarks as context** — "what bookmarks exist in this module?"
- **Map an entire codebase** — "map this codebase with bookmarks" (uses built-in skill guide)
- **Repair broken bookmarks** — structured diagnostic waterfall for bookmarks that drifted during large refactors

28 MCP tools cover the full lifecycle: create, read, search, organize, validate, and repair.
```

(Matches the GitHub README section. Agent-first positioning replaces the defensive "why another?" framing.)

- [ ] **Step 3: Simplify Installation, remove PLACEHOLDER URL (lines 35–46)**

Replace:
```markdown
## Installation

Install **Agentic Bookmarks** from the VS Code Marketplace:

- Marketplace page: _[PLACEHOLDER: Marketplace listing URL once published]_
- Or, in VS Code: open the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
  and search for **Agentic Bookmarks**.
- Or, from the Command Palette: `ext install supermegalab.agentic-bookmarks`.

Requires VS Code `1.92` or newer. Also works in **Cursor** and other
VS Code–compatible editors that support the Extensions API and MCP.
```

With:
```markdown
## Installation

Search for **"Agentic Bookmarks"** in the VS Code Extensions panel (`Ctrl+Shift+X` / `Cmd+Shift+X`) and click **Install**. Publisher: **supermegalab**.

Or from the command line: `code --install-extension supermegalab.agentic-bookmarks`

Also works in **Cursor** and other VS Code-compatible editors that support the Extensions API and MCP.
```

- [ ] **Step 4: Rewrite Getting Started to agent-first 3-step flow (lines 49–65)**

Replace:
```markdown
## Getting started

1. Open any file and place your cursor on a line you want to remember.
2. Press **`Ctrl+K Ctrl+B`** (**`Cmd+K Cmd+B`** on macOS) to toggle a
   bookmark on the current line. Use **`Ctrl+K Ctrl+Shift+B`** to add a
   labelled bookmark — you'll be prompted for a label and (optionally) a
   group.
3. Open the **Bookmarks** panel from the Activity Bar to see every bookmark
   in the workspace, organized by group and file.
4. Jump between bookmarks with **`Ctrl+K Ctrl+N`** / **`Ctrl+K Ctrl+P`**, or
   open the in-file list with **`Ctrl+K L`**.

> _[PLACEHOLDER: short GIF — toggle a bookmark, see it in the panel, jump to
> the next one]_

That's the minimum loop. Everything else — groups, notes, MCP, repair — is
optional polish on top.
```

With:
```markdown
## Quickstart

1. Install **"Agentic Bookmarks"** from the Extensions panel
2. Open the **Agentic Bookmarks** panel (bookmark icon in the Activity Bar) and click **Set up for Claude Code** (or Cursor / Codex) — this also handles `.gitignore`
3. Start placing bookmarks — your agent can too

→ **[Full Getting Started guide with screenshots](resources/getting-started.md)**
```

---

### Task 2: Extension README — rewrite Features section for consistency

**File:** `packages/extension/README.md`

The Features section (lines 69–157) has stale terminology, 4 PLACEHOLDERs, and puts anchors before agents. Restructure to lead with the three pillars (Agent → Durable → Team), remove PLACEHOLDERs, and drop deprecated terms.

- [ ] **Step 1: Rewrite the Features section (lines 69–158)**

Replace the entire `## Features` block (from `## Features` through the end of `### AI / MCP integration`) with:

```markdown
## Features

### Your agents remember

A bundled MCP server lets Claude Code, Cursor, and Codex read, place, and repair bookmarks — no separate setup. Built-in skill guides teach agents best practices so you can say "map this codebase with bookmarks" and it knows what to do.

- 28 MCP tools for full bookmark lifecycle
- Works with any MCP-compatible client
- Zero-config: installs with the extension

The MCP server runs **locally on your machine**. Agents you connect to it get whatever access you'd give any other local tool — no Agentic Bookmarks service sits in the middle.

### Survives every refactor

Smart anchors store surrounding context — not line numbers — so bookmarks survive renames, moves, and formatting passes. Self-healing keeps them correct as code drifts; agent-assisted repair handles the hard cases.

- Context-based matching, not line numbers
- Background self-healing on file changes
- Agent-assisted repair for large refactors

Repair is layered: manual relocation (always available) → background auto-repair (configurable) → agent-assisted repair through MCP for the hard cases that defeat mechanical methods.

### Knowledge that compounds

Shared bookmarks commit to git like code. New team members and agents inherit the map on clone. Groups, labels, and notes turn bookmarks into living documentation.

- **Local bookmarks** — personal scratch, stored under `.bookmarks/local/` (gitignored)
- **Shared bookmarks** — team knowledge, stored under `.bookmarks/shared/` (committed)
- Merge-conflict-friendly storage format
- Groups and labels for organization
```

(Pillars reordered to Agent → Durable → Team. PLACEHOLDERs for diagrams/screenshots removed. "Tag anchor" terminology removed — the feature still exists but doesn't need its own callout in the overview. Local/shared detail folded into the Team pillar.)

---

### Task 3: Extension README — clean up remaining PLACEHOLDERs and stale links

**File:** `packages/extension/README.md`

- [ ] **Step 1: Fill in marketplace URLs**

Replace line 351:
```markdown
- Marketplace listing: _[PLACEHOLDER: Marketplace URL]_
```
With:
```markdown
- Marketplace listing: [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=supermegalab.agentic-bookmarks)
```

- [ ] **Step 2: Remove stale section title annotation**

Line 224 — change:
```markdown
## Keyboard shortcuts (QOL upgrade on way)
```
To:
```markdown
## Keyboard shortcuts
```

- [ ] **Step 3: Add trust signals**

Insert after the Quickstart section and before Features:
```markdown
---

The extension collects no usage telemetry. Pure JavaScript, no native dependencies. Source-available under [PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0/) — see [`LICENSE`](LICENSE).

> **Public beta:** all Pro features are free for everyone, no account required. Beta end date: **to be announced**.
```

(Matches the GitHub README trust block. Moves privacy/beta info near the top where marketplace browsers will see it, instead of buried in sections 7 and 8.)

---

### Task 4: Landing page — remove video placeholder

**File:** `src/app/agentic-bookmarks/page.tsx` (in `/home/marc/sml/website/`)

- [ ] **Step 1: Remove the "Demo video coming soon" section (lines 166–178)**

Remove:
```tsx
<hr className="border-white/[0.08] mb-16" />

{/* Video placeholder */}
<section className="pb-20 text-center max-w-2xl mx-auto">
  <p className="text-xs font-semibold uppercase tracking-widest text-white/30 mb-10">
    See it in action
  </p>
  <div className="rounded-xl border border-white/10 bg-white/[0.02] py-16 px-10">
    <div className="text-5xl mb-4 opacity-25">▶</div>
    <p className="text-sm text-white/30">Demo video coming soon</p>
  </div>
</section>
```

An empty placeholder with "coming soon" hurts more than it helps — add this section back when the video exists.

---

### Task 5: GitHub README — minor consistency fixes

**File:** `README.md`

The GitHub README was updated in pass 1 and is mostly consistent. Two small fixes:

- [ ] **Step 1: Add Discord link to Support section or bottom of file**

The extension README and the getting-started guide both link to the Discord (`https://discord.gg/zukZdvqf8q`), but the GitHub README has no mention of it. The GitHub repo is where issues are filed, so the Discord should be discoverable there too.

Add after the Legal section:
```markdown
## Support & feedback

- GitHub Issues: <https://github.com/super-mega-lab/agentic-bookmarks/issues>
- Discord: <https://discord.gg/zukZdvqf8q>
- Email: **contact@supermegalab.com**
```

- [ ] **Step 2: Verify section parity across all READMEs**

Both READMEs should have consistent "What can your agent do?" copy and identical "28 MCP tools" count. The extension README will get this content in Task 1 — verify they match after implementation.

---

## Cross-Surface Audit Summary

After pass 2, all surfaces should align on:

| Element | Landing page | GitHub README | Extension README | Getting started |
|---------|-------------|---------------|-----------------|-----------------|
| Hero/lede | "Persistent codebase knowledge for you and your agents" | "Your AI coding agent loses context…persistent codebase knowledge" | Same as GitHub README | "durable, self-healing bookmarks…bundled MCP server" |
| Pillars | Agent → Durable → Team (cards) | Agent section + 3-step quickstart | Agent → Durable → Team (headings) | Install → MCP → Bookmark → Refactor |
| Tool count | "28 MCP tools" | "28 MCP tools" | "28 MCP tools" | N/A |
| Trust signals | Grid (no telemetry, free beta, pure JS, source-available) | Inline paragraph + blockquote | Inline paragraph + blockquote | N/A |
| Discord | Link in header | Support section | Support & feedback section | Get Help section |
| PLACEHOLDERs | None (video section removed) | None | None | None |

---

## Verification Checklist (post-implementation)

- [ ] `pnpm build` passes
- [ ] Zero `PLACEHOLDER` strings in `packages/extension/README.md`
- [ ] Zero `PLACEHOLDER` strings in any other surface
- [ ] No "Tag anchor" or "Point anchor" mentions in `packages/extension/README.md`
- [ ] No "pins" in customer-facing copy (gutter icon descriptions can say "icon" or "indicator")
- [ ] "28 MCP tools" consistent across: GitHub README, extension README, landing page
- [ ] Marketplace URL filled in (no more `_[PLACEHOLDER: …]_`)
- [ ] Three pillars appear in order (Agent → Durable → Team) in extension README
- [ ] Trust signals appear near the top of extension README
- [ ] "What can your agent do?" section present in extension README
- [ ] No "coming soon" placeholders on landing page
- [ ] Relative links in extension README resolve correctly (e.g. `resources/getting-started.md`, `LICENSE`)
