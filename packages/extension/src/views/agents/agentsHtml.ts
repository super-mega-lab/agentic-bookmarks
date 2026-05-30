// ABOUTME: Renders the Agents panel webview HTML — agent connection status rows
// ABOUTME: plus compact pill buttons for each MCP skill playbook.

import type { McpAgent, AnyScope } from '../../commands/mcp-install-state';

export interface AgentConnectionDescriptor {
  agent: McpAgent;
  displayName: string;
  /** Map of scope → installed version (if any). Empty when not installed at all. */
  installs: Partial<Record<AnyScope, { installedVersion?: string }>>;
  /** Scope pair this agent uses, in agent-native vocabulary. */
  scopes: { workspace: AnyScope; global: AnyScope };
  /** Per-scope label as the agent natively calls it (e.g. "Local" vs "Project"). */
  scopeLabel: (scope: AnyScope) => string;
  /** True iff any installed scope is at a version other than the current extension version. */
  isOutdated: boolean;
}

export const AGENTS_SECTION_IDS = ['agentConnections'] as const;
export type AgentsSectionId = typeof AGENTS_SECTION_IDS[number];

export interface SkillDef {
  id: string;
  label: string;
  icon: string;
  prompt: string;
}

export const SKILLS: SkillDef[] = [
  { id: 'map-codebase', label: 'Map Codebase', icon: 'globe', prompt: 'Use bookmarks://skill/map-codebase to build a bookmark map of this project.' },
  { id: 'analyze', label: 'Analyze', icon: 'graph', prompt: 'Use bookmarks://skill/analyze to analyze the current bookmark set.' },
  { id: 'add-to-system', label: 'Add to System', icon: 'package', prompt: 'Use bookmarks://skill/add-to-system to bookmark a system or module.' },
  { id: 'add-to-files', label: 'Add to Files', icon: 'file-add', prompt: 'Use bookmarks://skill/add-to-files to annotate files with bookmarks.' },
  { id: 'help', label: 'Help', icon: 'question', prompt: 'Use bookmarks://skill/help to help the user with Agentic Bookmarks.' },
  { id: 'report-issue', label: 'Report Issue', icon: 'bug', prompt: 'Use bookmarks://skill/report-issue to help the user report a bug.' },
];

export interface AgentsHtmlOptions {
  cspSource: string;
  nonce: string;
  codiconUri?: string;
  /** Ordered list of all known agents and their current install state. */
  agents?: AgentConnectionDescriptor[];
  /** Per-section collapsed state. Missing entries default to expanded. */
  collapsedSections?: Partial<Record<AgentsSectionId, boolean>>;
  /** When false, render a minimal "open a folder" CTA with NO command-bearing affordances.
   *  Defaults to true so existing callers/tests keep rendering the populated state. */
  hasFolder?: boolean;
}

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

function setupCommandFor(agent: McpAgent): string {
  return `agenticBookmarks.setup${agent.charAt(0).toUpperCase()}${agent.slice(1)}`;
}

function renderAgentRow(desc: AgentConnectionDescriptor): string {
  const installedScopes = (Object.keys(desc.installs) as AnyScope[]).filter((s) => desc.installs[s]);
  const versions = installedScopes
    .map((s) => desc.installs[s]?.installedVersion)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  const uniqueVersions = Array.from(new Set(versions));
  const scopesText = installedScopes.map((s) => desc.scopeLabel(s)).join(', ');
  const versionText =
    uniqueVersions.length === 0
      ? 'version unknown'
      : uniqueVersions.length === 1
        ? `v${uniqueVersions[0]}`
        : `v${uniqueVersions.join(', v')}`;
  const olderTag = desc.isOutdated ? ' <span class="row-status-tag">(older)</span>' : '';

  const primary = desc.isOutdated
    ? /* html */ `<a class="button row-primary" title="Update the agentic-bookmarks MCP server to match this extension" href="${runCmdWithArg('agenticBookmarks.agentConnections.smartUpdate', desc.agent)}">Update MCP</a>`
    : /* html */ `<div class="status-pill row-primary" title="All installed scopes are on the current extension version"><span class="status-pill-icon">✓</span> Up to date</div>`;

  return /* html */ `
  <div class="agent-row">
    <div class="agent-row-name">${escapeHtml(desc.displayName)}</div>
    <div class="agent-row-status">Installed (${escapeHtml(scopesText)}) · ${escapeHtml(versionText)}${olderTag}</div>
    <div class="agent-row-actions">
      ${primary}
      <a class="button secondary row-menu" title="More actions" href="${runCmdWithArg('agenticBookmarks.agentConnections.showRowActions', desc.agent)}">⋮</a>
    </div>
  </div>`;
}

