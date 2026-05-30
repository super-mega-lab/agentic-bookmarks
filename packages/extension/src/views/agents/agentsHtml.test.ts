// ABOUTME: Tests for the Agents panel HTML renderer — skill pills and agent
// ABOUTME: connection section (empty, populated, collapsible states).
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderAgentsHtml, SKILLS, type AgentConnectionDescriptor } from './agentsHtml';
import { AGENT_SCOPES, scopeDisplayLabel, AGENT_DISPLAY_NAMES, type McpAgent } from '../../commands/mcp-install-state';

const pkgPath = path.join(__dirname, '../../..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const commands: Array<{ command: string }> = pkg.contributes.commands;

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
  cspSource: 'https://test.vscode',
  nonce: 'abc123',
};

describe('renderAgentsHtml — skill pills', () => {
  const html = renderAgentsHtml(baseOpts);

  it('returns a complete HTML document', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes the CSP with the provided source and nonce', () => {
    expect(html).toContain('https://test.vscode');
    expect(html).toContain('abc123');
  });

  it('renders a pill button for every skill', () => {
    for (const skill of SKILLS) {
      expect(html).toContain(skill.label);
      expect(html).toContain(`codicon-${skill.icon}`);
    }
  });

  it('renders command URIs with the skill id', () => {
    for (const skill of SKILLS) {
      expect(html).toContain(encodeURIComponent(JSON.stringify([skill.id])));
    }
  });

  it('has exactly 6 skill pills', () => {
    expect(SKILLS).toHaveLength(6);
  });
});

describe('renderAgentsHtml — no agents provided', () => {
  const html = renderAgentsHtml(baseOpts);

  it('does not render the agent connections section when agents list is empty', () => {
    expect(html).not.toContain('Agent connections');
    expect(html).not.toContain('class="agent-row"');
  });
});

