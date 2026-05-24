# Messaging Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite all customer-facing copy across 5 surfaces to align with the unified messaging framework defined in `docs/superpowers/specs/2026-05-24-messaging-consistency-design.md`.

**Architecture:** Pure text/copy changes — no behavior, no logic, no tests. Each task modifies one surface. Changes are independent and can ship separately. The landing page lives in a separate repo (`/home/marc/sml/website/`).

**Tech Stack:** Markdown, JSON, React/TSX (landing page only)

---

## File Map

| Surface | File | Repo |
|---------|------|------|
| package.json | `packages/extension/package.json` | agentic-bookmarks |
| README | `README.md` | agentic-bookmarks |
| Getting Started | `packages/extension/resources/getting-started.md` | agentic-bookmarks |
| Landing Page | `src/app/agentic-bookmarks/page.tsx` | website (`/home/marc/sml/website/`) |
| Product Overview | `docs/product-overview.md` | agentic-bookmarks-core |

---

### Task 1: package.json — description + keywords

**Files:**
- Modify: `packages/extension/package.json:4` (description field)
- Modify: `packages/extension/package.json:24-26` (after categories, add keywords)

- [ ] **Step 1: Update description**

Change line 4 from:
```json
"description": "Durable code bookmarks with self-healing anchors, so you and your agents can create local bookmarks or Git-friendly shared groups that survive refactors and code movement.",
```
to:
```json
"description": "Durable bookmarks that survive refactors, share via git, and work with your AI coding agents through MCP.",
```

- [ ] **Step 2: Add keywords array**

Insert after line 26 (`],` closing categories):
```json
"keywords": [
  "bookmarks",
  "mcp",
  "ai",
  "agents",
  "claude",
  "cursor",
  "codex",
  "code-navigation",
  "team",
  "git"
],
```

- [ ] **Step 3: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('packages/extension/package.json','utf8'))"`
Expected: no output (valid JSON)

- [ ] **Step 4: Commit**

```bash
git add packages/extension/package.json
git commit -m "copy: update package.json description and add marketplace keywords

Aligns with messaging consistency spec. Leads with durability + git +
agents (the three pillars). Keywords target AI-forward audience for
marketplace discoverability."
```

---

### Task 2: Landing page — rewrite hero, reorder pillars, add trust signals

**Files:**
- Modify: `src/app/agentic-bookmarks/page.tsx` (in `/home/marc/sml/website/`)

- [ ] **Step 1: Update metadata**

Replace the metadata object (lines 6–19):
```tsx
export const metadata: Metadata = {
  title: "Agentic Bookmarks — Persistent Codebase Knowledge for You and Your Agents",
  description:
    "Durable bookmarks that survive refactors, share via git, and work with your AI coding agents through MCP.",
  alternates: {
    canonical: "https://agenticbookmarks.com",
  },
  openGraph: {
    title: "Agentic Bookmarks",
    description:
      "Durable bookmarks that survive refactors, share via git, and work with your AI coding agents through MCP.",
    url: "https://agenticbookmarks.com",
    type: "website",
  },
};
```

- [ ] **Step 2: Rewrite hero section**

Replace the hero `<h1>`, `<p>` (subhead), and `<p>` (problem statement) — lines 68–79:
```tsx
<h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight text-white leading-[1.1] mb-6">
  Persistent codebase knowledge
  <br />
  for you and your agents.
</h1>
<p className="text-xl sm:text-2xl text-white/70 leading-relaxed mb-3 max-w-2xl">
  Self-healing bookmarks that survive refactors, share via git, and give
  your AI assistant persistent memory of your codebase.
</p>
<p className="text-sm text-white/40 italic mb-10 max-w-xl">
  AI agents lose context between sessions. Codebase knowledge lives in
  people&apos;s heads. Traditional bookmarks break on refactors.
  We built something that solves all three.
</p>
```

- [ ] **Step 3: Reorder and rewrite feature cards**

Replace the `features` array (lines 28–58) with pillars in the spec's order (Agent → Durable → Team):
```tsx
const features = [
  {
    icon: "🤖",
    title: "Your Agents Remember",
    body: "A bundled MCP server lets Claude Code, Cursor, and Codex read, place, and repair bookmarks — no separate setup. Built-in skill guides teach agents best practices so you can say \"map this codebase with bookmarks\" and it knows what to do.",
    bullets: [
      "28 MCP tools for full bookmark lifecycle",
      "Works with any MCP-compatible client",
      "Zero-config: installs with the extension",
    ],
  },
  {
    icon: "⚓",
    title: "Survives Every Refactor",
    body: "Smart anchors store surrounding context — not line numbers — so bookmarks survive renames, moves, and formatting passes. Self-healing keeps them correct as code drifts; agent-assisted repair handles the hard cases.",
    bullets: [
      "Context-based matching, not line numbers",
      "Background self-healing on file changes",
      "Agent-assisted repair for large refactors",
    ],
  },
  {
    icon: "🤝",
    title: "Knowledge That Compounds",
    body: "Shared bookmarks commit to git like code. New team members and agents inherit the map on clone. Groups, labels, and notes turn bookmarks into living documentation.",
    bullets: [
      "Shared bookmarks in git, local stay private",
      "Merge-conflict-friendly storage format",
      "Groups and labels for organization",
    ],
  },
];
```

