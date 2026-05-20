// ABOUTME: Tests for the phased ScanQueue — disk classify, optional auto-repair
// ABOUTME: finalize, and disk reconcile — all side effects injected as fakes.
import { describe, it, expect, vi } from 'vitest';
import { ScanQueue, type ScanTarget } from './scanQueue';
import type { ScanResultEntry } from './scanValidate';

const T = (fsPath: string, uri: string): ScanTarget => ({ fsPath, uri });
const broken = (bookmarkId: string, uri: string): ScanResultEntry =>
  ({ bookmarkId, uri, status: 'broken', errorCode: 'not_found', errorDetails: null, score: null });
const valid = (bookmarkId: string, uri: string): ScanResultEntry =>
  ({ bookmarkId, uri, status: 'valid', errorCode: null, errorDetails: null, score: null });

function deps(over: Partial<ConstructorParameters<typeof ScanQueue>[0]> = {}) {
  const writes: Array<{ uris: string[]; entries: ScanResultEntry[] }> = [];
  const base = {
    validateFile: vi.fn(async (t: ScanTarget) => ({ missing: false, entries: [valid('b', t.uri)] })),
    writeAuthoritativeCache: vi.fn(async (uris: Set<string>, entries: ScanResultEntry[]) => {
      writes.push({ uris: [...uris], entries });
    }),
    markValidated: vi.fn(),
    autoRepairEnabled: vi.fn(() => false),
    triggerRepair: vi.fn(async () => {}),
    isRepairIdle: vi.fn(() => true),
    onPhaseChange: vi.fn(),
    delay: vi.fn(async () => {}),
    log: vi.fn(),
    batchSize: 5,
    sleepMs: 200,
  };
  return { d: { ...base, ...over }, writes };
}

describe('ScanQueue (phased)', () => {
  it('phase 1: validates every target, marks validated, writes authoritative cache', async () => {
    const { d, writes } = deps();
    const q = new ScanQueue(d);
    await q.run([T('/ws/a.ts', 'a.ts'), T('/ws/b.ts', 'b.ts')]);
    expect(d.validateFile).toHaveBeenCalledTimes(2);
    expect(d.markValidated).toHaveBeenCalledWith('/ws/a.ts');
    expect(d.markValidated).toHaveBeenCalledWith('/ws/b.ts');
    expect(writes[0].uris.sort()).toEqual(['a.ts', 'b.ts']);
    expect(q.phase()).toBe('idle');
  });

  it('reports scanning progress then returns to idle', async () => {
    const { d } = deps();
    const q = new ScanQueue(d);
    const p = q.run([T('/ws/a.ts', 'a.ts')]);
    expect(q.isRunning()).toBe(true);
    expect(q.phase()).toBe('scanning');
    await p;
    expect(q.phase()).toBe('idle');
    expect(q.isRunning()).toBe(false);
    expect(q.scannedThisRun()).toBe(1);
    expect(q.totalThisRun()).toBe(1);
  });

  it('does NOT finalize when autoRepair is disabled', async () => {
    const { d } = deps({
      validateFile: vi.fn(async (t: ScanTarget) => ({ missing: false, entries: [broken('b', t.uri)] })),
      autoRepairEnabled: vi.fn(() => false),
    });
    const q = new ScanQueue(d);
    await q.run([T('/ws/a.ts', 'a.ts')]);
    expect(d.triggerRepair).not.toHaveBeenCalled();
  });

  it('finalizes when autoRepair on and broken anchors exist: triggers repair, waits idle, reconciles', async () => {
    const phases: string[] = [];
    const validateFile = vi.fn(async (t: ScanTarget) => ({ missing: false, entries: [broken('b', t.uri)] }));
    const { d, writes } = deps({
      validateFile,
      autoRepairEnabled: vi.fn(() => true),
      onPhaseChange: vi.fn((phase: string) => { phases.push(phase); }),
    });
    const q = new ScanQueue(d);
    await q.run([T('/ws/a.ts', 'a.ts')]);
    expect(d.triggerRepair).toHaveBeenCalledWith(T('/ws/a.ts', 'a.ts'));
    expect(phases).toContain('finalizing');
    // validateFile called in phase 1 AND phase 3 (reconcile) for the broken file.
    expect(validateFile).toHaveBeenCalledTimes(2);
    // two authoritative writes: phase-1 and reconcile.
    expect(writes.length).toBe(2);
  });

  it('does not attempt repair on missing files', async () => {
    const { d } = deps({
      validateFile: vi.fn(async (t: ScanTarget) => ({
        missing: true,
        entries: [broken('b', t.uri)],
      })),
      autoRepairEnabled: vi.fn(() => true),
    });
    const q = new ScanQueue(d);
    await q.run([T('/ws/gone.ts', 'gone.ts')]);
    expect(d.triggerRepair).not.toHaveBeenCalled();
  });

  it('waits for the repair queue to become idle before reconciling', async () => {
    let idle = false;
    const { d } = deps({
      validateFile: vi.fn(async (t: ScanTarget) => ({ missing: false, entries: [broken('b', t.uri)] })),
      autoRepairEnabled: vi.fn(() => true),
      isRepairIdle: vi.fn(() => idle),
      delay: vi.fn(async () => { idle = true; }),
    });
    const q = new ScanQueue(d);
    await q.run([T('/ws/a.ts', 'a.ts')]);
    expect(d.isRepairIdle).toHaveBeenCalled();
  });

  it('cancel during phase 1 stops further validation', async () => {
    let q: ScanQueue;
    const validateFile = vi.fn(async (t: ScanTarget) => {
      if (t.fsPath === '/ws/b.ts') q.cancel();
      return { missing: false, entries: [valid('b', t.uri)] };
    });
    const { d } = deps({ validateFile });
    q = new ScanQueue(d);
    await q.run([T('/ws/a.ts', 'a.ts'), T('/ws/b.ts', 'b.ts'), T('/ws/c.ts', 'c.ts')]);
    expect(validateFile).toHaveBeenCalledTimes(2);
  });

  it('ignores a second run() while already running', async () => {
    const { d } = deps();
    const q = new ScanQueue(d);
    const p1 = q.run([T('/ws/a.ts', 'a.ts')]);
    await q.run([T('/ws/b.ts', 'b.ts')]); // should no-op
    await p1;
    expect(d.validateFile).toHaveBeenCalledTimes(1);
  });
});
