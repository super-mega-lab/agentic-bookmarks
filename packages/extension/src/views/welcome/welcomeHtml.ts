export interface WelcomeHtmlOptions {
  /** Whether at least one workspace folder is open. */
  hasFolder: boolean;
  /** Webview URI for the hero icon. */
  iconUri: string;
  /** Webview CSP source for the Content-Security-Policy header. */
  cspSource: string;
  /** Per-render nonce for inline content. */
  nonce: string;
}

const LEARN_URL = 'https://agenticbookmarks.com';

const openUrlCmd = (url: string) =>
  `command:vscode.open?${encodeURIComponent(JSON.stringify([url]))}`;
const runCmd = (cmd: string) => `command:${cmd}`;

function emptyBody(): string {
  return /* html */ `
  <section>
    <p class="cta-text">Open a folder to activate Agentic Bookmarks.</p>
    <div class="button-row">
      <a class="button" href="${runCmd('vscode.openFolder')}">Open Folder…</a>
    </div>
  </section>`;
}

function activeBody(): string {
  return /* html */ `
  <section>
    <h2>Learn</h2>
    <a class="card" href="${openUrlCmd(LEARN_URL)}">
      <span class="card-title">Local vs. Shared Bookmarks</span>
      <span class="card-sub">Workspace-only vs. Git-friendly groups that travel with the repo.</span>
    </a>
    <a class="card" href="${openUrlCmd(LEARN_URL)}">
      <span class="card-title">Smart &amp; Tag Anchors</span>
      <span class="card-sub">How anchors survive refactors and code movement.</span>
    </a>
    <a class="card" href="${openUrlCmd(LEARN_URL)}">
      <span class="card-title">Agentic Acceleration with the MCP</span>
      <span class="card-sub">Let your AI assistant create and navigate bookmarks for you.</span>
    </a>
  </section>

  <section>
    <h2>Set up the MCP</h2>
    <div class="button-row">
      <a class="button" href="${runCmd('agenticBookmarks.setupClaude')}">Set up for Claude Code</a>
      <a class="button secondary" href="${runCmd('agenticBookmarks.setupCursor')}">Set up for Cursor</a>
      <a class="button secondary" href="${runCmd('agenticBookmarks.setupCodex')}">Set up for Codex</a>
    </div>
  </section>`;
}

export function renderWelcomeHtml(opts: WelcomeHtmlOptions): string {
  const { hasFolder, iconUri, cspSource, nonce } = opts;
  const body = hasFolder ? activeBody() : emptyBody();

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    img-src ${cspSource} https: data:;
    style-src ${cspSource} 'unsafe-inline';
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
    .cta-text {
      margin: 0 0 10px;
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
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
${body}
</body>
</html>`;
}
