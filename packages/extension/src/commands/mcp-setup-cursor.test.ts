// ABOUTME: Tests for the Cursor mcp.json install path (SML-1518 / F-007).
// ABOUTME: Verifies the install mirrors the uninstall guards: refuse-on-malformed
// ABOUTME: (never clobber), ENOENT-creates, one-shot backup, atomic rename, legacy
// ABOUTME: strip, and surgical preservation of sibling servers / top-level keys.

import { describe, it, expect } from 'vitest';
import { applyCursorInstall } from './mcp-setup-helpers';
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

const PATH = '/home/u/.cursor/mcp.json';
const ENTRY = { type: 'stdio', command: 'node', args: ['/x/server.js'], env: { BOOKMARKS_DIR: '' } };

describe('applyCursorInstall', () => {
  it('creates a fresh config (no backup) when the file is missing', async () => {
    const env = makeFs();
    const result = await applyCursorInstall({ configPath: PATH, serverEntry: ENTRY, fs: env.fs });
    expect(result).toEqual({ status: 'written' });
    // No backup when there was nothing to back up.
    expect(env.operations.filter(o => o.op === 'copyFile')).toHaveLength(0);
    const after = JSON.parse(env.snapshot()[PATH]!);
    expect(after.mcpServers.agentic_bookmarks).toEqual(ENTRY);
  });

  it('refuses to write and reports "malformed" when the existing file is not valid JSON', async () => {
    const malformed = '{ "mcpServers": { "other": { "command": "x" }, } '; // trailing comma + unclosed
    const env = makeFs({ [PATH]: malformed });
    const result = await applyCursorInstall({ configPath: PATH, serverEntry: ENTRY, fs: env.fs });
    expect(result).toEqual({ status: 'malformed' });
    // The catastrophic bug: must NOT overwrite, must NOT back up over a file we won't touch.
    expect(env.operations.filter(o => o.op === 'writeFile')).toHaveLength(0);
    expect(env.operations.filter(o => o.op === 'rename')).toHaveLength(0);
    expect(env.snapshot()[PATH]).toBe(malformed);
  });

  it('refuses to write when the parsed JSON is not an object (array/scalar)', async () => {
    const env = makeFs({ [PATH]: '[1, 2, 3]' });
    const result = await applyCursorInstall({ configPath: PATH, serverEntry: ENTRY, fs: env.fs });
    expect(result).toEqual({ status: 'malformed' });
    expect(env.operations.filter(o => o.op === 'writeFile')).toHaveLength(0);
    expect(env.snapshot()[PATH]).toBe('[1, 2, 3]');
  });

  it('merges into an existing valid config, preserving other servers and top-level keys', async () => {
    const before = {
      mcpServers: { other: { type: 'stdio', command: 'other-cmd' } },
      somethingElse: { not: 'related' },
    };
    const env = makeFs({ [PATH]: JSON.stringify(before, null, 2) });
    const result = await applyCursorInstall({ configPath: PATH, serverEntry: ENTRY, fs: env.fs });
    expect(result).toEqual({ status: 'written' });
    const after = JSON.parse(env.snapshot()[PATH]!);
    expect(after.mcpServers.other).toEqual({ type: 'stdio', command: 'other-cmd' });
    expect(after.mcpServers.agentic_bookmarks).toEqual(ENTRY);
    expect(after.somethingElse).toEqual({ not: 'related' });
  });

  it('writes via a .tmp file and renames atomically (atomic-rename guard)', async () => {
    const env = makeFs({ [PATH]: JSON.stringify({ mcpServers: {} }, null, 2) });
    await applyCursorInstall({ configPath: PATH, serverEntry: ENTRY, fs: env.fs });
    const writes = env.operations.filter(o => o.op === 'writeFile');
    const renames = env.operations.filter(o => o.op === 'rename');
    expect(writes).toHaveLength(1);
    expect(writes[0].args[0]).toBe(PATH + '.agentic-bookmarks.tmp');
    expect(renames).toHaveLength(1);
    expect(renames[0].args).toEqual([PATH + '.agentic-bookmarks.tmp', PATH]);
  });

  it('backs up the original before mutating it (one-shot backup guard)', async () => {
    const original = JSON.stringify({ mcpServers: { other: { command: 'x' } } }, null, 2);
    const env = makeFs({ [PATH]: original });
    await applyCursorInstall({ configPath: PATH, serverEntry: ENTRY, fs: env.fs });
    expect(env.snapshot()[PATH + '.agentic-bookmarks-backup']).toBe(original);
    const copyIdx = env.operations.findIndex(o => o.op === 'copyFile');
    const writeIdx = env.operations.findIndex(o => o.op === 'writeFile');
    expect(copyIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(-1);
    expect(copyIdx).toBeLessThan(writeIdx);
  });

  it('drops legacy server keys while installing', async () => {
    const before = {
      mcpServers: {
        'mcp.bookmarks': { command: 'old' },
        'mcp_bookmarks': { command: 'old2' },
        keep: { command: 'keep-me' },
      },
    };
    const env = makeFs({ [PATH]: JSON.stringify(before, null, 2) });
    await applyCursorInstall({ configPath: PATH, serverEntry: ENTRY, fs: env.fs });
    const after = JSON.parse(env.snapshot()[PATH]!);
    expect(after.mcpServers['mcp.bookmarks']).toBeUndefined();
    expect(after.mcpServers['mcp_bookmarks']).toBeUndefined();
    expect(after.mcpServers.keep).toEqual({ command: 'keep-me' });
    expect(after.mcpServers.agentic_bookmarks).toEqual(ENTRY);
  });

  it('overwrites a stale agentic_bookmarks entry (re-install / update path)', async () => {
    const before = { mcpServers: { agentic_bookmarks: { type: 'stdio', command: 'node', args: ['/old.js'] } } };
    const env = makeFs({ [PATH]: JSON.stringify(before, null, 2) });
    await applyCursorInstall({ configPath: PATH, serverEntry: ENTRY, fs: env.fs });
    const after = JSON.parse(env.snapshot()[PATH]!);
    expect(after.mcpServers.agentic_bookmarks).toEqual(ENTRY);
  });
});
