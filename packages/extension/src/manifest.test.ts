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
