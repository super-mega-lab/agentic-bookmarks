import { describe, it, expect } from 'vitest';
import { TrialStore, type GlobalStateLike, type MirrorIO } from './trialStore';
import type { TrialRecord } from '@agentic-bookmarks/licensing';

// Legacy globalState key retained for compatibility — renaming this would
// orphan any active trial records in users' VS Code global storage.
const KEY = 'bookmarks.licensing.trial';

function fakeGlobalState(initial?: TrialRecord): GlobalStateLike {
  let v: TrialRecord | undefined = initial;
  return {
    get: <T>(key: string) => (key === KEY ? (v as unknown as T) : undefined),
    update: async (key: string, value: unknown) => {
      if (key === KEY) v = value as TrialRecord | undefined;
    },
  };
}

function fakeMirror(initial?: TrialRecord): MirrorIO & { written: TrialRecord[] } {
  let v: TrialRecord | undefined = initial;
  const written: TrialRecord[] = [];
  return {
    written,
    read: async () => v,
    write: async (r: TrialRecord) => { v = r; written.push(r); },
    clear: async () => { v = undefined; },
  };
}

const REC: TrialRecord = {
  trialStartedAt: '2026-05-01T00:00:00.000Z',
  trialMachineId: 'm-1',
  version: 1,
};

describe('TrialStore', () => {
  it('read() returns globalState when present', async () => {
    const gs = fakeGlobalState(REC);
    const store = new TrialStore(gs, fakeMirror());
    expect(await store.read()).toEqual(REC);
  });

  it('read() repopulates globalState from mirror when globalState is empty', async () => {
    const gs = fakeGlobalState();
    const store = new TrialStore(gs, fakeMirror(REC));
    expect(await store.read()).toEqual(REC);
    expect(gs.get<TrialRecord>(KEY)).toEqual(REC);
  });

  it('read() returns undefined when both empty', async () => {
    const store = new TrialStore(fakeGlobalState(), fakeMirror());
    expect(await store.read()).toBeUndefined();
  });

  it('write() updates globalState then mirror', async () => {
    const gs = fakeGlobalState();
    const mir = fakeMirror();
    const store = new TrialStore(gs, mir);
    await store.write(REC);
    expect(gs.get<TrialRecord>(KEY)).toEqual(REC);
    expect(mir.written).toEqual([REC]);
  });

  it('write() succeeds even when mirror throws (best-effort)', async () => {
    const gs = fakeGlobalState();
    const mir: MirrorIO = {
      read: async () => undefined,
      write: async () => { throw new Error('disk full'); },
      clear: async () => {},
    };
    const store = new TrialStore(gs, mir);
    await expect(store.write(REC)).resolves.toBeUndefined();
    expect(gs.get<TrialRecord>(KEY)).toEqual(REC);
  });

  it('clear() wipes both', async () => {
    const gs = fakeGlobalState(REC);
    const mir = fakeMirror(REC);
    const store = new TrialStore(gs, mir);
    await store.clear();
    expect(gs.get<TrialRecord>(KEY)).toBeUndefined();
    expect(await mir.read()).toBeUndefined();
  });

  it('clear() succeeds even when mirror throws', async () => {
    const gs = fakeGlobalState(REC);
    const mir: MirrorIO = {
      read: async () => undefined,
      write: async () => {},
      clear: async () => { throw new Error('disk gone'); },
    };
    const store = new TrialStore(gs, mir);
    await expect(store.clear()).resolves.toBeUndefined();
    expect(gs.get<TrialRecord>(KEY)).toBeUndefined();
  });
});
