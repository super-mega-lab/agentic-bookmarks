// ABOUTME: Tests for the welcome panel HTML renderer and VS Code view configuration.
// ABOUTME: Covers empty/active/gitignore-banner modes and LEARN section link structure.
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

    it('omits Learn cards and MCP setup buttons', () => {
      expect(html).not.toContain('Local vs. Shared Bookmarks');
      expect(html).not.toContain('Set up for Claude Code');
      expect(html).not.toContain('agenticBookmarks.setupClaude');
    });

    it('omits the Getting Started button', () => {
      const html = renderWelcomeHtml({ ...baseOpts, hasFolder: false });
      expect(html).not.toContain('command:agenticBookmarks.openGettingStarted');
    });
  });

  describe('active mode (folder loaded)', () => {
    const html = renderWelcomeHtml({ ...baseOpts, hasFolder: true });

    it('shows Learn cards and MCP setup buttons', () => {
      expect(html).toContain('Local vs. Shared Bookmarks');
      expect(html).toContain('Powerful Support Skills');
      expect(html).toContain('Set up for Claude Code');
      expect(html).toContain('agenticBookmarks.setupClaude');
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
