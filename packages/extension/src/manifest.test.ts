// ABOUTME: Manifest sweep — asserts packages/extension/package.json contains no
// ABOUTME: legacy identifier prefixes from pre-rename namespaces (see SML-1385).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const manifestPath = join(__dirname, '..', 'package.json');
const manifestText = readFileSync(manifestPath, 'utf8');

function linesMatching(re: RegExp): string[] {
  const out: string[] = [];
  manifestText.split('\n').forEach((line, i) => {
    if (re.test(line)) out.push(`${i + 1}: ${line.trim()}`);
  });
  return out;
}

describe('extension manifest legacy-identifier sweep', () => {
  it('has no "config.<legacy>." references in when-clauses', () => {
    // Stage-5-style miss: the rename sed only matched leading-quoted
    // identifiers, so `config.bookmarks.X` strings inside `when` clauses
    // slipped through and silently disabled the showCommandsInContextMenu
    // setting until SML-1385's follow-up fix.
    expect(linesMatching(/config\.bookmarks\.|config\.smlBookmarks\.|config\.mcp\.bookmarks\./)).toEqual([]);
  });

  it('has no "smlBookmarks." context-key references', () => {
    expect(linesMatching(/smlBookmarks\./)).toEqual([]);
  });

  it('has no "mcp.bookmarks." command/identifier references', () => {
    expect(linesMatching(/mcp\.bookmarks\./)).toEqual([]);
  });

  it('has no legacy `"bookmarks.<key>"` configuration property names', () => {
    expect(linesMatching(/"bookmarks\.[a-zA-Z]/)).toEqual([]);
  });

  it('has no legacy view IDs (bookmarks-container or "bookmarks.{view,filesGroups,settings}")', () => {
    expect(linesMatching(/bookmarks-container|"bookmarks\.(view|filesGroups|settings)"|view == bookmarks[-.]/)).toEqual([]);
  });

  it('has no legacy machine name', () => {
    expect(linesMatching(/"name":\s*"bookmarks-mcp"/)).toEqual([]);
  });

  it('has no legacy MCP server identity', () => {
    expect(linesMatching(/mcp_bookmarks/)).toEqual([]);
  });

  it('has no legacy npm scope', () => {
    expect(linesMatching(/@bookmarks-mcp\//)).toEqual([]);
  });
});

describe('hotkey style preset support', () => {
  it('declares the agenticBookmarks.hotkeyStyle setting with the expected enum values and default', () => {
    expect(linesMatching(/"agenticBookmarks\.hotkeyStyle"/)).not.toEqual([]);
    expect(linesMatching(/"chorded"/)).not.toEqual([]);
    expect(linesMatching(/"basic"/)).not.toEqual([]);
    expect(linesMatching(/"custom"/)).not.toEqual([]);
    expect(linesMatching(/"default":\s*"chorded"/)).not.toEqual([]);
  });

  it('ships Basic keybindings gated on hotkeyStyle == basic matching alefragnani.Bookmarks', () => {
    // Each of these commands must appear in the manifest in at least one Basic-gated binding.
    // Basic mode mirrors alefragnani.Bookmarks' six editor keybindings:
    //   navigation triplet (Ctrl+Alt+K/L/J) + selection triplet (Shift+Alt+K/L/J).
    const manifest = JSON.parse(manifestText) as {
      contributes: { keybindings: Array<{ command: string; when?: string }> };
    };
    const basicBindings = manifest.contributes.keybindings.filter(
      (kb) => typeof kb.when === 'string' && kb.when.includes("config.agenticBookmarks.hotkeyStyle == 'basic'"),
    );
    expect(basicBindings.length).toBeGreaterThanOrEqual(6);
    const basicCommands = new Set(basicBindings.map((kb) => kb.command));
    expect(basicCommands.has('agenticBookmarks.toggle')).toBe(true);
    expect(basicCommands.has('agenticBookmarks.jumpNext')).toBe(true);
    expect(basicCommands.has('agenticBookmarks.jumpPrevious')).toBe(true);
    expect(basicCommands.has('agenticBookmarks.expandSelectionToNext')).toBe(true);
    expect(basicCommands.has('agenticBookmarks.expandSelectionToPrevious')).toBe(true);
    expect(basicCommands.has('agenticBookmarks.shrinkSelection')).toBe(true);
  });

  it('gates chord keybindings so they yield to Basic mode', () => {
    const manifest = JSON.parse(manifestText) as {
      contributes: { keybindings: Array<{ key?: string; when?: string }> };
    };
    const editorChords = manifest.contributes.keybindings.filter(
      (kb) =>
        typeof kb.key === 'string' &&
        kb.key.includes('ctrl+k') &&
        typeof kb.when === 'string' &&
        kb.when.includes('editorTextFocus'),
    );
    expect(editorChords.length).toBeGreaterThan(0);
    for (const kb of editorChords) {
      expect(kb.when).toContain("config.agenticBookmarks.hotkeyStyle != 'basic'");
    }
  });

  it('declares the agenticBookmarks.customizeKeybindings command', () => {
    expect(linesMatching(/"command":\s*"agenticBookmarks\.customizeKeybindings"/)).not.toEqual([]);
    expect(linesMatching(/"title":\s*"Customize Keybindings…"/)).not.toEqual([]);
  });
});

describe('bulk open/scan commands', () => {
  const manifest = JSON.parse(manifestText) as {
    contributes: {
      commands: Array<{ command: string; title: string; category?: string }>;
    };
  };
  const byId = new Map(manifest.contributes.commands.map((c) => [c.command, c]));

  const expected: Array<{ id: string; title: string }> = [
    { id: 'agenticBookmarks.openAllFiles', title: 'Open All Files With Bookmarks' },
    {
      id: 'agenticBookmarks.openAllFilesIncludingHidden',
      title: 'Open All Files With Bookmarks (Including Hidden Groups)',
    },
    { id: 'agenticBookmarks.scanAllFiles', title: 'Scan All Files With Bookmarks' },
    {
      id: 'agenticBookmarks.scanAllFilesIncludingHidden',
      title: 'Scan All Files With Bookmarks (Including Hidden Groups)',
    },
  ];

  for (const { id, title } of expected) {
    it(`declares ${id} with the expected title and category`, () => {
      const entry = byId.get(id);
      expect(entry, `command ${id} not declared in contributes.commands`).toBeDefined();
      expect(entry!.title).toBe(title);
      expect(entry!.category).toBe('Agentic Bookmarks');
    });
  }
});

describe('view-structure toggle commands', () => {
  it('declares toggleShowFilesInAllBookmarks and toggleShowBookmarksInFilesAndGroups', () => {
    expect(linesMatching(/"command":\s*"agenticBookmarks\.toggleShowFilesInAllBookmarks"/)).not.toEqual([]);
    expect(linesMatching(/"command":\s*"agenticBookmarks\.toggleShowBookmarksInFilesAndGroups"/)).not.toEqual([]);
  });
});

describe('local sorting feature', () => {
  it('declares sortMode settings, dev multi-select drag flag, and sort-mode commands', () => {
    // Settings
    expect(linesMatching(/"agenticBookmarks\.sortMode\.allBookmarks"/)).not.toEqual([]);
    expect(linesMatching(/"agenticBookmarks\.sortMode\.filesAndGroups"/)).not.toEqual([]);
    expect(linesMatching(/"agenticBookmarks\.dev\.enableMultiSelectDrag"/)).not.toEqual([]);
    // Commands
    expect(linesMatching(/"command":\s*"agenticBookmarks\.setSortModeAllBookmarks"/)).not.toEqual([]);
    expect(linesMatching(/"command":\s*"agenticBookmarks\.setSortModeFilesAndGroups"/)).not.toEqual([]);
  });
});