- [ ] **Step 4: Add trust signals section**

Insert a new section between the feature cards and the video placeholder (between lines 139 and 141):
```tsx
<hr className="border-white/[0.08] mb-16" />

{/* Trust signals */}
<section className="pb-20 max-w-3xl mx-auto">
  <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
    <div>
      <p className="text-sm font-semibold text-white/80">No telemetry</p>
      <p className="text-xs text-white/40 mt-1">Zero usage data collected</p>
    </div>
    <div>
      <p className="text-sm font-semibold text-white/80">Free during beta</p>
      <p className="text-xs text-white/40 mt-1">All Pro features, no account</p>
    </div>
    <div>
      <p className="text-sm font-semibold text-white/80">Pure JavaScript</p>
      <p className="text-xs text-white/40 mt-1">No native dependencies</p>
    </div>
    <div>
      <p className="text-sm font-semibold text-white/80">Source-available</p>
      <p className="text-xs text-white/40 mt-1">PolyForm Shield 1.0.0</p>
    </div>
  </div>
</section>
```

- [ ] **Step 5: Verify build**

Run from the website repo:
```bash
cd /home/marc/sml/website && npx next lint src/app/agentic-bookmarks/page.tsx
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
cd /home/marc/sml/website
git add src/app/agentic-bookmarks/page.tsx
git commit -m "copy: rewrite landing page to messaging consistency spec

- Hero: 'Persistent codebase knowledge for you and your agents'
- Pillars reordered: Agent-Native → Durable → Team-Shared
- Tool count: 19+ → 28
- Added trust signals section (no telemetry, free beta, pure JS, source-available)
- Removed 'pins' and 'breaks on first edit' phrasing"
```

---

### Task 3: README — rewrite lede, add agent section, trust signals

**Files:**
- Modify: `README.md` (in agentic-bookmarks repo)

- [ ] **Step 1: Rewrite the lede paragraph**

Replace line 7 (the main description paragraph starting with "Most code bookmarks..."):
```markdown
Your AI coding agent loses context every session. **Agentic Bookmarks** fixes that: durable, self-healing bookmarks that agents can read, place, and repair through a bundled MCP server. They survive refactors, check into git, and give your whole team — humans and agents — persistent codebase knowledge.
```

- [ ] **Step 2: Move trust signals up**

Replace lines 8–9 (the telemetry line and the source-available blockquote) with a consolidated trust block:

```markdown
The extension collects no usage telemetry. Pure JavaScript, no native dependencies. Source-available under [PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0/) — see [`LICENSE`](LICENSE).

> **Public beta:** all Pro features are free for everyone, no account required. Beta end date: **to be announced**.
>
> **Not stand-alone buildable.** `pnpm install` depends on the private `@agentic-bookmarks/core` sibling and will fail without it. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=supermegalab.agentic-bookmarks) — the contents here exist so the network-facing portions can be independently audited (see [`SECURITY.md`](SECURITY.md)).
```

- [ ] **Step 3: Add "What can your agent do?" section**

Insert a new section after the `.gitignore` instructions and before Quickstart:
```markdown
## What can your agent do?

Once the MCP server is connected, your AI assistant can:

- **Place bookmarks** during research — "bookmark the auth boundary and the rate limiter"
- **Read bookmarks as context** — "what bookmarks exist in this module?"
- **Map an entire codebase** — "map this codebase with bookmarks" (uses built-in skill guide)
- **Repair broken bookmarks** — structured diagnostic waterfall for bookmarks that drifted during large refactors

28 MCP tools cover the full lifecycle: create, read, search, organize, validate, and repair.
```

- [ ] **Step 4: Simplify Quickstart to three steps**

Replace the current Quickstart section with:
```markdown
## Quickstart

1. Install **"Agentic Bookmarks"** by supermegalab from the VS Code extension browser
2. `Cmd+Shift+P` → **"Agentic Bookmarks: Setup for Claude Code"** (or Cursor / Codex) — this also handles `.gitignore`
3. Start placing bookmarks — your agent can too

→ **[Full Getting Started guide with screenshots](packages/extension/resources/getting-started.md)**
```

- [ ] **Step 5: Verify no broken links**

Run: `grep -n '\[.*\](.*\.md)' README.md` and check each relative path exists.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "copy: rewrite README lede and quickstart for messaging consistency

- Leads with agent-first value prop
- Adds 'What can your agent do?' section with concrete examples
- Simplifies quickstart to 3 steps (install → MCP setup → go)
- Consolidates trust signals near top
- Removes 'pins', uses '28 MCP tools' (verified count)"
```

---

### Task 4: Getting Started guide — reorder for agent-first flow

**Files:**
- Modify: `packages/extension/resources/getting-started.md`

- [ ] **Step 1: Update intro paragraph**

Replace lines 6–9:
```markdown
Agentic Bookmarks gives you durable, self-healing bookmarks that survive refactors — and lets
your AI assistant create, navigate, and manage them through a bundled MCP server.

