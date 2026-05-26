// ABOUTME: Tests for the welcome panel HTML renderer and VS Code view configuration.
// ABOUTME: Covers empty/active/gitignore-banner modes, the Agent Connections
// ABOUTME: section (empty + populated states), and LEARN section link structure.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderWelcomeHtml, type AgentConnectionDescriptor } from './welcomeHtml';
import { AGENT_SCOPES, scopeDisplayLabel, AGENT_DISPLAY_NAMES, type McpAgent } from '../../commands/mcp-install-state';

const pkgPath = path.join(__dirname, '../../..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const containerViews: Array<{ id: string; visibility?: string }> =
  pkg.contributes.views['agenticBookmarks-container'];

describe('package.json view visibility', () => {
  it('welcome view starts visible', () => {
    const welcome = containerViews.find(v => v.id === 'agenticBookmarks.welcome');
    expect(welcome?.visibility).toBe('visible');
  });

  it('non-welcome views start collapsed so welcome is prominent on first install', () => {
    const nonWelcome = containerViews.filter(v => v.id !== 'agenticBookmarks.welcome');
    for (const view of nonWelcome) {
      expect(view.visibility, `view "${view.id}" must be "collapsed"`).toBe('collapsed');
    }
  });
});

describe('package.json command contributions', () => {
  const commands: Array<{ command: string; title: string; category: string }> =
    pkg.contributes.commands;

  it('registers agenticBookmarks.openGettingStarted', () => {
    const cmd = commands.find(c => c.command === 'agenticBookmarks.openGettingStarted');
    expect(cmd).toBeDefined();
    expect(cmd?.category).toBe('Agentic Bookmarks');
  });

  it.each([
    'agenticBookmarks.openHelp.allBookmarks',
    'agenticBookmarks.openHelp.settings',
    'agenticBookmarks.openHelp.filesGroups',
    'agenticBookmarks.openHelp.agentConnections',
  ])('registers %s', (name) => {
    expect(commands.find(c => c.command === name)).toBeDefined();
  });

  it.each([
    'agenticBookmarks.uninstallClaude',
    'agenticBookmarks.uninstallCursor',
    'agenticBookmarks.uninstallCodex',
    'agenticBookmarks.agentConnections.showRowActions',
    'agenticBookmarks.agentConnections.connectAnother',
  ])('registers %s', (name) => {
    expect(commands.find(c => c.command === name)).toBeDefined();
  });
});

function descriptor(
  agent: McpAgent,
  installs: AgentConnectionDescriptor['installs'] = {},
  isOutdated = false,
): AgentConnectionDescriptor {
  return {
    agent,
    displayName: AGENT_DISPLAY_NAMES[agent],
    installs,
    scopes: AGENT_SCOPES[agent],
    scopeLabel: scopeDisplayLabel,
    isOutdated,
  };
}

const allUninstalled: AgentConnectionDescriptor[] = [
  descriptor('claude'),
  descriptor('cursor'),
  descriptor('codex'),
];

const baseOpts = {
  iconUri: 'https://example/icon512.png',
  cspSource: 'vscode-webview://example',
  nonce: 'testnonce',
};

describe('renderWelcomeHtml', () => {
  it('always renders the hero title', () => {
    expect(renderWelcomeHtml({ ...baseOpts, hasFolder: true, agents: allUninstalled })).toContain('Agentic Bookmarks');
    expect(renderWelcomeHtml({ ...baseOpts, hasFolder: false })).toContain('Agentic Bookmarks');
  });

  describe('empty mode (no folder)', () => {
    const html = renderWelcomeHtml({ ...baseOpts, hasFolder: false });

    it('shows the open-folder CTA', () => {
      expect(html).toContain('Open Folder');
      expect(html).toContain('command:vscode.openFolder');
    });

    it('omits Learn cards and Agent Connection buttons', () => {
      expect(html).not.toContain('Local vs. Shared Bookmarks');
      expect(html).not.toContain('Connect to Claude Code');
      expect(html).not.toContain('agenticBookmarks.setupClaude');
    });

    it('omits the Getting Started button', () => {
      expect(html).not.toContain('command:agenticBookmarks.openGettingStarted');
    });
  });

  describe('active mode (folder loaded)', () => {
    const html = renderWelcomeHtml({ ...baseOpts, hasFolder: true, agents: allUninstalled });

    it('shows Learn cards', () => {
      expect(html).toContain('Local vs. Shared Bookmarks');
      expect(html).toContain('Powerful Support Skills');
    });

    it('does not show the open-folder CTA', () => {
      expect(html).not.toContain('command:vscode.openFolder');
    });

    it('learn items show an explicit "Learn more" link', () => {
      expect(html).toContain('Learn more');
    });

    it('learn items use learn-item class', () => {
      expect(html).toContain('class="learn-item"');
    });

    it('learn items have browser-navigation link text', () => {
      expect(html).toContain('Learn more →');
    });

    it('shows the Getting Started button', () => {
      expect(html).toContain('command:agenticBookmarks.openGettingStarted');
      expect(html).toContain('Getting Started Guide');
    });

    it('Getting Started button appears before the Learn section', () => {
      expect(html.indexOf('openGettingStarted')).toBeLessThan(html.indexOf('>Learn<'));
    });
  });

  describe('community section', () => {
    const activeHtml = renderWelcomeHtml({ ...baseOpts, hasFolder: true, agents: allUninstalled });
    const emptyHtml = renderWelcomeHtml({ ...baseOpts, hasFolder: false });

    it('shows Discord card in active mode', () => {
      expect(activeHtml).toContain('Join our Discord');
    });

    it('shows GitHub issues card in active mode', () => {
      expect(activeHtml).toContain('Report an Issue');
    });

    it('community cards use the vscode.open command', () => {
      expect(activeHtml).toContain('command:vscode.open');
    });

    it('omits community section in empty mode', () => {
      expect(emptyHtml).not.toContain('Join our Discord');
      expect(emptyHtml).not.toContain('Report an Issue');
    });
  });

  describe('gitignore banner', () => {
    it('shows the banner with its command when needsGitignore is true and a folder is loaded', () => {
      const html = renderWelcomeHtml({ ...baseOpts, hasFolder: true, needsGitignore: true, agents: allUninstalled });
      expect(html).toContain('command:agenticBookmarks.addLocalToGitignore');
      expect(html).toContain('.gitignore');
    });

    it('omits the banner when needsGitignore is false', () => {
      const html = renderWelcomeHtml({ ...baseOpts, hasFolder: true, needsGitignore: false, agents: allUninstalled });
      expect(html).not.toContain('command:agenticBookmarks.addLocalToGitignore');
    });

    it('omits the banner when no folder is loaded even if needsGitignore is true', () => {
      const html = renderWelcomeHtml({ ...baseOpts, hasFolder: false, needsGitignore: true });
      expect(html).not.toContain('command:agenticBookmarks.addLocalToGitignore');
    });

    it('renders the banner before the Learn section', () => {
      const html = renderWelcomeHtml({ ...baseOpts, hasFolder: true, needsGitignore: true, agents: allUninstalled });
      expect(html.indexOf('addLocalToGitignore')).toBeLessThan(html.indexOf('>Learn<'));
    });
  });

  describe('agent connections — empty state (no installs)', () => {
    const html = renderWelcomeHtml({ ...baseOpts, hasFolder: true, agents: allUninstalled });

    it('renders the section header with title and ? help link', () => {
      expect(html).toContain('>Agent connections<');
      expect(html).toContain('command:agenticBookmarks.openHelp.agentConnections');
    });

    it('renders a "Connect to <agent>" hero button for every known agent', () => {
      expect(html).toContain('Connect to Claude Code');
      expect(html).toContain('Connect to Cursor');
      expect(html).toContain('Connect to Codex');
    });

    it('hero buttons fire the appropriate setup commands', () => {
      expect(html).toContain('command:agenticBookmarks.setupClaude');
      expect(html).toContain('command:agenticBookmarks.setupCursor');
      expect(html).toContain('command:agenticBookmarks.setupCodex');
    });

    it('does not render a "Connect another agent…" footer in empty state', () => {
      expect(html).not.toContain('Connect another agent');
    });

    it('does not render any installed-row UI', () => {
      expect(html).not.toContain('class="agent-row"');
      expect(html).not.toContain('Installed (');
      expect(html).not.toContain('agentConnections.showRowActions');
    });
  });

  describe('agent connections — populated state', () => {
    const currentVersion = '0.8.2';

    it('renders a row for an installed agent with status text and a "Up to date" pill', () => {
      const html = renderWelcomeHtml({
        ...baseOpts,
        hasFolder: true,
        agents: [
          descriptor('claude', { local: { installedVersion: currentVersion } }, false),
          descriptor('cursor'),
          descriptor('codex'),
        ],
      });
      expect(html).toContain('class="agent-row"');
      expect(html).toContain('Claude Code');
      expect(html).toContain('Installed (Local) · v0.8.2');
      expect(html).toContain('Up to date');
      expect(html).toContain('class="status-pill row-primary"');
      expect(html).not.toContain('>Update MCP<');
    });

    it('does not render a Reinstall button anywhere — Reinstall is hamburger-only now', () => {
      const html = renderWelcomeHtml({
        ...baseOpts,
        hasFolder: true,
        agents: [
          descriptor('claude', { local: { installedVersion: currentVersion } }, false),
        ],
      });
      expect(html).not.toContain('>Reinstall<');
    });

    it('"Up to date" pill is not clickable (no command URI on the primary slot)', () => {
      const html = renderWelcomeHtml({
        ...baseOpts,
        hasFolder: true,
        agents: [
          descriptor('claude', { local: { installedVersion: currentVersion } }, false),
        ],
      });
      // The status-pill div appears, but it should not be wrapped in an <a>
      // and should not carry a command: href on the row-primary slot.
      const pillMatch = html.match(/<div class="status-pill row-primary"[^>]*>/);
      expect(pillMatch).not.toBeNull();
      // No command on the pill itself
      expect(pillMatch?.[0]).not.toContain('href=');
    });

    it('shows "Update MCP" when any installed scope is older than current', () => {
      const html = renderWelcomeHtml({
        ...baseOpts,
        hasFolder: true,
        agents: [
          descriptor('codex', { global: { installedVersion: '0.8.1' } }, true),
        ],
      });
      expect(html).toContain('>Update MCP<');
      expect(html).toContain('(older)');
    });

    it('shows the "Update MCP" tooltip on the outdated-state primary button', () => {
      const html = renderWelcomeHtml({
        ...baseOpts,
        hasFolder: true,
        agents: [
          descriptor('codex', { global: { installedVersion: '0.8.1' } }, true),
        ],
      });
      expect(html).toContain('Update the agentic-bookmarks MCP server to match this extension');
    });

    it('outdated row primary button is wired to the smartUpdate dispatcher with the agent id', () => {
      const html = renderWelcomeHtml({
        ...baseOpts,
        hasFolder: true,
        agents: [
          descriptor('claude', { user: { installedVersion: '0.8.0' } }, true),
        ],
      });
      expect(html).toContain('command:agenticBookmarks.agentConnections.smartUpdate');
      expect(html).toContain(encodeURIComponent(JSON.stringify(['claude'])));
    });

    it('shows both scope labels when an agent is installed at both scopes', () => {
      const html = renderWelcomeHtml({
        ...baseOpts,
        hasFolder: true,
        agents: [
          descriptor('claude', {
            local: { installedVersion: currentVersion },
            user:  { installedVersion: currentVersion },
          }, false),
        ],
      });
      expect(html).toContain('Installed (Local, User)');
    });

    it('uses Project/Global for Cursor/Codex even when both are installed', () => {
      const html = renderWelcomeHtml({
        ...baseOpts,
        hasFolder: true,
        agents: [
          descriptor('cursor', {
            project: { installedVersion: currentVersion },
            global:  { installedVersion: currentVersion },
          }, false),
        ],
      });
      expect(html).toContain('Installed (Project, Global)');
    });

    it('renders the hamburger button wired to showRowActions for each installed row', () => {
      const html = renderWelcomeHtml({
        ...baseOpts,
        hasFolder: true,
        agents: [
          descriptor('claude', { user: { installedVersion: currentVersion } }, false),
        ],
      });
      // The command URI encodes the agent id as the first positional argument.
      expect(html).toContain('command:agenticBookmarks.agentConnections.showRowActions');
      expect(html).toContain(encodeURIComponent(JSON.stringify(['claude'])));
    });

    it('renders the "Connect another agent…" footer when at least one agent is unconnected', () => {
      const html = renderWelcomeHtml({
        ...baseOpts,
        hasFolder: true,
        agents: [
          descriptor('claude', { local: { installedVersion: currentVersion } }, false),
          descriptor('cursor'),
          descriptor('codex'),
        ],
      });
      expect(html).toContain('Connect another agent…');
      expect(html).toContain('command:agenticBookmarks.agentConnections.connectAnother');
    });

    it('omits the "Connect another agent…" footer when every agent is installed', () => {
      const html = renderWelcomeHtml({
        ...baseOpts,
        hasFolder: true,
        agents: [
          descriptor('claude', { user: { installedVersion: currentVersion } }, false),
          descriptor('cursor', { global: { installedVersion: currentVersion } }, false),
          descriptor('codex', { global: { installedVersion: currentVersion } }, false),
        ],
      });
      expect(html).not.toContain('Connect another agent');
    });

    it('does not render hero "Connect to" buttons once any agent is connected', () => {
      const html = renderWelcomeHtml({
        ...baseOpts,
        hasFolder: true,
        agents: [
          descriptor('claude', { local: { installedVersion: currentVersion } }, false),
          descriptor('cursor'),
          descriptor('codex'),
        ],
      });
      expect(html).not.toContain('Connect to Claude Code');
      expect(html).not.toContain('Connect to Cursor');
      expect(html).not.toContain('Connect to Codex');
    });

    it('handles missing installedVersion gracefully', () => {
      const html = renderWelcomeHtml({
        ...baseOpts,
        hasFolder: true,
        agents: [
          descriptor('claude', { user: {} }, true),
        ],
      });
      expect(html).toContain('Installed (User)');
      expect(html).toContain('version unknown');
    });

    describe('Update-all banner', () => {
      it('renders when at least one agent is outdated', () => {
        const html = renderWelcomeHtml({
          ...baseOpts,
          hasFolder: true,
          agents: [
            descriptor('claude', { local: { installedVersion: '0.8.1' } }, true),
            descriptor('cursor', { project: { installedVersion: currentVersion } }, false),
            descriptor('codex'),
          ],
        });
        expect(html).toContain('Update all MCPs');
        expect(html).toContain('command:agenticBookmarks.agentConnections.updateAllOutdated');
      });

      it('does not render when no agent is outdated', () => {
        const html = renderWelcomeHtml({
          ...baseOpts,
          hasFolder: true,
          agents: [
            descriptor('claude', { local: { installedVersion: currentVersion } }, false),
            descriptor('cursor'),
            descriptor('codex'),
          ],
        });
        expect(html).not.toContain('Update all MCPs');
      });

      it('appears before any agent row', () => {
        const html = renderWelcomeHtml({
          ...baseOpts,
          hasFolder: true,
          agents: [
            descriptor('claude', { local: { installedVersion: '0.8.1' } }, true),
          ],
        });
        expect(html.indexOf('Update all MCPs')).toBeLessThan(html.indexOf('class="agent-row"'));
      });
    });
  });
});

describe('label sanity', () => {
  it('renders the new "Update all MCPs" label, not the prior "Update all outdated"', () => {
    const html = renderWelcomeHtml({
      iconUri: 'https://example/icon512.png',
      cspSource: 'vscode-webview://example',
      nonce: 'testnonce',
      hasFolder: true,
      agents: [
        {
          agent: 'claude',
          displayName: 'Claude Code',
          installs: { local: { installedVersion: '0.8.0' } },
          scopes: { workspace: 'local', global: 'user' },
          scopeLabel: (s) => s,
          isOutdated: true,
        },
      ],
    });
    expect(html).not.toContain('Update all outdated');
  });
});

describe('collapsible sections', () => {
  const opts = {
    iconUri: 'https://example/icon512.png',
    cspSource: 'vscode-webview://example',
    nonce: 'testnonce',
    hasFolder: true,
    agents: allUninstalled,
  };

  it('each of Learn / Agent connections / Community renders a toggle anchor with the corresponding section id', () => {
    const html = renderWelcomeHtml({ ...opts });
    expect(html).toContain('command:agenticBookmarks.welcome.toggleSection');
    expect(html).toContain(encodeURIComponent(JSON.stringify(['learn'])));
    expect(html).toContain(encodeURIComponent(JSON.stringify(['agentConnections'])));
    expect(html).toContain(encodeURIComponent(JSON.stringify(['community'])));
  });

  it('default chevron is ▼ (expanded) when no collapsedSections are provided', () => {
    const html = renderWelcomeHtml({ ...opts });
    expect(html).toContain('▼');
    expect(html).not.toContain('▶');
  });

  it('chevron is ▶ for sections marked collapsed', () => {
    const html = renderWelcomeHtml({ ...opts, collapsedSections: { learn: true } });
    // Both ▼ (other sections) and ▶ (Learn) should appear
    expect(html).toContain('▶');
    expect(html).toContain('▼');
  });

  it('collapsing Learn omits its body content', () => {
    const expanded = renderWelcomeHtml({ ...opts });
    const collapsed = renderWelcomeHtml({ ...opts, collapsedSections: { learn: true } });
    expect(expanded).toContain('Local vs. Shared Bookmarks');
    expect(collapsed).not.toContain('Local vs. Shared Bookmarks');
  });

  it('collapsing Community omits the Discord and Issues cards', () => {
    const collapsed = renderWelcomeHtml({ ...opts, collapsedSections: { community: true } });
    expect(collapsed).not.toContain('Join our Discord');
    expect(collapsed).not.toContain('Report an Issue');
  });

  it('collapsing Agent connections omits hero buttons in empty state', () => {
    const collapsed = renderWelcomeHtml({ ...opts, collapsedSections: { agentConnections: true } });
    expect(collapsed).not.toContain('Connect to Claude Code');
    expect(collapsed).not.toContain('Connect to Cursor');
  });

  it('collapsing Agent connections still renders the section header and ? help icon', () => {
    const collapsed = renderWelcomeHtml({ ...opts, collapsedSections: { agentConnections: true } });
    expect(collapsed).toContain('Agent connections');
    expect(collapsed).toContain('command:agenticBookmarks.openHelp.agentConnections');
  });

  it('collapsing one section does not affect the others', () => {
    const html = renderWelcomeHtml({ ...opts, collapsedSections: { learn: true } });
    expect(html).not.toContain('Local vs. Shared Bookmarks');
    expect(html).toContain('Connect to Claude Code'); // Agent connections still expanded
    expect(html).toContain('Join our Discord');       // Community still expanded
  });

  it('explicit collapsedSections: { learn: false } renders as expanded', () => {
    const html = renderWelcomeHtml({ ...opts, collapsedSections: { learn: false } });
    expect(html).toContain('Local vs. Shared Bookmarks');
  });
});
