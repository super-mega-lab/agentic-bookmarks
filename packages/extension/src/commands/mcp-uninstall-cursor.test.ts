// ABOUTME: Tests for the Cursor mcp.json uninstall path.
// ABOUTME: Verifies the 5 safety guards: verify-before-write, refuse-on-malformed,
// ABOUTME: atomic rename, one-shot backup, surgical preservation of siblings.

import { describe, it, expect } from 'vitest';
import { applyCursorUninstall, type FsDeps } from './mcp-uninstall-helpers';

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

const PATH = '/home/u/.cursor/mcp.json';

describe('applyCursorUninstall', () => {
  it('returns "absent" with no writes when the file is missing', async () => {
    const env = makeFs();
    const result = await applyCursorUninstall({ configPath: PATH, fs: env.fs });
    expect(result).toEqual({ status: 'absent' });
    expect(env.operations.filter(o => o.op === 'writeFile')).toHaveLength(0);
    expect(env.operations.filter(o => o.op === 'copyFile')).toHaveLength(0);
  });

  it('returns "absent" with no writes when the agentic_bookmarks entry is not present', async () => {
    const env = makeFs({
      [PATH]: JSON.stringify({ mcpServers: { other: { command: 'x' } } }, null, 2),
    });
    const result = await applyCursorUninstall({ configPath: PATH, fs: env.fs });
    expect(result).toEqual({ status: 'absent' });
    expect(env.operations.filter(o => o.op === 'writeFile')).toHaveLength(0);
    expect(env.operations.filter(o => o.op === 'copyFile')).toHaveLength(0);
    // File unchanged
    const parsed = JSON.parse(env.snapshot()[PATH]!);
    expect(parsed.mcpServers.other).toBeDefined();
  });

  it('returns "absent" when mcpServers itself is missing', async () => {
    const env = makeFs({ [PATH]: JSON.stringify({ otherTopLevel: true }, null, 2) });
    const result = await applyCursorUninstall({ configPath: PATH, fs: env.fs });
    expect(result).toEqual({ status: 'absent' });
    expect(env.operations.filter(o => o.op === 'writeFile')).toHaveLength(0);
  });

  it('returns "malformed" without writes when the file is not valid JSON', async () => {
    const env = makeFs({ [PATH]: 'this is not JSON {' });
    const result = await applyCursorUninstall({ configPath: PATH, fs: env.fs });
    expect(result).toEqual({ status: 'malformed' });
    expect(env.operations.filter(o => o.op === 'writeFile')).toHaveLength(0);
    expect(env.operations.filter(o => o.op === 'copyFile')).toHaveLength(0);
    expect(env.snapshot()[PATH]).toBe('this is not JSON {');
  });

  it('removes the agentic_bookmarks key and preserves siblings', async () => {
    const before = {
      mcpServers: {
        agentic_bookmarks: { type: 'stdio', command: 'node', args: ['/x/server.js'] },
        other: { type: 'stdio', command: 'other-cmd' },
      },
      somethingElse: { not: 'related' },
    };
    const env = makeFs({ [PATH]: JSON.stringify(before, null, 2) });
    const result = await applyCursorUninstall({ configPath: PATH, fs: env.fs });
    expect(result).toEqual({ status: 'removed' });
    const after = JSON.parse(env.snapshot()[PATH]!);
    expect(after.mcpServers.agentic_bookmarks).toBeUndefined();
    expect(after.mcpServers.other).toEqual({ type: 'stdio', command: 'other-cmd' });
    expect(after.somethingElse).toEqual({ not: 'related' });
  });

  it('writes via a .tmp file and renames atomically (atomic-rename guard)', async () => {
    const env = makeFs({
      [PATH]: JSON.stringify({ mcpServers: { agentic_bookmarks: {} } }, null, 2),
    });
    await applyCursorUninstall({ configPath: PATH, fs: env.fs });
    const writes = env.operations.filter(o => o.op === 'writeFile');
    const renames = env.operations.filter(o => o.op === 'rename');
    expect(writes).toHaveLength(1);
    expect(writes[0].args[0]).toBe(PATH + '.agentic-bookmarks.tmp');
    expect(renames).toHaveLength(1);
    expect(renames[0].args).toEqual([PATH + '.agentic-bookmarks.tmp', PATH]);
  });

  it('writes the backup before mutating the target (one-shot backup guard)', async () => {
    const original = JSON.stringify({ mcpServers: { agentic_bookmarks: { v: 1 } } }, null, 2);
    const env = makeFs({ [PATH]: original });
    await applyCursorUninstall({ configPath: PATH, fs: env.fs });
    expect(env.snapshot()[PATH + '.agentic-bookmarks-backup']).toBe(original);
    // Backup must precede write in operation order
    const copyIdx = env.operations.findIndex(o => o.op === 'copyFile');
    const writeIdx = env.operations.findIndex(o => o.op === 'writeFile');
    expect(copyIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(-1);
    expect(copyIdx).toBeLessThan(writeIdx);
  });

  it('leaves mcpServers as an empty object when our entry was the only one (surgical guard)', async () => {
    const env = makeFs({
      [PATH]: JSON.stringify({ mcpServers: { agentic_bookmarks: { x: 1 } } }, null, 2),
    });
    await applyCursorUninstall({ configPath: PATH, fs: env.fs });
    const after = JSON.parse(env.snapshot()[PATH]!);
    expect(after.mcpServers).toEqual({});
  });

  it('does not write or back up when the entry is absent (verify-before-write guard)', async () => {
    const env = makeFs({
      [PATH]: JSON.stringify({ mcpServers: {} }, null, 2),
    });
    const result = await applyCursorUninstall({ configPath: PATH, fs: env.fs });
    expect(result).toEqual({ status: 'absent' });
    expect(env.operations.filter(o => o.op === 'writeFile')).toHaveLength(0);
    expect(env.operations.filter(o => o.op === 'copyFile')).toHaveLength(0);
  });
});
