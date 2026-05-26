// ABOUTME: Tests for mcp-setup-helpers — covers claude mcp setup command generation
// ABOUTME: and gitignore setup application with injectable deps for testability.

import { describe, it, expect } from 'vitest';
import { buildClaudeMcpSetupCommand, buildClaudeMcpRemoveCommand, applyGitignoreSetup } from './mcp-setup-helpers';
import { GITIGNORE_NUDGE_SHOWN_KEY } from '../gitignore-nudge';

function makeState(initial?: Record<string, unknown>) {
  const data = new Map<string, unknown>(Object.entries(initial ?? {}));
  return {
    get: <T>(key: string): T | undefined => data.get(key) as T | undefined,
    update: async (key: string, value: unknown): Promise<void> => { data.set(key, value); },
    snapshot: () => Object.fromEntries(data.entries()),
  };
}

const noopLog = { error: () => undefined, info: () => undefined };

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

  describe('with an array of scopes', () => {
    it('still removes from both scopes once at the head of the command', () => {
      const cmd = buildClaudeMcpSetupCommand(['local', 'user'], '/x/server.js', '/ws/.bookmarks/local');
      // There must be exactly one remove for each scope (not duplicated per add).
      const localRemoveMatches = cmd.match(/mcp remove agentic_bookmarks --scope local 2>\/dev\/null/g) ?? [];
      const userRemoveMatches  = cmd.match(/mcp remove agentic_bookmarks --scope user 2>\/dev\/null/g) ?? [];
      expect(localRemoveMatches).toHaveLength(1);
      expect(userRemoveMatches).toHaveLength(1);
    });

    it('emits one `mcp add` per requested scope, in order, after the removes', () => {
      const cmd = buildClaudeMcpSetupCommand(['local', 'user'], '/x/server.js', '/ws/.bookmarks/local');
      const addLocal = cmd.indexOf('mcp add --transport stdio --env');
      // Two `mcp add` invocations total
      const addMatches = cmd.match(/mcp add --transport stdio/g) ?? [];
      expect(addMatches).toHaveLength(2);
      // The removes come before the first add
      const lastRemove = Math.max(
        cmd.lastIndexOf('mcp remove agentic_bookmarks --scope local'),
        cmd.lastIndexOf('mcp remove agentic_bookmarks --scope user'),
      );
      expect(lastRemove).toBeLessThan(addLocal);
    });

    it('uses local-scope env flags for the local add and user-scope env flags for the user add', () => {
      const cmd = buildClaudeMcpSetupCommand(['local', 'user'], '/x/server.js', '/ws/.bookmarks/local');
      // Local-add line carries BOOKMARKS_DIR=<bookmarksDir>
      expect(cmd).toContain('BOOKMARKS_DIR=/ws/.bookmarks/local');
      // User-add line carries upward discovery
      expect(cmd).toContain('BOOKMARKS_UPWARD_DISCOVERY=true');
    });

    it('an array of one scope behaves the same as a single-scope call', () => {
      const single = buildClaudeMcpSetupCommand('user', '/x/server.js', '');
      const wrappedArr = buildClaudeMcpSetupCommand(['user'], '/x/server.js', '');
      expect(wrappedArr).toBe(single);
    });
  });
});

describe('buildClaudeMcpRemoveCommand', () => {
  it('emits a bare remove for local scope without stderr suppression', () => {
    const cmd = buildClaudeMcpRemoveCommand('local');
    expect(cmd).toBe('claude mcp remove agentic_bookmarks --scope local');
    expect(cmd).not.toContain('2>/dev/null');
  });

  it('emits a bare remove for user scope without stderr suppression', () => {
    const cmd = buildClaudeMcpRemoveCommand('user');
    expect(cmd).toBe('claude mcp remove agentic_bookmarks --scope user');
  });

  it('targets the agentic_bookmarks server identifier', () => {
    expect(buildClaudeMcpRemoveCommand('local')).toContain('agentic_bookmarks');
  });
});

describe('applyGitignoreSetup', () => {
  it('calls appendGitignoreLine with the workspace root and canonical line', async () => {
    const state = makeState();
    let capturedRoot = '';
    let capturedLine = '';
    await applyGitignoreSetup({
      workspaceRoot: '/my/ws',
      workspaceState: state,
      log: noopLog,
      appendGitignoreLineFn: async (root, line) => {
        capturedRoot = root;
        capturedLine = line;
        return 'created';
      },
    });
    expect(capturedRoot).toBe('/my/ws');
    expect(capturedLine).toContain('.bookmarks/local/');
  });

  it('marks nudge shown in workspaceState after successful append', async () => {
    const state = makeState();
    await applyGitignoreSetup({
      workspaceRoot: '/ws',
      workspaceState: state,
      log: noopLog,
      appendGitignoreLineFn: async () => 'created',
    });
    expect(state.snapshot()[GITIGNORE_NUDGE_SHOWN_KEY]).toBe(true);
  });

  it('marks nudge shown when the line was already present', async () => {
    const state = makeState();
    await applyGitignoreSetup({
      workspaceRoot: '/ws',
      workspaceState: state,
      log: noopLog,
      appendGitignoreLineFn: async () => 'already-present',
    });
    expect(state.snapshot()[GITIGNORE_NUDGE_SHOWN_KEY]).toBe(true);
  });

  it('does not mark nudge shown when appendGitignoreLine throws', async () => {
    const state = makeState();
    await applyGitignoreSetup({
      workspaceRoot: '/ws',
      workspaceState: state,
      log: noopLog,
      appendGitignoreLineFn: async () => { throw new Error('EACCES'); },
    });
    expect(state.snapshot()[GITIGNORE_NUDGE_SHOWN_KEY]).toBeUndefined();
  });

  it('never throws even when appendGitignoreLine rejects', async () => {
    const state = makeState();
    await expect(applyGitignoreSetup({
      workspaceRoot: '/ws',
      workspaceState: state,
      log: noopLog,
      appendGitignoreLineFn: async () => { throw new Error('boom'); },
    })).resolves.toBeUndefined();
  });

  it('logs an error message when appendGitignoreLine throws', async () => {
    const state = makeState();
    const errors: string[] = [];
    await applyGitignoreSetup({
      workspaceRoot: '/ws',
      workspaceState: state,
      log: { error: (m) => errors.push(m), info: () => undefined },
      appendGitignoreLineFn: async () => { throw new Error('permission denied'); },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('permission denied');
  });
});
