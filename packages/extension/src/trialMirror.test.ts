import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createTrialMirror } from './trialMirror';
import type { TrialRecord } from '@agentic-bookmarks/licensing';

const REC: TrialRecord = {
  trialStartedAt: '2026-05-01T00:00:00.000Z',
  trialMachineId: 'm-1',
  version: 1,
};

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'trial-mirror-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('createTrialMirror', () => {
  it('write + read round-trips', async () => {
    const m = createTrialMirror(root);
    await m.write(REC);
    expect(await m.read()).toEqual(REC);
  });

  it('write creates the .bookmarks/local/license/ directory tree', async () => {
    const m = createTrialMirror(root);
    await m.write(REC);
    const expected = path.join(root, '.bookmarks', 'local', 'license', 'trial.json');
    const stat = await fs.stat(expected);
    expect(stat.isFile()).toBe(true);
  });

  it('read returns undefined when file is missing', async () => {
    const m = createTrialMirror(root);
    expect(await m.read()).toBeUndefined();
  });

  it('read returns undefined when file is malformed JSON', async () => {
    const m = createTrialMirror(root);
    const file = path.join(root, '.bookmarks', 'local', 'license', 'trial.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{not valid json', 'utf8');
    expect(await m.read()).toBeUndefined();
  });

  it('read returns undefined when shape is wrong (validation)', async () => {
    const m = createTrialMirror(root);
    const file = path.join(root, '.bookmarks', 'local', 'license', 'trial.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ version: 99, foo: 'bar' }), 'utf8');
    expect(await m.read()).toBeUndefined();
  });

  it('clear removes the file', async () => {
    const m = createTrialMirror(root);
    await m.write(REC);
    await m.clear();
    expect(await m.read()).toBeUndefined();
  });

  it('clear is idempotent — does not throw when file is missing', async () => {
    const m = createTrialMirror(root);
    await expect(m.clear()).resolves.toBeUndefined();
    await expect(m.clear()).resolves.toBeUndefined();
  });
});