This guide takes you from install to your first agent-accessible bookmark in about two minutes.
```

- [ ] **Step 2: Merge .gitignore note into step 2 (MCP setup)**

Remove the `.gitignore` one-time-setup blockquote from step 1 (lines 20–28). It will be noted inside the MCP step since that command handles it automatically.

Replace the full "## 1. Install" section with:
```markdown
## 1. Install

Search for **"Agentic Bookmarks"** in the VS Code Extensions panel (`Cmd+Shift+X` / `Ctrl+Shift+X`)
and click **Install**. Publisher: **supermegalab**.

![Extension installed in VS Code Extensions panel](images/01-install.png)
```

- [ ] **Step 3: Make MCP setup step 2 (was step 4)**

Replace what was section "## 4. Connect your AI assistant" and move it to be section 2. The new section 2:
```markdown
## 2. Set up the MCP for your AI assistant

Open the **Agentic Bookmarks** panel (the bookmark icon in the Activity Bar) and click the
setup button for your tool:

![Welcome panel showing Set up the MCP buttons](images/05-mcp-setup.png)

- **Set up for Claude Code** — runs `claude mcp add`. Choose Local (this project) or User (all projects).
- **Set up for Cursor** — writes `.cursor/mcp.json` (Project) or `~/.cursor/mcp.json` (Global).
- **Set up for Codex** — writes `.codex/config.toml` (Project) or `~/.codex/config.toml` (Global).

This also adds `.bookmarks/local/` to your `.gitignore` if it isn't there already.

**Verify it's working:** ask your assistant "List my bookmarks" — it should respond (even if the list is empty).
```

- [ ] **Step 4: Place bookmarks as step 3 (was step 2)**

```markdown
## 3. Place your first bookmark

Open any file. Right-click the **line number** (the gutter) and choose **Add Labeled Bookmark**.

![Right-click context menu showing Add Bookmark](images/02-context-menu.png)

Type a label — "auth boundary", "main render loop", "the 3am hack" — and press Enter.

A pin appears in the gutter and the bookmark shows up in the **Agentic Bookmarks** sidebar.

![Gutter pin and sidebar tree showing the new bookmark](images/03-pin-and-sidebar.png)

Your agent can now see this bookmark too. Try: **"What bookmarks are in this file?"**
```

- [ ] **Step 5: Keep refactor survival as step 4 (was step 3)**

```markdown
## 4. Watch it survive a refactor

Rename the function your bookmark is on — or move a few lines somewhere else in the file.

Click the bookmark in the sidebar. It navigates to the **correct code** at its new location.

![Editor after renaming the function — pin still on the right line](images/04-post-refactor.png)

The bookmark stores surrounding context to re-find its line as code drifts. Small edits —
renames, insertions, formatting passes — don't break it.
```

- [ ] **Step 6: Keep navigation as step 5 and AI playbooks as "What's Next"**

These sections stay as-is (sections "## 5. Navigate and search" and "## What's Next: AI Skill Playbooks" — no changes needed, content is already good).

- [ ] **Step 7: Commit**

```bash
git add packages/extension/resources/getting-started.md
git commit -m "copy: reorder getting-started guide for agent-first flow

Steps: Install → MCP setup (handles gitignore) → Place bookmarks →
Refactor demo. MCP connection moves from step 4 to step 2 so the agent
participates from the start."
```

---

### Task 5: Product overview — add deprecation notice

**Files:**
- Modify: `docs/product-overview.md` (in `/home/marc/sml/agentic-bookmarks-core/`)

- [ ] **Step 1: Add deprecation notice at the top**

Insert after line 1 (the title):
```markdown

> **DEPRECATED:** This document is stale (last updated Feb 2026, describes v0.5.0). For current product positioning, see the [product brief](product/product-brief.md). For messaging guidance, see the [messaging consistency spec](../agentic-bookmarks/docs/superpowers/specs/2026-05-24-messaging-consistency-design.md) in the extension repo.
```

- [ ] **Step 2: Commit**

```bash
cd /home/marc/sml/agentic-bookmarks-core
git add docs/product-overview.md
git commit -m "docs: deprecate product-overview.md in favor of product brief

Document is stale (v0.5.0, Feb 2026). Product brief is current and
better written. Messaging consistency spec now governs copy."
```

---

## Verification Checklist (post-implementation)

After all tasks complete:

- [ ] `pnpm build` passes in agentic-bookmarks (verifies package.json is still valid)
- [ ] No mentions of "pins" remain in any modified file
- [ ] No mentions of "19 tools" or "19+" remain in any modified file
- [ ] No mentions of "tag anchor" or "point anchor" in any modified file
- [ ] No "breaks on the first edit" phrasing remains
- [ ] All three pillar names appear in order (Agent → Durable → Team) on every surface
- [ ] "28 MCP tools" is the number used everywhere (verified: spec appendix lists exactly 28)