function renderAgentConnections(agents: AgentConnectionDescriptor[], _collapsed: boolean): string {
  const connected = agents.filter((d) => Object.keys(d.installs).length > 0);
  const disconnected = agents.filter((d) => Object.keys(d.installs).length === 0);

  // Collapse toggling disabled — section is always expanded for now.
  // const chevron = collapsed ? '▶' : '▼';
  // const ariaLabel = collapsed ? 'Expand Agent connections section' : 'Collapse Agent connections section';
  const helpButton = /* html */ `<a class="header-icon" title="Help" href="${runCmd('agenticBookmarks.openHelp.agentConnections')}">?</a>`;
  const header = /* html */ `
    <div class="section-header">
      <span class="section-label">
        <span class="section-title">Agent connections</span>
      </span>${helpButton}
    </div>`;

  if (connected.length === 0) {
    const buttons = agents
      .map((d) => `<a class="button" href="${runCmd(setupCommandFor(d.agent))}">Connect to ${escapeHtml(d.displayName)}</a>`)
      .join('\n      ');
    return /* html */ `
  <section>
    ${header}
    <div class="button-row">
      ${buttons}
    </div>
  </section>`;
  }

  const anyOutdated = connected.some((d) => d.isOutdated);
  const updateAllBanner = anyOutdated
    ? /* html */ `
    <div class="button-row update-all-row">
      <a class="button" title="Update every outdated agent MCP server to match this extension" href="${runCmd('agenticBookmarks.agentConnections.updateAllOutdated')}">Update all MCPs</a>
    </div>`
    : '';
  const rows = connected.map(renderAgentRow).join('\n');
  const footer =
    disconnected.length > 0
      ? /* html */ `
    <div class="button-row footer-row">
      <a class="button secondary" href="${runCmd('agenticBookmarks.agentConnections.connectAnother')}">Connect another agent…</a>
    </div>`
      : '';
  return /* html */ `
  <section>
    ${header}${updateAllBanner}
    ${rows}${footer}
  </section>`;
}

function renderPill(skill: SkillDef): string {
  const href = runCmdWithArg('agenticBookmarks.runSkill', skill.id);
  return `<a class="skill-pill" href="${href}" title="${skill.label}"><span class="codicon codicon-${skill.icon}"></span> ${skill.label}</a>`;
}

function emptyBody(): string {
  return /* html */ `
  <section>
    <p class="cta-text">Open a folder to connect agents and run skill playbooks.</p>
    <div class="button-row">
      <a class="button" href="${runCmd('vscode.openFolder')}">Open Folder…</a>
    </div>
  </section>`;
}

function activeBody(
  agents: AgentConnectionDescriptor[],
  collapsedSections: Partial<Record<AgentsSectionId, boolean>>,
): string {
  const pills = SKILLS.map(renderPill).join('\n      ');
  const agentConnectionsBlock = agents.length > 0
    ? renderAgentConnections(agents, collapsedSections.agentConnections === true)
    : '';

  return /* html */ `${agentConnectionsBlock}
  <div class="agents-container">
      ${pills}
  </div>`;
}

export function renderAgentsHtml(opts: AgentsHtmlOptions): string {
  const { cspSource, nonce, codiconUri, agents = [], collapsedSections = {}, hasFolder = true } = opts;
  const codiconLink = codiconUri
    ? `<link rel="stylesheet" href="${codiconUri}" />`
    : '';

  const body = hasFolder ? activeBody(agents, collapsedSections) : emptyBody();

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${cspSource} 'unsafe-inline';
    font-src ${cspSource};
    script-src 'nonce-${nonce}';
  " />
  ${codiconLink}
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 0;
      margin: 0;
    }
    section {
      padding: 12px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
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
    .agent-row {
      margin: 0 0 12px;
    }
    .agent-row:last-child {
      margin-bottom: 6px;
    }
    .agent-row-name {
      font-weight: 500;
    }
    .agent-row-status {
      margin: 2px 0 6px;
      color: var(--vscode-descriptionForeground);
      font-size: 0.85em;
    }
    .row-status-tag {
      color: var(--vscode-editorWarning-foreground, var(--vscode-notificationsWarningIcon-foreground, inherit));
    }
    .agent-row-actions {
      display: flex;
      gap: 4px;
      align-items: stretch;
    }
    .row-primary {
      flex: 1 1 auto;
    }
    .row-menu {
      flex: 0 0 auto;
      width: 32px;
      padding: 6px 0;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 2px;
      font-size: 0.95em;
      background: rgb(55, 122, 38);
      color: #fff;
      border: 1px solid rgb(55, 122, 38);
      cursor: default;
    }
    .status-pill-icon {
      font-weight: bold;
    }
    .update-all-row {
      margin: 0 0 12px;
    }
    .footer-row {
      margin-top: 10px;
    }
    .agents-container {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px 12px;
    }
    .skill-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 12px;
      font-size: 11px;
      text-decoration: none;
      cursor: pointer;
      white-space: nowrap;
    }
    .skill-pill:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .skill-pill .codicon {
      font-size: 12px;
    }
    .cta-text {
      margin: 0 0 10px;
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
    }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}
