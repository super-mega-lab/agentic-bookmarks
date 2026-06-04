// ABOUTME: Tests for the Codex config.toml install path (SML-1578).
// ABOUTME: Verifies the install mirrors the uninstall guards: ENOENT-creates, rethrows
// ABOUTME: non-ENOENT errors, one-shot backup, atomic rename, legacy strip, surgical merge.

import { describe, it, expect } from 'vitest';
import { applyCodexInstall } from './mcp-setup-helpers';
import type { FsDeps } from './mcp-uninstall-helpers';

function makeFs(initial?: Record<string, string>) {
  const data = new Map<string, string>(Object.entries(initial ?? {}));
  const operations: Array<{ op: string; args: string[] }> = [];
  const fs: FsDeps = {
    async readFile(p: string) {
      operations.push({ op: 'readFile', args: [p] });
      if (!data.has(p)) {
        const err = new Error(`ENOENT: no such file, open '${p}'`) as Error & { code: string };
        err.code = 'ENOENT';
        throw err;
      }
      return data.get(p)!;
    },
    async writeFile(p: string, content: string) {
      operations.push({ op: 'writeFile', args: [p] });
      data.set(p, content);
    },
    async rename(from: string, to: string) {
      operations.push({ op: 'rename', args: [from, to] });
      if (!data.has(from)) {
        const err = new Error(`ENOENT: no such file, rename '${from}'`) as Error & { code: string };
        err.code = 'ENOENT';
        throw err;
      }
      data.set(to, data.get(from)!);
      data.delete(from);
    },
    async copyFile(from: string, to: string) {
      operations.push({ op: 'copyFile', args: [from, to] });
      if (!data.has(from)) {
        const err = new Error(`ENOENT: no such file, copy '${from}'`) as Error & { code: string };
        err.code = 'ENOENT';
        throw err;
      }
      data.set(to, data.get(from)!);
    },
  };
  return { fs, data, operations, snapshot: () => Object.fromEntries(data.entries()) };
}

const PATH = '/home/u/.codex/config.toml';

const NEW_BLOCK = [
  '[mcp_servers."agentic_bookmarks"]',
  'command = "node"',
  'args = [',
  '  "/x/server.js",',
  ']',
  'env = { BOOKMARKS_DIR = "", BOOKMARKS_UPWARD_DISCOVERY = "true" }',
  'startup_timeout_sec = 20',
  '',
].join('\n');

const OTHER_BLOCK = [
  '[mcp_servers."some_other_server"]',
  'command = "python"',
  'args = ["-m", "other.server"]',
  '',
].join('\n');

const UNRELATED_TOP_LEVEL = [
  '# unrelated top-level config',
  'editor = "vim"',
  'theme = "dark"',
  '',
].join('\n');

