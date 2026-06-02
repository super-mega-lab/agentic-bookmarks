// ABOUTME: Tests for the pure Claude install-verification logic (reconcile ~/.claude.json).
// ABOUTME: Injected fakes for config reads and sleep — no real fs or timers.

import { describe, it, expect } from 'vitest';
import {
  evaluateClaudeInstall,
  verifyClaudeInstall,
  readClaudeConfig,
  CLAUDE_SERVER_ID,
  type ClaudeConfigReadResult,
} from './mcp-claude-verify';

const PROJECT = '/home/u/project';

describe('evaluateClaudeInstall', () => {
  it('returns "confirmed" for a user-scope entry that is present', () => {
    const read: ClaudeConfigReadResult = {
      config: { mcpServers: { [CLAUDE_SERVER_ID]: { command: 'node' } } },
    };
    expect(evaluateClaudeInstall(read, 'user', PROJECT)).toBe('confirmed');
  });

  it('returns "absent" for user scope when mcpServers exists without our id', () => {
    const read: ClaudeConfigReadResult = {
      config: { mcpServers: { other: { command: 'x' } } },
    };
    expect(evaluateClaudeInstall(read, 'user', PROJECT)).toBe('absent');
  });

  it('returns "absent" for user scope when there is no mcpServers', () => {
    const read: ClaudeConfigReadResult = { config: { somethingElse: true } };
    expect(evaluateClaudeInstall(read, 'user', PROJECT)).toBe('absent');
  });

  it('returns "confirmed" for a local-scope entry under projects[path].mcpServers', () => {
    const read: ClaudeConfigReadResult = {
      config: {
        projects: { [PROJECT]: { mcpServers: { [CLAUDE_SERVER_ID]: { command: 'node' } } } },
      },
    };
    expect(evaluateClaudeInstall(read, 'local', PROJECT)).toBe('confirmed');
  });

  it('returns "absent" for local scope when the project exists but has no mcpServers', () => {
    const read: ClaudeConfigReadResult = {
      config: { projects: { [PROJECT]: { allowedTools: [] } } },
    };
    expect(evaluateClaudeInstall(read, 'local', PROJECT)).toBe('absent');
  });

  it('returns "absent" for local scope when the entry is under a different project path (project isolation)', () => {
    const read: ClaudeConfigReadResult = {
      config: {
        projects: { '/some/other/project': { mcpServers: { [CLAUDE_SERVER_ID]: { command: 'node' } } } },
      },
    };
    expect(evaluateClaudeInstall(read, 'local', PROJECT)).toBe('absent');
  });

  it('returns "absent" when the config is null (file missing / ENOENT)', () => {
    expect(evaluateClaudeInstall({ config: null }, 'user', PROJECT)).toBe('absent');
  });

  it('returns "inconclusive" when the config is unreadable', () => {
    expect(evaluateClaudeInstall({ config: null, unreadable: true }, 'user', PROJECT)).toBe('inconclusive');
  });

  it('returns "absent" when the config is not an object (e.g. an array)', () => {
    expect(evaluateClaudeInstall({ config: [] }, 'user', PROJECT)).toBe('absent');
  });

  it('honors a custom serverId', () => {
    const read: ClaudeConfigReadResult = {
      config: { mcpServers: { custom_server: { command: 'node' } } },
    };
    expect(evaluateClaudeInstall(read, 'user', PROJECT, 'custom_server')).toBe('confirmed');
    expect(evaluateClaudeInstall(read, 'user', PROJECT)).toBe('absent');
  });
});

/** Build a fake readConfig that returns scripted results in order; last result repeats. */
function scriptedReadConfig(results: ClaudeConfigReadResult[]) {
  let i = 0;
  const calls = { count: 0 };
  const readConfig = async (): Promise<ClaudeConfigReadResult> => {
    calls.count++;
    const r = results[Math.min(i, results.length - 1)];
    i++;
    return r;
  };
  return { readConfig, calls };
}

