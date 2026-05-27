// ABOUTME: Renders the welcome panel webview HTML for the Agentic Bookmarks VS Code extension.
// ABOUTME: Produces a static HTML string with embedded CSS; no scripts are used.

export const WELCOME_SECTION_IDS = ['learn', 'community'] as const;
export type WelcomeSectionId = typeof WELCOME_SECTION_IDS[number];

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
  /**
   * Per-section collapsed state. Missing entries default to expanded.
   * Persisted in globalState by WelcomeViewProvider.
   */
  collapsedSections?: Partial<Record<WelcomeSectionId, boolean>>;
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
const runCmdWithArg = (cmd: string, arg: unknown) =>
  `command:${cmd}?${encodeURIComponent(JSON.stringify([arg]))}`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default:  return c;
    }
  });
}

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

function sectionHeader(_id: WelcomeSectionId, title: string, _collapsed: boolean, extras = ''): string {
  // Collapse toggling disabled — sections are always expanded for now.
  // const chevron = collapsed ? '▶' : '▼';
  // const ariaLabel = collapsed ? `Expand ${title} section` : `Collapse ${title} section`;
  return /* html */ `
    <div class="section-header">
      <span class="section-label">
        <span class="section-title">${escapeHtml(title)}</span>
      </span>${extras}
    </div>`;
}

function learnSection(_collapsed: boolean): string {
  // Collapse disabled — always render expanded.
  return /* html */ `
  <section>
    ${sectionHeader('learn', 'Learn', false)}
    <div class="learn-item">
      <div class="learn-title">Local vs. Shared Bookmarks</div>
      <div class="learn-sub">Workspace-only vs. Git-friendly groups that travel with the repo.</div>
      <a class="learn-link" href="${openUrlCmd(LOCAL_VS_SHARED_URL)}">Learn more →</a>
    </div>
    <div class="learn-item">
      <div class="learn-title">Smart &amp; Tag Anchors</div>
      <div class="learn-sub">How anchors survive refactors and code movement.</div>
      <a class="learn-link" href="${openUrlCmd(ANCHORS_URL)}">Learn more →</a>
    </div>
    <div class="learn-item">
      <div class="learn-title">Agentic Acceleration with the MCP</div>
      <div class="learn-sub">Let your AI assistant create and navigate bookmarks for you.</div>
      <a class="learn-link" href="${openUrlCmd(AGENTIC_ACCELERATION_URL)}">Learn more →</a>
    </div>
    <div class="learn-item">
      <div class="learn-title">Powerful Support Skills</div>
      <div class="learn-sub">Built-in MCP playbooks that teach agents to map, analyze, and bookmark code.</div>
      <a class="learn-link" href="${openUrlCmd(SKILLS_URL)}">Learn more →</a>
    </div>
  </section>`;
}

function communitySection(_collapsed: boolean): string {
  // Collapse disabled — always render expanded.
  return /* html */ `
  <section>
    ${sectionHeader('community', 'Community & Support', false)}
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

function activeBody(
  needsGitignore: boolean,
  collapsedSections: Partial<Record<WelcomeSectionId, boolean>>,
): string {
  return /* html */ `${needsGitignore ? gitignoreBanner() : ''}
  <section>
    <div class="button-row" style="margin-top: 0">
      <a class="button" href="${runCmd('agenticBookmarks.openGettingStarted')}">Getting Started Guide</a>
    </div>
  </section>

${learnSection(collapsedSections.learn === true)}

${communitySection(collapsedSections.community === true)}`;
}

export function renderWelcomeHtml(opts: WelcomeHtmlOptions): string {
  const { hasFolder, iconUri, cspSource, nonce, needsGitignore = false, collapsedSections = {} } = opts;
  const body = hasFolder ? activeBody(needsGitignore, collapsedSections) : emptyBody();

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
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .section-header h2 {
      margin: 0;
    }
    .section-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: 1 1 auto;
      padding: 2px 0;
      text-decoration: none;
      color: inherit;
      cursor: pointer;
    }
    .section-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: 1 1 auto;
      padding: 2px 0;
    }
    .section-chevron {
      display: inline-block;
      width: 14px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-size: 0.95em;
      line-height: 1;
    }
    .section-title {
      font-size: 0.85em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
    }
    .section-toggle:hover .section-title,
    .section-toggle:hover .section-chevron {
      color: var(--vscode-foreground);
    }
    .header-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      color: var(--vscode-descriptionForeground);
      text-decoration: none;
      font-size: 0.85em;
      font-weight: 600;
      cursor: pointer;
    }
    .header-icon:hover {
      color: var(--vscode-foreground);
      background: var(--vscode-toolbar-hoverBackground, transparent);
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
    .learn-item {
      margin: 6px 0;
    }
    .learn-title {
      font-weight: 500;
    }
    .learn-sub {
      margin-top: 2px;
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
    }
    .learn-link {
      display: inline-block;
      margin-top: 2px;
      color: var(--vscode-textLink-foreground);
      text-decoration: underline;
      font-size: 0.9em;
    }
    .learn-link:hover {
      color: var(--vscode-textLink-activeForeground);
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
    .card {
      display: block;
      padding: 8px;
      margin-top: 6px;
      background: var(--vscode-editorWidget-background, transparent);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
      text-decoration: none;
      color: var(--vscode-foreground);
    }
    .card:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .card-title {
      display: block;
      font-weight: 500;
    }
    .card-sub {
      display: block;
      margin-top: 2px;
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
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
