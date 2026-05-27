// ABOUTME: Tests for the welcome panel HTML renderer and VS Code view configuration.
// ABOUTME: Covers empty/active/gitignore-banner modes, LEARN section link structure,
// ABOUTME: and Community & Support section. Agent Connections moved to Agents panel.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderWelcomeHtml } from './welcomeHtml';

const pkgPath = path.join(__dirname, '../../..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const containerViews: Array<{ id: string; visibility?: string }> =
  pkg.contributes.views['agenticBookmarks-container'];

describe('package.json view visibility', () => {
  it('welcome view starts visible', () => {
    const welcome = containerViews.find(v => v.id === 'agenticBookmarks.welcome');
    expect(welcome?.visibility).toBe('visible');
  });

  it('agents view starts visible', () => {
    const agents = containerViews.find(v => v.id === 'agenticBookmarks.agents');
    expect(agents?.visibility).toBe('visible');
  });

  it('non-welcome/agents views start collapsed so welcome is prominent on first install', () => {
    const alwaysVisible = new Set(['agenticBookmarks.welcome', 'agenticBookmarks.agents']);
    const collapsed = containerViews.filter(v => !alwaysVisible.has(v.id));
    for (const view of collapsed) {
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

const baseOpts = {
  iconUri: 'https://example/icon512.png',
  cspSource: 'vscode-webview://example',
  nonce: 'testnonce',
};

describe('renderWelcomeHtml', () => {
  it('always renders the hero title', () => {
    expect(renderWelcomeHtml({ ...baseOpts, hasFolder: true })).toContain('Agentic Bookmarks');
    expect(renderWelcomeHtml({ ...baseOpts, hasFolder: false })).toContain('Agentic Bookmarks');
  });

  describe('empty mode (no folder)', () => {
    const html = renderWelcomeHtml({ ...baseOpts, hasFolder: false });

    it('shows the open-folder CTA', () => {
      expect(html).toContain('Open Folder');
      expect(html).toContain('command:vscode.openFolder');
    });

    it('omits Learn cards', () => {
      expect(html).not.toContain('Local vs. Shared Bookmarks');
    });

    it('omits the Getting Started button', () => {
      expect(html).not.toContain('command:agenticBookmarks.openGettingStarted');
    });
  });

  describe('active mode (folder loaded)', () => {
    const html = renderWelcomeHtml({ ...baseOpts, hasFolder: true });

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

    it('does not render agent connections (moved to Agents panel)', () => {
      expect(html).not.toContain('Agent connections');
      expect(html).not.toContain('agentConnections');
    });
  });

  describe('community section', () => {
    const activeHtml = renderWelcomeHtml({ ...baseOpts, hasFolder: true });
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
      const html = renderWelcomeHtml({ ...baseOpts, hasFolder: true, needsGitignore: true });
      expect(html).toContain('command:agenticBookmarks.addLocalToGitignore');
      expect(html).toContain('.gitignore');
    });

    it('omits the banner when needsGitignore is false', () => {
      const html = renderWelcomeHtml({ ...baseOpts, hasFolder: true, needsGitignore: false });
      expect(html).not.toContain('command:agenticBookmarks.addLocalToGitignore');
    });

    it('omits the banner when no folder is loaded even if needsGitignore is true', () => {
      const html = renderWelcomeHtml({ ...baseOpts, hasFolder: false, needsGitignore: true });
      expect(html).not.toContain('command:agenticBookmarks.addLocalToGitignore');
    });

    it('renders the banner before the Learn section', () => {
      const html = renderWelcomeHtml({ ...baseOpts, hasFolder: true, needsGitignore: true });
      expect(html.indexOf('addLocalToGitignore')).toBeLessThan(html.indexOf('>Learn<'));
    });
  });
});

describe('collapsible sections', () => {
  const opts = {
    iconUri: 'https://example/icon512.png',
    cspSource: 'vscode-webview://example',
    nonce: 'testnonce',
    hasFolder: true,
  };

  // Collapse toggling is disabled — sections are always expanded for now.

  it('section headers render as static labels (no toggle/chevron in markup)', () => {
    const html = renderWelcomeHtml({ ...opts });
    expect(html).not.toContain('class="section-toggle"');
    expect(html).not.toContain('class="section-chevron"');
    expect(html).not.toContain('▼');
    expect(html).not.toContain('▶');
    expect(html).toContain('class="section-label"');
  });

  it('sections are always expanded even when collapsedSections says otherwise', () => {
    const html = renderWelcomeHtml({ ...opts, collapsedSections: { learn: true, community: true } });
    expect(html).toContain('Local vs. Shared Bookmarks');
    expect(html).toContain('Join our Discord');
    expect(html).toContain('Report an Issue');
  });
});