describe('renderAgentsHtml — agent connections — empty state (no installs)', () => {
  const html = renderAgentsHtml({ ...baseOpts, agents: allUninstalled });

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

describe('renderAgentsHtml — agent connections — populated state', () => {
  const currentVersion = '0.8.2';

  it('renders a row for an installed agent with status text and a "Up to date" pill', () => {
    const html = renderAgentsHtml({
      ...baseOpts,
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

  it('does not render a Reinstall button — Reinstall is hamburger-only', () => {
    const html = renderAgentsHtml({
      ...baseOpts,
      agents: [
        descriptor('claude', { local: { installedVersion: currentVersion } }, false),
      ],
    });
    expect(html).not.toContain('>Reinstall<');
  });

  it('"Up to date" pill is not clickable (no command URI on the primary slot)', () => {
    const html = renderAgentsHtml({
      ...baseOpts,
      agents: [
        descriptor('claude', { local: { installedVersion: currentVersion } }, false),
      ],
    });
    const pillMatch = html.match(/<div class="status-pill row-primary"[^>]*>/);
    expect(pillMatch).not.toBeNull();
    expect(pillMatch?.[0]).not.toContain('href=');
  });

  it('shows "Update MCP" when any installed scope is older than current', () => {
    const html = renderAgentsHtml({
      ...baseOpts,
      agents: [
        descriptor('codex', { global: { installedVersion: '0.8.1' } }, true),
      ],
    });
    expect(html).toContain('>Update MCP<');
    expect(html).toContain('(older)');
  });

  it('shows the "Update MCP" tooltip on the outdated-state primary button', () => {
    const html = renderAgentsHtml({
      ...baseOpts,
      agents: [
        descriptor('codex', { global: { installedVersion: '0.8.1' } }, true),
      ],
    });
    expect(html).toContain('Update the agentic-bookmarks MCP server to match this extension');
  });

  it('outdated row primary button is wired to the smartUpdate dispatcher with the agent id', () => {
    const html = renderAgentsHtml({
      ...baseOpts,
      agents: [
        descriptor('claude', { user: { installedVersion: '0.8.0' } }, true),
      ],
    });
    expect(html).toContain('command:agenticBookmarks.agentConnections.smartUpdate');
    expect(html).toContain(encodeURIComponent(JSON.stringify(['claude'])));
  });

  it('shows both scope labels when an agent is installed at both scopes', () => {
    const html = renderAgentsHtml({
      ...baseOpts,
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
    const html = renderAgentsHtml({
      ...baseOpts,
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
    const html = renderAgentsHtml({
      ...baseOpts,
      agents: [
        descriptor('claude', { user: { installedVersion: currentVersion } }, false),
      ],
    });
    expect(html).toContain('command:agenticBookmarks.agentConnections.showRowActions');
    expect(html).toContain(encodeURIComponent(JSON.stringify(['claude'])));
  });

  it('renders the "Connect another agent…" footer when at least one agent is unconnected', () => {
    const html = renderAgentsHtml({
      ...baseOpts,
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
    const html = renderAgentsHtml({
      ...baseOpts,
      agents: [
        descriptor('claude', { user: { installedVersion: currentVersion } }, false),
        descriptor('cursor', { global: { installedVersion: currentVersion } }, false),
        descriptor('codex', { global: { installedVersion: currentVersion } }, false),
      ],
    });
    expect(html).not.toContain('Connect another agent');
  });

  it('does not render hero "Connect to" buttons once any agent is connected', () => {
    const html = renderAgentsHtml({
      ...baseOpts,
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
    const html = renderAgentsHtml({
      ...baseOpts,
      agents: [
        descriptor('claude', { user: {} }, true),
      ],
    });
    expect(html).toContain('Installed (User)');
    expect(html).toContain('version unknown');
  });

  describe('Update-all banner', () => {
    it('renders when at least one agent is outdated', () => {
      const html = renderAgentsHtml({
        ...baseOpts,
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
      const html = renderAgentsHtml({
        ...baseOpts,
        agents: [
          descriptor('claude', { local: { installedVersion: currentVersion } }, false),
          descriptor('cursor'),
          descriptor('codex'),
        ],
      });
      expect(html).not.toContain('Update all MCPs');
    });

    it('appears before any agent row', () => {
      const html = renderAgentsHtml({
        ...baseOpts,
        agents: [
          descriptor('claude', { local: { installedVersion: '0.8.1' } }, true),
        ],
      });
      expect(html.indexOf('Update all MCPs')).toBeLessThan(html.indexOf('class="agent-row"'));
    });
  });
});

describe('label sanity', () => {
  it('renders the new "Update all MCPs" label, not the prior "Update all outdated"', () => {
    const html = renderAgentsHtml({
      ...baseOpts,
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

describe('collapsible sections (disabled — always expanded)', () => {
  const opts = {
    ...baseOpts,
    agents: allUninstalled,
  };

  it('section header renders as a static label (no toggle/chevron in markup)', () => {
    const html = renderAgentsHtml(opts);
    expect(html).not.toContain('class="section-toggle"');
    expect(html).not.toContain('class="section-chevron"');
    expect(html).not.toContain('▼');
    expect(html).not.toContain('▶');
    expect(html).toContain('class="section-label"');
  });

  it('section is always expanded even when collapsedSections says otherwise', () => {
    const html = renderAgentsHtml({ ...opts, collapsedSections: { agentConnections: true } });
    expect(html).toContain('Connect to Claude Code');
    expect(html).toContain('Connect to Cursor');
    expect(html).toContain('Agent connections');
    expect(html).toContain('command:agenticBookmarks.openHelp.agentConnections');
  });

  it('skill pills always render regardless of section collapse', () => {
    const html = renderAgentsHtml({ ...opts, collapsedSections: { agentConnections: true } });
    for (const skill of SKILLS) {
      expect(html).toContain(skill.label);
    }
  });
});

describe('package.json agents commands', () => {
  it('registers agenticBookmarks.agents.toggleSection', () => {
    expect(commands.find(c => c.command === 'agenticBookmarks.agents.toggleSection')).toBeDefined();
  });
});

describe('renderAgentsHtml — no-folder state', () => {
  it('emits no runSkill command and no skill-pill when hasFolder is false', () => {
    const html = renderAgentsHtml({ ...baseOpts, hasFolder: false });
    expect(html).not.toContain('command:agenticBookmarks.runSkill');
    expect(html).not.toContain('class="skill-pill"');
  });

  it('emits no setup or agentConnections commands and no Agent connections section when hasFolder is false (even with agents)', () => {
    const html = renderAgentsHtml({ ...baseOpts, agents: allUninstalled, hasFolder: false });
    expect(html).not.toContain('command:agenticBookmarks.setupClaude');
    expect(html).not.toContain('command:agenticBookmarks.setupCursor');
    expect(html).not.toContain('command:agenticBookmarks.setupCodex');
    expect(html).not.toContain('command:agenticBookmarks.agentConnections.');
    expect(html).not.toContain('class="agent-row"');
    expect(html).not.toContain('Agent connections');
  });

  it('renders an Open a folder CTA and a complete, CSP-intact document when hasFolder is false', () => {
    const html = renderAgentsHtml({ ...baseOpts, hasFolder: false });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('https://test.vscode');
    expect(html).toContain('abc123');
    expect(html).toContain('Open a folder');
  });

  it('still renders all skill pills and the agent-connections section when hasFolder is true', () => {
    const html = renderAgentsHtml({ ...baseOpts, agents: allUninstalled, hasFolder: true });
    expect(html).toContain('command:agenticBookmarks.runSkill');
    for (const skill of SKILLS) {
      expect(html).toContain(skill.label);
    }
    expect(html).toContain('Agent connections');
    expect(html).toContain('command:agenticBookmarks.setupClaude');
  });
});
