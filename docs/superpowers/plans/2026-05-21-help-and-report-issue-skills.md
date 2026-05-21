# Help & Report-Issue Skills + Getting Started README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `bookmarks://skill/help` and `bookmarks://skill/report-issue` MCP resources, a bundled `getting-started.md` README, and a Welcome panel button to open it.

**Architecture:** Two new skill exports in `skills/index.ts` registered in `resource-handlers.ts` (server); a static markdown file in `packages/extension/resources/`; a VS Code command that opens it as markdown preview; a button in the Welcome panel HTML.

**Tech Stack:** TypeScript, VS Code extension API, Vitest

---

## File Map

| File | Change |
|---|---|
| `packages/server/src/skills/index.ts` | Add `SKILL_HELP` and `SKILL_REPORT_ISSUE` exports |
| `packages/server/src/resource-handlers.ts` | Register both in `SKILL_RESOURCES` map and `handleListResources` |
| `packages/server/src/resource-handlers.test.ts` | Add tests for both new resources |
| `packages/extension/resources/getting-started.md` | Create: bundled first-use README |
| `packages/extension/src/extension.ts` | Register `agenticBookmarks.openGettingStarted` command |
| `packages/extension/package.json` | Add command to `contributes.commands` |
| `packages/extension/src/views/welcome/welcomeHtml.ts` | Add Getting Started button |
| `packages/extension/src/views/welcome/welcomeView.test.ts` | Add tests for button and command |

---

## Task 1: Add `bookmarks://skill/help` MCP resource

**Files:**
- Modify: `packages/server/src/resource-handlers.test.ts`
- Modify: `packages/server/src/skills/index.ts`
- Modify: `packages/server/src/resource-handlers.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/src/resource-handlers.test.ts` inside `describe('handleListResources')`:

```ts
it('includes bookmarks://skill/help', async () => {
  const result = await handleListResources();
  const uris = result.resources.map(r => r.uri);
  expect(uris).toContain('bookmarks://skill/help');
});
```

Add to `describe('handleReadResource — skill URIs')`:

```ts
it('returns markdown content for bookmarks://skill/help', async () => {
  const result = await handleReadResource(fakeCtx, 'bookmarks://skill/help');
  expect(result.contents).toHaveLength(1);
  expect(result.contents[0].mimeType).toBe('text/markdown');
  expect(result.contents[0].text).toContain('How to Use Agentic Bookmarks');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test packages/server/src/resource-handlers.test.ts
```

Expected: 2 new tests fail — "includes bookmarks://skill/help" and "returns markdown content for bookmarks://skill/help"

- [ ] **Step 3: Add `SKILL_HELP` export**

Add to `packages/server/src/skills/index.ts`:

```ts
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
```

- [ ] **Step 4: Register `SKILL_HELP` in `resource-handlers.ts`**

Add `SKILL_HELP` to the import at the top of `packages/server/src/resource-handlers.ts`:

```ts
import {
  SKILL_ADD_TO_SYSTEM,
  SKILL_ADD_TO_FILES,
  SKILL_ANALYZE,
  SKILL_MAP_CODEBASE,
  SKILL_HELP,
} from './skills/index.js';
```

Add to the `SKILL_RESOURCES` map:

```ts
export const SKILL_RESOURCES: Record<string, string> = {
  'bookmarks://skill/add-to-system': SKILL_ADD_TO_SYSTEM,
  'bookmarks://skill/add-to-files': SKILL_ADD_TO_FILES,
  'bookmarks://skill/analyze': SKILL_ANALYZE,
  'bookmarks://skill/map-codebase': SKILL_MAP_CODEBASE,
  'bookmarks://skill/help': SKILL_HELP,
};
```

Add to the `handleListResources` return array (after the `map-codebase` entry):

```ts
{
  uri: 'bookmarks://skill/help',
  name: 'Skill: How to use Agentic Bookmarks',
  description: 'Workflow guide for common bookmark tasks: adding, navigating, grouping, searching, and repairing',
  mimeType: 'text/markdown'
},
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm test packages/server/src/resource-handlers.test.ts
```

Expected: all tests pass including the two new ones

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/skills/index.ts packages/server/src/resource-handlers.ts packages/server/src/resource-handlers.test.ts
git commit -m "feat: add bookmarks://skill/help MCP resource"
```

---

## Task 2: Add `bookmarks://skill/report-issue` MCP resource

**Files:**
- Modify: `packages/server/src/resource-handlers.test.ts`
- Modify: `packages/server/src/skills/index.ts`
- Modify: `packages/server/src/resource-handlers.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/src/resource-handlers.test.ts` inside `describe('handleListResources')`:

```ts
it('includes bookmarks://skill/report-issue', async () => {
  const result = await handleListResources();
  const uris = result.resources.map(r => r.uri);
  expect(uris).toContain('bookmarks://skill/report-issue');
});
```

Add to `describe('handleReadResource — skill URIs')`:

```ts
it('returns markdown content for bookmarks://skill/report-issue', async () => {
  const result = await handleReadResource(fakeCtx, 'bookmarks://skill/report-issue');
  expect(result.contents).toHaveLength(1);
  expect(result.contents[0].mimeType).toBe('text/markdown');
  expect(result.contents[0].text).toContain('Report an Issue');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test packages/server/src/resource-handlers.test.ts
```

Expected: 2 new tests fail

- [ ] **Step 3: Add `SKILL_REPORT_ISSUE` export**

Add to `packages/server/src/skills/index.ts`:

```ts
export const SKILL_REPORT_ISSUE = `# Report an Issue — Skill Guide

## Purpose

Help a user report a bug or unexpected behavior by gathering diagnostics, composing a clear GitHub issue, and providing contact links for faster support.

## When to use

Use this skill when:
- A user says something isn't working, reports a crash, or encounters unexpected behavior
- A user asks how to report a bug or feature request

## Workflow

### Step 1: Gather diagnostics

Call \`mcp_debug\` to collect server version, environment flags, and active workspace info. Capture the full output — it will be included in the issue body.

### Step 2: Describe the problem

Ask the user:
1. What were you trying to do?
2. What did you expect to happen?
3. What actually happened?
4. What are the steps to reproduce it?

Keep your questions concise — one message is enough.

### Step 3: Compose the issue

Format the gathered information as a GitHub issue body:

\`\`\`markdown
## What happened

[User's description of the problem]

## Steps to reproduce

[User's reproduction steps]

## Expected behavior

[What the user expected]

## Diagnostics

\`\`\`
[mcp_debug output]
\`\`\`
\`\`\`

Present the formatted issue body to the user and ask them to confirm it before filing.

### Step 4: Provide contact options

Share all three contact options so the user can choose the fastest path:

- **File an issue on GitHub:** https://github.com/super-mega-lab/agentic-bookmarks/issues/new  
  (Paste the formatted body above)
- **Discord (fastest response):** https://discord.gg/zukZdvqf8q
- **Email:** contact@supermegalab.com

## Tips

- If the user doesn't know how to reproduce the issue, ask what they were doing right before the problem appeared.
- \`mcp_debug\` output includes the server version — always include it, even for simple questions.
`;
```

- [ ] **Step 4: Register `SKILL_REPORT_ISSUE` in `resource-handlers.ts`**

Update the import:

```ts
import {
  SKILL_ADD_TO_SYSTEM,
  SKILL_ADD_TO_FILES,
  SKILL_ANALYZE,
  SKILL_MAP_CODEBASE,
  SKILL_HELP,
  SKILL_REPORT_ISSUE,
} from './skills/index.js';
```

Add to the `SKILL_RESOURCES` map:

```ts
export const SKILL_RESOURCES: Record<string, string> = {
  'bookmarks://skill/add-to-system': SKILL_ADD_TO_SYSTEM,
  'bookmarks://skill/add-to-files': SKILL_ADD_TO_FILES,
  'bookmarks://skill/analyze': SKILL_ANALYZE,
  'bookmarks://skill/map-codebase': SKILL_MAP_CODEBASE,
  'bookmarks://skill/help': SKILL_HELP,
  'bookmarks://skill/report-issue': SKILL_REPORT_ISSUE,
};
```

Add to the `handleListResources` return array (after the `help` entry):

```ts
{
  uri: 'bookmarks://skill/report-issue',
  name: 'Skill: Report a bug or issue',
  description: 'Workflow guide for gathering diagnostics and filing a bug report',
  mimeType: 'text/markdown'
},
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm test packages/server/src/resource-handlers.test.ts
```

Expected: all tests pass including the two new ones

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/skills/index.ts packages/server/src/resource-handlers.ts packages/server/src/resource-handlers.test.ts
git commit -m "feat: add bookmarks://skill/report-issue MCP resource"
```

---

## Task 3: Create `getting-started.md`

**Files:**
- Create: `packages/extension/resources/getting-started.md`

- [ ] **Step 1: Create the resources directory and file**

```bash
mkdir -p packages/extension/resources
```

Create `packages/extension/resources/getting-started.md`:

```markdown
# Getting Started with Agentic Bookmarks

Agentic Bookmarks gives you durable, self-healing bookmarks that survive refactors — and lets your AI assistant create, navigate, and manage them through the MCP.

## Quick Start

**1. Open the Welcome panel**  
Click the bookmark icon in the Activity Bar to open the Agentic Bookmarks panel.

**2. Set up the MCP** (for AI-assisted workflows)  
In the Welcome panel, click **Set up for Claude Code** (or Cursor/Codex). This lets your AI assistant read and place bookmarks through the MCP tools.

**3. Place your first bookmark**  
Right-click any line in an editor and choose **Agentic Bookmarks: Add Bookmark**. Give it a label and optionally assign it to a group.

**4. Navigate and search**  
Click any bookmark in the panel to jump to it. Use the search input to filter by label, group, or tag.

## What's Next: AI Skill Playbooks

Once the MCP is set up, ask your AI assistant to use these built-in playbooks:

| Playbook | What it does |
|---|---|
| `bookmarks://skill/map-codebase` | Build a complete bookmark map of the whole repo |
| `bookmarks://skill/add-to-system` | Deeply bookmark one module or feature area |
| `bookmarks://skill/add-to-files` | Annotate specific files you're already reading |
| `bookmarks://skill/analyze` | Review coverage, staleness, and themes in your bookmarks |

