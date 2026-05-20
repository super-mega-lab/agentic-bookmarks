import { describe, it, expect } from 'vitest';
import { renderWelcomeHtml } from './welcomeHtml';

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
      expect(html).toContain('Set up for Claude Code');
      expect(html).toContain('agenticBookmarks.setupClaude');
    });

    it('does not show the open-folder CTA', () => {
      expect(html).not.toContain('command:vscode.openFolder');
    });
  });
});