/** Fake sleep that records each delay and resolves immediately. */
function recordingSleep() {
  const delays: number[] = [];
  const sleep = async (ms: number) => { delays.push(ms); };
  return { sleep, delays };
}

const CONFIRMED: ClaudeConfigReadResult = {
  config: { mcpServers: { [CLAUDE_SERVER_ID]: { command: 'node' } } },
};
const ABSENT: ClaudeConfigReadResult = { config: { mcpServers: {} } };
const INCONCLUSIVE: ClaudeConfigReadResult = { config: null, unreadable: true };

describe('verifyClaudeInstall', () => {
  it('returns "confirmed" on the first read and never sleeps', async () => {
    const { readConfig, calls } = scriptedReadConfig([CONFIRMED]);
    const { sleep, delays } = recordingSleep();
    const verdict = await verifyClaudeInstall({ readConfig, sleep, scope: 'user', projectPath: PROJECT });
    expect(verdict).toBe('confirmed');
    expect(calls.count).toBe(1);
    expect(delays).toHaveLength(0);
  });

  it('returns "confirmed" after an absent read, sleeping exactly once', async () => {
    const { readConfig, calls } = scriptedReadConfig([ABSENT, CONFIRMED]);
    const { sleep, delays } = recordingSleep();
    const verdict = await verifyClaudeInstall({ readConfig, sleep, scope: 'user', projectPath: PROJECT });
    expect(verdict).toBe('confirmed');
    expect(calls.count).toBe(2);
    expect(delays).toHaveLength(1);
  });

  it('returns "absent" after exhausting attempts, with attempts-1 sleeps', async () => {
    const { readConfig, calls } = scriptedReadConfig([ABSENT]);
    const { sleep, delays } = recordingSleep();
    const verdict = await verifyClaudeInstall({
      readConfig, sleep, scope: 'user', projectPath: PROJECT, attempts: 3,
    });
    expect(verdict).toBe('absent');
    expect(calls.count).toBe(3);
    expect(delays).toHaveLength(2);
  });

  it('returns "inconclusive" when every read is inconclusive', async () => {
    const { readConfig } = scriptedReadConfig([INCONCLUSIVE]);
    const { sleep } = recordingSleep();
    const verdict = await verifyClaudeInstall({
      readConfig, sleep, scope: 'user', projectPath: PROJECT, attempts: 3,
    });
    expect(verdict).toBe('inconclusive');
  });

  it('honors a custom attempts/delayMs (sleeps with the given delay)', async () => {
    const { readConfig, calls } = scriptedReadConfig([ABSENT]);
    const { sleep, delays } = recordingSleep();
    const verdict = await verifyClaudeInstall({
      readConfig, sleep, scope: 'user', projectPath: PROJECT, attempts: 2, delayMs: 42,
    });
    expect(verdict).toBe('absent');
    expect(calls.count).toBe(2);
    expect(delays).toEqual([42]);
  });
});

describe('readClaudeConfig', () => {
  it('parses a valid JSON config', async () => {
    const readFile = async () => JSON.stringify({ mcpServers: { x: 1 } });
    expect(await readClaudeConfig(readFile, '/home/u')).toEqual({
      config: { mcpServers: { x: 1 } },
    });
  });

  it('returns { config: null } when the file is missing (ENOENT)', async () => {
    const readFile = async () => {
      const err = new Error('ENOENT') as Error & { code: string };
      err.code = 'ENOENT';
      throw err;
    };
    expect(await readClaudeConfig(readFile, '/home/u')).toEqual({ config: null });
  });

  it('returns { unreadable: true } on a non-ENOENT read error (EACCES)', async () => {
    const readFile = async () => {
      const err = new Error('EACCES') as Error & { code: string };
      err.code = 'EACCES';
      throw err;
    };
    expect(await readClaudeConfig(readFile, '/home/u')).toEqual({ unreadable: true });
  });

  it('returns { unreadable: true } when the JSON is corrupt', async () => {
    const readFile = async () => 'this is not json {';
    expect(await readClaudeConfig(readFile, '/home/u')).toEqual({ unreadable: true });
  });
});