describe('applyCodexInstall', () => {
  it('creates a fresh config (no backup) when the file is missing', async () => {
    const env = makeFs();
    const result = await applyCodexInstall({ configPath: PATH, serverBlock: NEW_BLOCK, fs: env.fs });
    expect(result).toEqual({ status: 'written' });
    // No backup when there was nothing to back up.
    expect(env.operations.filter(o => o.op === 'copyFile')).toHaveLength(0);
    const after = env.snapshot()[PATH]!;
    expect(after).toContain('[mcp_servers."agentic_bookmarks"]');
    expect(after).toContain('/x/server.js');
  });

  it('rethrows a non-ENOENT read error (EACCES) and never clobbers the file (SML-1578)', async () => {
    // A permission/IO error must surface, never be mistaken for "empty" and overwrite the file.
    const ops: string[] = [];
    const eaccesFs: FsDeps = {
      async readFile(p: string): Promise<string> {
        ops.push('readFile');
        const err = new Error(`EACCES: permission denied, open '${p}'`) as Error & { code: string };
        err.code = 'EACCES';
        throw err;
      },
      async writeFile() { ops.push('writeFile'); },
      async rename() { ops.push('rename'); },
      async copyFile() { ops.push('copyFile'); },
    };
    await expect(
      applyCodexInstall({ configPath: PATH, serverBlock: NEW_BLOCK, fs: eaccesFs }),
    ).rejects.toMatchObject({ code: 'EACCES' });
    // Only the read was attempted — no backup, no write, no rename.
    expect(ops).toEqual(['readFile']);
  });

  it('merges into an existing config, preserving other mcp_servers blocks and top-level content', async () => {
    const before = UNRELATED_TOP_LEVEL + '\n' + OTHER_BLOCK;
    const env = makeFs({ [PATH]: before });
    const result = await applyCodexInstall({ configPath: PATH, serverBlock: NEW_BLOCK, fs: env.fs });
    expect(result).toEqual({ status: 'written' });
    const after = env.snapshot()[PATH]!;
    expect(after).toContain('[mcp_servers."agentic_bookmarks"]');
    expect(after).toContain('[mcp_servers."some_other_server"]');
    expect(after).toContain('command = "python"');
    expect(after).toContain('editor = "vim"');
  });

  it('writes via a .tmp file and renames atomically (atomic-rename guard)', async () => {
    const env = makeFs({ [PATH]: UNRELATED_TOP_LEVEL });
    await applyCodexInstall({ configPath: PATH, serverBlock: NEW_BLOCK, fs: env.fs });
    const writes = env.operations.filter(o => o.op === 'writeFile');
    const renames = env.operations.filter(o => o.op === 'rename');
    expect(writes).toHaveLength(1);
    expect(writes[0].args[0]).toBe(PATH + '.agentic-bookmarks.tmp');
    expect(renames).toHaveLength(1);
    expect(renames[0].args).toEqual([PATH + '.agentic-bookmarks.tmp', PATH]);
  });

  it('backs up the original before mutating it (one-shot backup guard)', async () => {
    const original = UNRELATED_TOP_LEVEL + OTHER_BLOCK;
    const env = makeFs({ [PATH]: original });
    await applyCodexInstall({ configPath: PATH, serverBlock: NEW_BLOCK, fs: env.fs });
    expect(env.snapshot()[PATH + '.agentic-bookmarks-backup']).toBe(original);
    const copyIdx = env.operations.findIndex(o => o.op === 'copyFile');
    const writeIdx = env.operations.findIndex(o => o.op === 'writeFile');
    expect(copyIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(-1);
    expect(copyIdx).toBeLessThan(writeIdx);
  });

  it('drops legacy server keys (mcp.bookmarks, mcp_bookmarks) while installing', async () => {
    const legacyBlock1 = [
      '[mcp_servers."mcp.bookmarks"]',
      'command = "node"',
      'args = ["/old.js"]',
      '',
    ].join('\n');
    const legacyBlock2 = [
      '[mcp_servers."mcp_bookmarks"]',
      'command = "node"',
      'args = ["/old2.js"]',
      '',
    ].join('\n');
    const before = legacyBlock1 + '\n' + legacyBlock2 + '\n' + OTHER_BLOCK;
    const env = makeFs({ [PATH]: before });
    await applyCodexInstall({ configPath: PATH, serverBlock: NEW_BLOCK, fs: env.fs });
    const after = env.snapshot()[PATH]!;
    expect(after).not.toContain('[mcp_servers."mcp.bookmarks"]');
    expect(after).not.toContain('[mcp_servers."mcp_bookmarks"]');
    expect(after).toContain('[mcp_servers."agentic_bookmarks"]');
    expect(after).toContain('[mcp_servers."some_other_server"]');
  });

  it('overwrites a stale agentic_bookmarks block (re-install / update path)', async () => {
    const staleBlock = [
      '[mcp_servers."agentic_bookmarks"]',
      'command = "node"',
      'args = ["/stale/server.js"]',
      '',
    ].join('\n');
    const before = UNRELATED_TOP_LEVEL + '\n' + staleBlock;
    const env = makeFs({ [PATH]: before });
    await applyCodexInstall({ configPath: PATH, serverBlock: NEW_BLOCK, fs: env.fs });
    const after = env.snapshot()[PATH]!;
    expect(after).toContain('/x/server.js');
    expect(after).not.toContain('/stale/server.js');
    expect(after).toContain('editor = "vim"');
  });
});
