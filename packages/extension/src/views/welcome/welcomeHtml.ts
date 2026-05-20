// ABOUTME: Renders the HTML for the Agentic Bookmarks welcome panel webview.
// ABOUTME: Exports renderWelcomeHtml(), which generates full HTML based on workspace state.
export interface WelcomeHtmlOptions {
  /** Whether at least one workspace folder is open. */
  hasFolder: boolean;
  /** Webview URI for the hero icon. */
  iconUri: string;
  /** Webview CSP source for the Content-Security-Policy header. */
  cspSource: string;
  /** Per-render nonce for inline content. */
  nonce: string;
  /**
   * Whether to offer the "Add to .gitignore" banner. Only honored when
   * `hasFolder` is true — the no-folder view performs no workspace evaluation.
   */
  needsGitignore?: boolean;
}

const LOCAL_VS_SHARED_URL = 'https://agenticbookmarks.com/local-vs-shared';
const ANCHORS_URL = 'https://agenticbookmarks.com/anchors';
const AGENTIC_ACCELERATION_URL = 'https://agenticbookmarks.com/agentic-acceleration';
const SKILLS_URL = 'https://agenticbookmarks.com/skills';
const DISCORD_URL = 'https://discord.gg/zukZdvqf8q';
const GITHUB_ISSUES_URL = 'https://github.com/super-mega-lab/agentic-bookmarks/issues/new';

const openUrlCmd = (url: string) =>
  `command:vscode.open?${encodeURIComponent(JSON.stringify([url]))}`;
const runCmd = (cmd: string) => `command:${cmd}`;

function emptyBody(): string {
  return /* html */ `
  <section>
    <p class="cta-text">Open a folder to use Agentic Bookmarks — most of this panel appears once you do.</p>
    <div class="button-row">
      <a class="button" href="${runCmd('vscode.openFolder')}">Open Folder…</a>
    </div>
  </section>`;
}

function gitignoreBanner(): string {
  return /* html */ `
  <section class="banner">
    <p class="banner-text">Machine-local bookmark state isn't ignored by git yet. Add <code>.bookmarks/local/</code> to <code>.gitignore</code> so collaborators don't see churn from per-machine files.</p>
    <div class="button-row">
      <a class="button" href="${runCmd('agenticBookmarks.addLocalToGitignore')}">Add Agentic Bookmarks to .gitignore</a>
    </div>
  </section>`;
}

function activeBody(needsGitignore: boolean): string {
  return /* html */ `${needsGitignore ? gitignoreBanner() : ''}
  <section>
    <h2>Learn</h2>
    <a class="card" href="${openUrlCmd(LOCAL_VS_SHARED_URL)}">
      <span class="card-title">Local vs. Shared Bookmarks</span>
      <span class="card-sub">Workspace-only vs. Git-friendly groups that travel with the repo.</span>
    </a>
    <a class="card" href="${openUrlCmd(ANCHORS_URL)}">
      <span class="card-title">Smart &amp; Tag Anchors</span>
      <span class="card-sub">How anchors survive refactors and code movement.</span>
    </a>
    <a class="card" href="${openUrlCmd(AGENTIC_ACCELERATION_URL)}">
      <span class="card-title">Agentic Acceleration with the MCP</span>
      <span class="card-sub">Let your AI assistant create and navigate bookmarks for you.</span>
    </a>
    <a class="card" href="${openUrlCmd(SKILLS_URL)}">
      <span class="card-title">Powerful Support Skills</span>
      <span class="card-sub">Built-in MCP playbooks that teach agents to map, analyze, and bookmark code.</span>
    </a>
  </section>

  <section>
    <h2>Set up the MCP</h2>
    <div class="button-row">
      <a class="button" href="${runCmd('agenticBookmarks.setupClaude')}">Set up for Claude Code</a>
      <a class="button secondary" href="${runCmd('agenticBookmarks.setupCursor')}">Set up for Cursor</a>
      <a class="button secondary" href="${runCmd('agenticBookmarks.setupCodex')}">Set up for Codex</a>
    </div>
  </section>

  <section>
    <h2>Community &amp; Support</h2>
    <a class="card" href="${openUrlCmd(DISCORD_URL)}">
      <span class="card-title">Join our Discord</span>
      <span class="card-sub">Get help, share feedback, and connect with other users.</span>
    </a>
    <a class="card" href="${openUrlCmd(GITHUB_ISSUES_URL)}">
      <span class="card-title">Report an Issue</span>
      <span class="card-sub">Found a bug or have a feature request? Open an issue on GitHub.</span>
    </a>
  </section>`;
}

export function renderWelcomeHtml(opts: WelcomeHtmlOptions): string {
  const { hasFolder, iconUri, cspSource, nonce, needsGitignore = false } = opts;
  const body = hasFolder ? activeBody(needsGitignore) : emptyBody();

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
    .banner {
      background: var(--vscode-inputValidation-warningBackground, var(--vscode-editorWidget-background));
      border-top: none;
      border-left: 3px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));
    }
    .banner-text {
      margin: 0;
      font-size: 0.9em;
    }
    .banner code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.95em;
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
