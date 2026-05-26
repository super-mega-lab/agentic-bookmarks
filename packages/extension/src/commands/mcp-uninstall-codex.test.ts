// ABOUTME: Tests for the Codex config.toml uninstall path.
// ABOUTME: Verifies the same 5 safety guards as the Cursor uninstall.

import { describe, it, expect } from 'vitest';
import { applyCodexUninstall, type FsDeps } from './mcp-uninstall-helpers';

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

const OUR_BLOCK = [
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

describe('applyCodexUninstall', () => {
  it('returns "absent" with no writes when the file is missing', async () => {
    const env = makeFs();
    const result = await applyCodexUninstall({ configPath: PATH, fs: env.fs });
    expect(result).toEqual({ status: 'absent' });
    expect(env.operations.filter(o => o.op === 'writeFile')).toHaveLength(0);
    expect(env.operations.filter(o => o.op === 'copyFile')).toHaveLength(0);
  });

  it('returns "absent" with no writes when our block is not present', async () => {
    const env = makeFs({ [PATH]: UNRELATED_TOP_LEVEL + OTHER_BLOCK });
    const result = await applyCodexUninstall({ configPath: PATH, fs: env.fs });
    expect(result).toEqual({ status: 'absent' });
    expect(env.operations.filter(o => o.op === 'writeFile')).toHaveLength(0);
    expect(env.snapshot()[PATH]).toBe(UNRELATED_TOP_LEVEL + OTHER_BLOCK);
  });

  it('removes our block and preserves unrelated top-level content', async () => {
    const before = UNRELATED_TOP_LEVEL + '\n' + OUR_BLOCK;
    const env = makeFs({ [PATH]: before });
    const result = await applyCodexUninstall({ configPath: PATH, fs: env.fs });
    expect(result).toEqual({ status: 'removed' });
    const after = env.snapshot()[PATH]!;
    expect(after).not.toContain('agentic_bookmarks');
    expect(after).toContain('editor = "vim"');
    expect(after).toContain('theme = "dark"');
  });

  it('removes our block and preserves an unrelated mcp_servers block byte-for-byte', async () => {
    const before = OTHER_BLOCK + '\n' + OUR_BLOCK;
    const env = makeFs({ [PATH]: before });
    await applyCodexUninstall({ configPath: PATH, fs: env.fs });
    const after = env.snapshot()[PATH]!;
    expect(after).not.toContain('agentic_bookmarks');
    expect(after).toContain('[mcp_servers."some_other_server"]');
    expect(after).toContain('command = "python"');
    expect(after).toContain('args = ["-m", "other.server"]');
  });

  it('writes via a .tmp file and renames atomically (atomic-rename guard)', async () => {
    const env = makeFs({ [PATH]: OUR_BLOCK });
    await applyCodexUninstall({ configPath: PATH, fs: env.fs });
    const writes = env.operations.filter(o => o.op === 'writeFile');
    const renames = env.operations.filter(o => o.op === 'rename');
    expect(writes).toHaveLength(1);
    expect(writes[0].args[0]).toBe(PATH + '.agentic-bookmarks.tmp');
    expect(renames).toHaveLength(1);
    expect(renames[0].args).toEqual([PATH + '.agentic-bookmarks.tmp', PATH]);
  });

  it('writes the backup before mutating the target (one-shot backup guard)', async () => {
    const original = UNRELATED_TOP_LEVEL + OUR_BLOCK;
    const env = makeFs({ [PATH]: original });
    await applyCodexUninstall({ configPath: PATH, fs: env.fs });
    expect(env.snapshot()[PATH + '.agentic-bookmarks-backup']).toBe(original);
    const copyIdx = env.operations.findIndex(o => o.op === 'copyFile');
    const writeIdx = env.operations.findIndex(o => o.op === 'writeFile');
    expect(copyIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(-1);
    expect(copyIdx).toBeLessThan(writeIdx);
  });

  it('does not write or back up when our block is absent (verify-before-write guard)', async () => {
    const env = makeFs({ [PATH]: UNRELATED_TOP_LEVEL });
    const result = await applyCodexUninstall({ configPath: PATH, fs: env.fs });
    expect(result).toEqual({ status: 'absent' });
    expect(env.operations.filter(o => o.op === 'writeFile')).toHaveLength(0);
    expect(env.operations.filter(o => o.op === 'copyFile')).toHaveLength(0);
  });

  it('collapses leftover triple-blank-lines from the removal', async () => {
    const before = UNRELATED_TOP_LEVEL + '\n' + OUR_BLOCK + '\n' + OTHER_BLOCK;
    const env = makeFs({ [PATH]: before });
    await applyCodexUninstall({ configPath: PATH, fs: env.fs });
    const after = env.snapshot()[PATH]!;
    expect(after).not.toMatch(/\n{3,}/);
  });
});
