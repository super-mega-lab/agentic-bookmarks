// ABOUTME: Tests for mcp-setup-helpers — covers claude mcp setup command generation.
// ABOUTME: Validates remove-before-add ordering, scope flags, and env var construction.

import { describe, it, expect } from 'vitest';
import { buildClaudeMcpSetupCommand } from './mcp-setup-helpers';

describe('buildClaudeMcpSetupCommand', () => {
  it('removes from both local and user scopes before adding', () => {
    const cmd = buildClaudeMcpSetupCommand('user', '/ext/server/index.js', '/ws/.bookmarks/local');
    const removeLocalIdx = cmd.indexOf('mcp remove agentic_bookmarks --scope local');
    const removeUserIdx = cmd.indexOf('mcp remove agentic_bookmarks --scope user');
    const addIdx = cmd.indexOf('mcp add');
    expect(removeLocalIdx).toBeGreaterThan(-1);
    expect(removeUserIdx).toBeGreaterThan(-1);
    expect(removeLocalIdx).toBeLessThan(addIdx);
    expect(removeUserIdx).toBeLessThan(addIdx);
  });

  it('suppresses remove errors so first-time install succeeds', () => {
    const cmd = buildClaudeMcpSetupCommand('user', '/ext/server/index.js', '');
    const removeLocalIdx = cmd.indexOf('mcp remove agentic_bookmarks --scope local');
    const removeUserIdx = cmd.indexOf('mcp remove agentic_bookmarks --scope user');
    // Each remove must be followed by error suppression before the next statement
    expect(cmd.slice(removeLocalIdx)).toMatch(/--scope local 2>\/dev\/null/);
    expect(cmd.slice(removeUserIdx)).toMatch(/--scope user 2>\/dev\/null/);
  });

  it('adds with --scope user for user scope', () => {
    const cmd = buildClaudeMcpSetupCommand('user', '/ext/server/index.js', '');
    const addIdx = cmd.indexOf('mcp add');
    expect(cmd.slice(addIdx)).toContain('--scope user');
  });

  it('adds with --scope local for local scope', () => {
    const cmd = buildClaudeMcpSetupCommand('local', '/ext/server/index.js', '/ws/.bookmarks/local');
    const addIdx = cmd.indexOf('mcp add');
    expect(cmd.slice(addIdx)).toContain('--scope local');
  });

  it('pins BOOKMARKS_DIR to workspace path for local scope', () => {
    const cmd = buildClaudeMcpSetupCommand('local', '/ext/server/index.js', '/ws/.bookmarks/local');
    expect(cmd).toContain('BOOKMARKS_DIR=/ws/.bookmarks/local');
  });

  it('uses empty BOOKMARKS_DIR and upward discovery for user scope', () => {
    const cmd = buildClaudeMcpSetupCommand('user', '/ext/server/index.js', '');
    expect(cmd).toContain('BOOKMARKS_DIR=');
    expect(cmd).toContain('BOOKMARKS_UPWARD_DISCOVERY=true');
  });

  it('shell-quotes the server path', () => {
    const cmd = buildClaudeMcpSetupCommand('user', '/path/to/server/index.js', '');
    expect(cmd).toContain("'/path/to/server/index.js'");
  });
});