Or just ask your assistant: **"Map this codebase with bookmarks"** — it knows what to do.

## Get Help

- **Discord** (fastest): https://discord.gg/zukZdvqf8q
- **GitHub Issues**: https://github.com/super-mega-lab/agentic-bookmarks/issues/new
- **Email**: contact@supermegalab.com
```

- [ ] **Step 2: Commit**

```bash
git add packages/extension/resources/getting-started.md
git commit -m "feat: add getting-started.md for first-use onboarding"
```

---

## Task 4: Register `agenticBookmarks.openGettingStarted` command

**Files:**
- Modify: `packages/extension/src/views/welcome/welcomeView.test.ts`
- Modify: `packages/extension/package.json`
- Modify: `packages/extension/src/extension.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/extension/src/views/welcome/welcomeView.test.ts`, inside `describe('package.json view visibility')` (or as its own `describe`):

```ts
describe('package.json command contributions', () => {
  const commands: Array<{ command: string; title: string; category: string }> =
    pkg.contributes.commands;

  it('registers agenticBookmarks.openGettingStarted', () => {
    const cmd = commands.find(c => c.command === 'agenticBookmarks.openGettingStarted');
    expect(cmd).toBeDefined();
    expect(cmd?.category).toBe('Agentic Bookmarks');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test packages/extension/src/views/welcome/welcomeView.test.ts
```

Expected: "registers agenticBookmarks.openGettingStarted" fails

- [ ] **Step 3: Add command to `package.json`**

In `packages/extension/package.json`, add to the `contributes.commands` array (after the last entry):

```json
{
  "command": "agenticBookmarks.openGettingStarted",
  "title": "Open Getting Started Guide",
  "category": "Agentic Bookmarks"
}
```

- [ ] **Step 4: Register command in `extension.ts`**

In `packages/extension/src/extension.ts`, add a new `context.subscriptions.push` block after the `addLocalToGitignore` command registration:

```ts
context.subscriptions.push(
  vscode.commands.registerCommand('agenticBookmarks.openGettingStarted', () => {
    const uri = vscode.Uri.joinPath(context.extensionUri, 'resources', 'getting-started.md');
    void vscode.commands.executeCommand('markdown.showPreview', uri);
  })
);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm test packages/extension/src/views/welcome/welcomeView.test.ts
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/extension.ts packages/extension/package.json packages/extension/src/views/welcome/welcomeView.test.ts
git commit -m "feat: register agenticBookmarks.openGettingStarted command"
```

---

## Task 5: Add Getting Started button to Welcome panel

**Files:**
- Modify: `packages/extension/src/views/welcome/welcomeView.test.ts`
- Modify: `packages/extension/src/views/welcome/welcomeHtml.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/extension/src/views/welcome/welcomeView.test.ts`, inside `describe('active mode (folder loaded)')`:

```ts
it('shows the Getting Started button', () => {
  const html = renderWelcomeHtml({ ...baseOpts, hasFolder: true });
  expect(html).toContain('command:agenticBookmarks.openGettingStarted');
  expect(html).toContain('Getting Started Guide');
});

it('Getting Started button appears before the Learn section', () => {
  const html = renderWelcomeHtml({ ...baseOpts, hasFolder: true });
  expect(html.indexOf('openGettingStarted')).toBeLessThan(html.indexOf('>Learn<'));
});
```

Also add inside `describe('empty mode (no folder)')`:

```ts
it('omits the Getting Started button', () => {
  const html = renderWelcomeHtml({ ...baseOpts, hasFolder: false });
  expect(html).not.toContain('command:agenticBookmarks.openGettingStarted');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test packages/extension/src/views/welcome/welcomeView.test.ts
```

Expected: 3 new tests fail

- [ ] **Step 3: Add the Getting Started section to `welcomeHtml.ts`**

In `packages/extension/src/views/welcome/welcomeHtml.ts`, in the `activeBody` function, insert a new `<section>` block immediately before the `<section>` that opens with `<h2>Learn</h2>`.

Find this line (it's the opening of the Learn section):

```ts
  <section>
    <h2>Learn</h2>
```

Insert the following block **before** that line:

```ts
  <section>
    <div class="button-row">
      <a class="button" href="${runCmd('agenticBookmarks.openGettingStarted')}">Getting Started Guide</a>
    </div>
  </section>

```

No other changes to `activeBody` or `emptyBody`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test packages/extension/src/views/welcome/welcomeView.test.ts
```

Expected: all tests pass

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
pnpm test
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/views/welcome/welcomeHtml.ts packages/extension/src/views/welcome/welcomeView.test.ts
git commit -m "feat: add Getting Started button to Welcome panel"
```
