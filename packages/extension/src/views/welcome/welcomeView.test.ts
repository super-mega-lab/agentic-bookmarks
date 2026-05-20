// ABOUTME: Tests for the Agentic Bookmarks welcome panel webview HTML rendering.
// ABOUTME: Covers view visibility config, HTML structure, and content across all states.
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

    it('shows X follow card in active mode', () => {
      expect(activeHtml).toContain('Follow on X');
    });

    it('community cards use the vscode.open command', () => {
      expect(activeHtml).toContain('command:vscode.open');
    });

    it('omits community section in empty mode', () => {
      expect(emptyHtml).not.toContain('Join our Discord');
      expect(emptyHtml).not.toContain('Report an Issue');
      expect(emptyHtml).not.toContain('Follow on X');
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
