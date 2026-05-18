# Welcome view — implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Welcome" webview view at the top of the `agenticBookmarks-container` sidebar with:
1. A header image (branding) using `packages/extension/icon512.png`.
2. Three "Learn about…" cards linking to `https://agenticbookmarks.com` (placeholder targets — content comes later).
3. A "Set up the MCP" section with buttons that invoke the existing `agenticBookmarks.setupClaude` / `setupCursor` / `setupCodex` commands.

**Scope discipline:** This is a fast scaffold, not a foundation for ten more webviews. Use VS Code's `WebviewViewProvider` directly — no registry/proxy/IPC abstractions. One provider class, one HTML string, plain CSS using VS Code theme variables. Future-proof the *file layout* (`src/views/welcome/`) so a richer setup can grow there later without renaming.

**Architecture:**
- One new file `src/views/welcome/welcomeView.ts` implementing `WebviewViewProvider`.
- HTML built inline as a tagged-template string with proper CSP nonce + `webview.asWebviewUri` for the icon image.
- Card and button actions use `command:` URIs (`enableCommandUris: true`). The three "Learn" links use `command:vscode.open?<encoded-uri-array>` to open the website in the user's browser.
- New view declared in `package.json` under `views.agenticBookmarks-container` with `"type": "webview"` and `order: 0` so it sits above the existing tree views.
- Registered in `extension.ts` near where the other view providers are wired up.

**Tech stack:** TypeScript, VS Code Extension API (`WebviewViewProvider`, `window.registerWebviewViewProvider`). No bundler changes — `tsup` already bundles `src/extension.ts` and will pull in the new file transitively. No tests in this pass (UI scaffolding; add E2E later when content stabilizes).

**Reference docs:**
- `/Users/afoster/Documents/sml/agentic-bookmarks-core/docs/guides/webview/building-custom-webviewviews.md` — general primer.
- The case-study doc in the same folder if a richer pattern is needed later (not for this pass).

**Repo conventions:**
- Imports follow the same style as `src/extension.ts`.
- No `console.*` calls (tsup drops them, but still — use `Logger` from `src/logger.ts` if anything needs to be logged).
- Run `pnpm typecheck` after every TS change. Smoke-test in the Extension Development Host (F5) before considering a task done.
- Commit after each task with a focused message. Suggested branch name: `feature/welcome-view`.

---

## Task 1: Declare the view in `package.json`

**Files:**
- Edit: `packages/extension/package.json`

**Step 1:** In `contributes.views.agenticBookmarks-container` (currently three entries: `agenticBookmarks.view`, `agenticBookmarks.filesGroups`, `agenticBookmarks.settings`), prepend a fourth entry so the welcome view appears first:

```jsonc
{
  "id": "agenticBookmarks.welcome",
  "type": "webview",
  "name": "Welcome",
  "visibility": "visible"
}
```

It must be the **first** entry in the array — VS Code orders views by declaration order. The other three entries are unchanged.

**Step 2:** Run `pnpm typecheck` from `packages/extension`. (Validates JSON is still parseable via the implicit package.json checks; no TS impact yet.)

**Commit:** `feat(welcome): declare webview view in package.json`

---

## Task 2: Implement `WelcomeViewProvider`

**Files:**
- Create: `packages/extension/src/views/welcome/welcomeView.ts`

**Step 1: Write the provider**

```ts
// packages/extension/src/views/welcome/welcomeView.ts
import * as vscode from 'vscode';

export class WelcomeViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'agenticBookmarks.welcome';

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    webviewView.webview.options = {
      enableScripts: true,
      enableCommandUris: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
  }

  private getHtml(webview: vscode.Webview): string {
    const iconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'icon512.png'),
    );
    const nonce = getNonce();

    // Open the website via the built-in vscode.open command — encoded as JSON array.
    const learnUrl = 'https://agenticbookmarks.com';
    const openCmd = (url: string) =>
      `command:vscode.open?${encodeURIComponent(JSON.stringify([url]))}`;

    // Setup buttons invoke existing extension commands directly.
    const setupCmd = (cmd: string) => `command:${cmd}`;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    img-src ${webview.cspSource} https: data:;
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}';
  " />
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 0;
      margin: 0;
    }
    .hero {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 16px 12px 12px;
      background:
        linear-gradient(180deg, transparent 0%, var(--vscode-sideBar-background) 100%),
        url(${iconUri}) center/96px no-repeat;
      background-color: var(--vscode-sideBar-background);
      min-height: 120px;
    }
    .hero h1 {
      margin: 80px 0 4px;
      font-size: 1.25em;
      font-weight: 600;
    }
    .hero p {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
    }
    section {
      padding: 12px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    section h2 {
      margin: 0 0 8px;
      font-size: 0.85em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
    }
    .card {
      display: block;
      padding: 8px 10px;
      margin: 4px 0;
      background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      color: var(--vscode-foreground);
      text-decoration: none;
    }
    .card:hover {
      background: var(--vscode-list-hoverBackground);
      cursor: pointer;
    }
    .card-title {
      font-weight: 500;
    }
    .card-sub {
      display: block;
      margin-top: 2px;
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
    }
    .button-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 6px;
    }
    .button {
      display: block;
      text-align: center;
      padding: 6px 10px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 2px;
      text-decoration: none;
      font-size: 0.95em;
    }
    .button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
  </style>
</head>
<body>
  <div class="hero">
    <h1>Agentic Bookmarks</h1>
    <p>Durable, self-healing bookmarks for you and your agents.</p>
  </div>

  <section>
    <h2>Learn</h2>
    <a class="card" href="${openCmd(learnUrl)}">
      <span class="card-title">Local vs. Shared Bookmarks</span>
      <span class="card-sub">Workspace-only vs. Git-friendly groups that travel with the repo.</span>
    </a>
    <a class="card" href="${openCmd(learnUrl)}">
      <span class="card-title">Smart &amp; Tag Anchors</span>
      <span class="card-sub">How anchors survive refactors and code movement.</span>
    </a>
    <a class="card" href="${openCmd(learnUrl)}">
      <span class="card-title">Agentic Acceleration with the MCP</span>
      <span class="card-sub">Let your AI assistant create and navigate bookmarks for you.</span>
    </a>
  </section>

  <section>
    <h2>Set up the MCP</h2>
    <div class="button-row">
      <a class="button" href="${setupCmd('agenticBookmarks.setupClaude')}">Set up for Claude Code</a>
      <a class="button secondary" href="${setupCmd('agenticBookmarks.setupCursor')}">Set up for Cursor</a>
      <a class="button secondary" href="${setupCmd('agenticBookmarks.setupCodex')}">Set up for Codex</a>
    </div>
  </section>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
```

