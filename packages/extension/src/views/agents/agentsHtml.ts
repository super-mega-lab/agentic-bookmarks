// ABOUTME: Renders the Agents panel webview HTML — compact pill buttons for
// ABOUTME: each MCP skill playbook, styled with VS Code theme variables.

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
}

const runCmdWithArg = (cmd: string, arg: string) =>
  `command:${cmd}?${encodeURIComponent(JSON.stringify([arg]))}`;

function renderPill(skill: SkillDef): string {
  const href = runCmdWithArg('agenticBookmarks.runSkill', skill.id);
  return `<a class="skill-pill" href="${href}" title="${skill.label}"><span class="codicon codicon-${skill.icon}"></span> ${skill.label}</a>`;
}

export function renderAgentsHtml(opts: AgentsHtmlOptions): string {
  const { cspSource, nonce, codiconUri } = opts;
  const pills = SKILLS.map(renderPill).join('\n      ');
  const codiconLink = codiconUri
    ? `<link rel="stylesheet" href="${codiconUri}" />`
    : '';

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
  </style>
</head>
<body>
  <div class="agents-container">
      ${pills}
  </div>
</body>
</html>`;
}