**Notes on the design choices (read these — they're the things most likely to break):**

- **No `<script>` is actually emitted.** All interaction is via `command:` URIs on anchors, so the strict `script-src 'nonce-…'` CSP is satisfied without us shipping any JS. The nonce is still scoped in case Task 4 adds a script.
- **The icon is rendered as a CSS `background-image`** rather than `<img>` because the 512×512 source isn't a great native size; CSS lets us size it cleanly to 96px and gradient-fade into the panel background. Position `center` keeps it sharp on any panel width. If the gradient feels off, drop the gradient line.
- **`localResourceRoots: [this.extensionUri]`** so `icon512.png` is readable. Could be narrowed to a `media` subdir later — out of scope for the scaffold.
- **`enableCommandUris: true`** is what makes `href="command:agenticBookmarks.setupClaude"` work. Without it the anchors silently no-op.
- **`vscode.open` is built in** and accepts a `Uri` (we pass a string and VS Code parses it). Good enough for opening the website.

**Step 2:** Run `pnpm typecheck` from `packages/extension`. Fix any type errors.

**Commit:** `feat(welcome): add WelcomeViewProvider`

---

## Task 3: Register the provider in `extension.ts`

**Files:**
- Edit: `packages/extension/src/extension.ts`

**Step 1:** Add an import near the top of the file:

```ts
import { WelcomeViewProvider } from './views/welcome/welcomeView';
```

**Step 2:** Inside `activate(context)`, register the provider alongside the existing view providers. The exact insertion point should sit next to where `agenticBookmarks.view` / `filesGroups` / `settings` are registered. Pattern:

```ts
const welcomeProvider = new WelcomeViewProvider(context.extensionUri);
context.subscriptions.push(
  vscode.window.registerWebviewViewProvider(
    WelcomeViewProvider.viewId,
    welcomeProvider,
    { webviewOptions: { retainContextWhenHidden: false } },
  ),
);
```

`retainContextWhenHidden: false` is correct here — the view is cheap to rebuild and the content is static.

**Step 3:** Run `pnpm typecheck`.

**Step 4:** Press F5 in VS Code to launch the Extension Development Host. Open the Agentic Bookmarks sidebar. Verify:
- Welcome view appears above the other three views.
- Header shows the branding image + title + tagline.
- Three "Learn" cards open `https://agenticbookmarks.com` in the browser when clicked.
- The three MCP setup buttons trigger the respective quick-pick flows.
- Light, dark, and high-contrast themes all look acceptable (no unreadable text, no white-on-white).

**Commit:** `feat(welcome): register Welcome webview in activate()`

---

## Task 4 (optional polish — only if Task 3 looked rough)

Things worth a quick pass if you have time:

- **Tighten the hero image** — if the 512px icon looks blurry or off-center at 96px, try `background-size: 80px` or change the `min-height` so the gradient stops at a nicer point.
- **Dismiss button** — add a `view/title` menu contribution (`agenticBookmarks.welcome.hide`) that calls `setContext('agenticBookmarks:welcome:dismissed', true)` and a matching `when` clause on the view in `package.json` so the user can hide it. State persists across sessions via `context.globalState`. This is a small addition (~30 lines) but adds real UX value.
- **Use a separate, lower-resolution PNG** — drop a 192×192 png into `media/` and point `vscode.Uri.joinPath(this.extensionUri, 'media', 'welcome-hero.png')` at it. The current 512px asset works but is overkill.

Each polish item is its own commit if attempted.

---

## Out of scope (deliberately)

- **Bundled Lit/React app.** The whole point of this pass is one static HTML string. If we need state, animations, or shared components across multiple webviews, that's a separate plan (see the case-study doc).
- **IPC / `postMessage`.** No host↔webview round-trip in this pass — `command:` URIs are sufficient for "click → run extension command."
- **Persisted "dismissed" state.** Mentioned as optional polish only.
- **Walkthrough contribution.** `contributes.walkthroughs` could mirror this content into the VS Code Welcome editor; defer until copy stabilizes.
- **Tests.** No tests in this pass; UI scaffolding has no stable assertions worth writing yet. Revisit when content stabilizes.

---

## Definition of done

- `pnpm typecheck` passes from `packages/extension`.
- Extension Development Host shows the Welcome view at the top of the Bookmarks sidebar with the header image, three Learn cards, and three Setup buttons.
- All buttons/cards do something visible (open website OR open quick-pick).
- No console errors in the webview devtools (right-click in the view → "Open Webview Developer Tools" in the EDH).
- Code committed on `feature/welcome-view` (or whatever branch you create).
