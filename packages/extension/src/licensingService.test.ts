import { describe, it, expect, vi } from 'vitest';
import { LicensingService } from './licensingService';
import type { openSourceDetection } from '@agentic-bookmarks/core';
import { BETA_CUTOFF_MS, fixedClock, type Clock, type TrialRecord } from '@agentic-bookmarks/licensing';

type WorkspaceVisibilityResult = Awaited<
  ReturnType<typeof openSourceDetection.detectWorkspaceVisibility>
>;

// Default test clock sits past the beta cutoff so cache-passthrough tests
// exercise the post-cutoff branch (visibility() returns the cached value).
// Time-bomb behavior gets its own dedicated describe block below.
const postCutoffClock = (): Clock => fixedClock(BETA_CUTOFF_MS + 86_400_000);

function make(tier?: string, vis?: string, clock: Clock = postCutoffClock()) {
  const setContextKey = vi.fn();
  const svc = new LicensingService({
    getTierSetting: () => tier,
    getVisibilitySetting: () => vis,
    setContextKey,
    getWorkspaceFolders: () => [],
    clock,
  });
  return { svc, setContextKey };
}

function makeWithDetect(opts: {
  tier?: string;
  vis?: string;
  workspaceFolders?: readonly string[];
  detectResult?: WorkspaceVisibilityResult;
  detectFn?: () => Promise<WorkspaceVisibilityResult>;
  clock?: Clock;
}) {
  const detect = opts.detectFn
    ? vi.fn(opts.detectFn)
    : vi.fn().mockResolvedValue(
        opts.detectResult ?? ({ visibility: 'public', perRoot: [] } as WorkspaceVisibilityResult),
      );
  const setContextKey = vi.fn();
  const svc = new LicensingService({
    getTierSetting: () => opts.tier,
    getVisibilitySetting: () => opts.vis,
    setContextKey,
    getWorkspaceFolders: () => opts.workspaceFolders ?? ['/repo'],
    detectWorkspaceVisibility: detect as unknown as typeof openSourceDetection.detectWorkspaceVisibility,
    clock: opts.clock ?? postCutoffClock(),
  });
  return { svc, detect, setContextKey };
}

describe('LicensingService (existing surface)', () => {
  it('status() returns free when tier setting is unset', () => {
    const { svc } = make();
    expect(svc.status()).toEqual({ tier: 'free', valid: true });
  });

  it('status() returns the configured tier', () => {
    const { svc } = make('pro');
    expect(svc.status()).toEqual({ tier: 'pro', valid: true });
  });

  it('visibility() defaults to private when visibility setting is unset (safe gating default)', () => {
    const { svc } = make();
    expect(svc.visibility()).toBe('private');
  });

  it('visibility() returns the configured override', () => {
    const { svc } = make(undefined, 'private');
    expect(svc.visibility()).toBe('private');
  });

  it('check() denies test-pro on private repo without pro tier', () => {
    const { svc } = make('free', 'private');
    expect(svc.check('test-pro')).toEqual({
      allowed: false,
      reason: 'pro-required',
      tier: 'pro',
    });
  });

  it('check() allows test-pro on public repo regardless of tier', () => {
    const { svc } = make('free', 'public');
    expect(svc.check('test-pro').allowed).toBe(true);
  });

  it('check() allows test-pro on private with pro tier', () => {
    const { svc } = make('pro', 'private');
    expect(svc.check('test-pro').allowed).toBe(true);
  });

  it('pushContext() sends tier and repoVisibility setContext calls', () => {
    const { svc, setContextKey } = make('pro', 'private');
    svc.pushContext();
    expect(setContextKey).toHaveBeenCalledWith('agenticBookmarks.tier', 'pro');
    expect(setContextKey).toHaveBeenCalledWith('agenticBookmarks.repoVisibility', 'private');
  });

  it('notifyChanged() fires onDidChange and pushes context', () => {
    const { svc, setContextKey } = make('trial', 'local');
    let fired = 0;
    svc.onDidChange(() => fired++);
    svc.notifyChanged();
    expect(fired).toBe(1);
    expect(setContextKey).toHaveBeenCalledWith('agenticBookmarks.tier', 'trial');
    expect(setContextKey).toHaveBeenCalledWith('agenticBookmarks.repoVisibility', 'local');
  });

  it('onDidChange listeners can be disposed', () => {
    const { svc } = make();
    let fired = 0;
    const sub = svc.onDidChange(() => fired++);
    svc.notifyChanged();
    sub.dispose();
    svc.notifyChanged();
    expect(fired).toBe(1);
  });
});

describe('LicensingService.detect()', () => {
  it('visibility() returns "private" before first detect when no override set', () => {
    const { svc } = makeWithDetect({});
    expect(svc.visibility()).toBe('private');
  });

  it('detect() updates cached visibility from detector result', async () => {
    const { svc } = makeWithDetect({
      detectResult: { visibility: 'public', perRoot: [] },
    });
    await svc.detect();
    expect(svc.visibility()).toBe('public');
  });

  it('detect() maps workspace "mixed" to "private"', async () => {
    const { svc } = makeWithDetect({
      detectResult: { visibility: 'mixed', perRoot: [] },
    });
    await svc.detect();
    expect(svc.visibility()).toBe('private');
  });

  it('detect() preserves "local"', async () => {
    const { svc } = makeWithDetect({
      detectResult: { visibility: 'local', perRoot: [] },
    });
    await svc.detect();
    expect(svc.visibility()).toBe('local');
  });

  it('detect() short-circuits when override is set', async () => {
    const { svc, detect } = makeWithDetect({ vis: 'public' });
    await svc.detect();
    expect(detect).not.toHaveBeenCalled();
    expect(svc.visibility()).toBe('public');
  });

  it('"auto" sentinel is treated as no override', async () => {
    const { svc, detect } = makeWithDetect({
      vis: 'auto',
      detectResult: { visibility: 'public', perRoot: [] },
    });
    await svc.detect();
    expect(detect).toHaveBeenCalled();
    expect(svc.visibility()).toBe('public');
  });

  it('arbitrary garbage value is treated as no override', async () => {
    const { svc, detect } = makeWithDetect({
      vis: 'xyzzy',
      detectResult: { visibility: 'local', perRoot: [] },
    });
    await svc.detect();
    expect(detect).toHaveBeenCalled();
    expect(svc.visibility()).toBe('local');
  });

  it('override beats cached detected value', async () => {
    const { svc } = makeWithDetect({
      detectResult: { visibility: 'public', perRoot: [] },
    });
    await svc.detect();
    expect(svc.visibility()).toBe('public');
    // Set override after detection completed
    const svc2 = new LicensingService({
      getTierSetting: () => undefined,
      getVisibilitySetting: () => 'private',
      setContextKey: vi.fn(),
      getWorkspaceFolders: () => ['/r'],
      detectWorkspaceVisibility: vi.fn().mockResolvedValue({
        visibility: 'public',
        perRoot: [],
      }) as unknown as typeof openSourceDetection.detectWorkspaceVisibility,
    });
    await svc2.detect();
    expect(svc2.visibility()).toBe('private');
  });

  it('concurrent detect() calls coalesce into one detection', async () => {
    let resolveDetect: (v: WorkspaceVisibilityResult) => void;
    const detectFn = () => new Promise<WorkspaceVisibilityResult>((res) => {
      resolveDetect = res;
    });
    const { svc, detect } = makeWithDetect({ detectFn });
    const p1 = svc.detect();
    const p2 = svc.detect();
    const p3 = svc.detect();
    expect(detect).toHaveBeenCalledTimes(1);
    resolveDetect!({ visibility: 'public', perRoot: [] });
    await Promise.all([p1, p2, p3]);
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('detect() fires onDidChange after the cached value updates', async () => {
    const { svc } = makeWithDetect({
      detectResult: { visibility: 'public', perRoot: [] },
    });
    let fired = 0;
    svc.onDidChange(() => fired++);
    await svc.detect();
    expect(fired).toBe(1);
  });

  it('detect(force=true) re-runs after a previous detect completed', async () => {
    const { svc, detect } = makeWithDetect({});
    await svc.detect();
    await svc.detect(true);
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('detect() passes current workspace folders to the detector', async () => {
    const { svc, detect } = makeWithDetect({
      workspaceFolders: ['/a', '/b'],
    });
    await svc.detect();
    expect(detect).toHaveBeenCalledWith(['/a', '/b'], expect.any(Object));
  });

  it('detect() with no workspace folders still calls the detector with []', async () => {
    const { svc, detect } = makeWithDetect({
      workspaceFolders: [],
      detectResult: { visibility: 'local', perRoot: [] },
    });
    await svc.detect();
    expect(detect).toHaveBeenCalledWith([], expect.any(Object));
    expect(svc.visibility()).toBe('local');
  });

  it('detect() returns the raw detector result', async () => {
    const detectResult = {
      visibility: 'public' as const,
      perRoot: [
        {
          visibility: 'public' as const,
          remotes: [],
          graceFallback: false,
          remotesHash: 'h',
          workspaceRoot: '/repo',
        },
      ],
    };
    const { svc } = makeWithDetect({ detectResult });
    const result = await svc.detect();
    expect(result).toEqual(detectResult);
  });

  it('detect() returns null when override is set', async () => {
    const { svc } = makeWithDetect({ vis: 'public' });
    const result = await svc.detect();
    expect(result).toBeNull();
  });

  it('getLastDetection() returns the last raw result', async () => {
    const detectResult = { visibility: 'private' as const, perRoot: [] };
    const { svc } = makeWithDetect({ detectResult });
    expect(svc.getLastDetection()).toBeNull();
    await svc.detect();
    expect(svc.getLastDetection()).toEqual(detectResult);
  });

  it('getOverride() reflects the testVisibility setting', () => {
    const { svc } = makeWithDetect({ vis: 'private' });
    expect(svc.getOverride()).toBe('private');
    const { svc: svc2 } = makeWithDetect({});
    expect(svc2.getOverride()).toBeNull();
  });
});

describe('LicensingService trial wiring (SML-1333)', () => {
  const T0 = Date.parse('2026-05-01T00:00:00Z');
  const DAY = 86_400_000;

  function makeT(opts: {
    now?: number;
    existing?: TrialRecord;
    tier?: string;
    vis?: string;
  }) {
    const setContextKey = vi.fn();
    let stored = opts.existing;
    const writes: TrialRecord[] = [];
    const svc = new LicensingService({
      getTierSetting: () => opts.tier,
      getVisibilitySetting: () => opts.vis ?? 'private',
      setContextKey,
      getWorkspaceFolders: () => [],
      readTrialRecord: async () => stored,
      writeTrialRecord: async (r) => { stored = r; writes.push(r); },
      clearTrialRecord: async () => { stored = undefined; },
      machineId: 'm-test',
      clock: { now: () => opts.now ?? T0 },
    });
    return { svc, setContextKey, writes, get stored() { return stored; } };
  }

  it('status() is free before hydrate when no override is set', () => {
    const { svc } = makeT({});
    expect(svc.status()).toEqual({ tier: 'free', valid: true });
  });

  it('hydrate() loads the persisted record into the cache', async () => {
    const existing: TrialRecord = {
      trialStartedAt: new Date(T0).toISOString(),
      trialMachineId: 'm-prev',
      version: 1,
    };
    const t = makeT({ now: T0 + 5 * DAY, existing });
    expect(t.svc.getTrialRecord()).toBeUndefined();
    await t.svc.hydrate();
    expect(t.svc.getTrialRecord()).toEqual(existing);
  });

  it('startTrial() mints, persists, and reports tier=trial with expiresAt', async () => {
    const t = makeT({ now: T0 });
    await t.svc.hydrate();
    const record = await t.svc.startTrial();
    expect(record.trialMachineId).toBe('m-test');
    expect(record.trialStartedAt).toBe(new Date(T0).toISOString());
    expect(t.writes).toHaveLength(1);
    const status = t.svc.status();
    expect(status.tier).toBe('trial');
    expect(status.expiresAt).toBe(new Date(T0 + 14 * DAY).toISOString());
  });

  it('startTrial() is idempotent — second call returns the same record', async () => {
    const t = makeT({ now: T0 });
    await t.svc.hydrate();
    const r1 = await t.svc.startTrial();
    const r2 = await t.svc.startTrial();
    expect(r2).toBe(r1);
    expect(t.writes).toHaveLength(1);
  });

  it('startTrial() fires onDidChange exactly once on first start', async () => {
    const t = makeT({ now: T0 });
    let fired = 0;
    t.svc.onDidChange(() => fired++);
    await t.svc.hydrate();
    await t.svc.startTrial();
    expect(fired).toBe(1);
    await t.svc.startTrial();
    expect(fired).toBe(1);
  });

  it('expires after 14 days — status flips back to free', async () => {
    const existing: TrialRecord = {
      trialStartedAt: new Date(T0).toISOString(),
      trialMachineId: 'm',
      version: 1,
    };
    const t = makeT({ now: T0 + 15 * DAY, existing });
    await t.svc.hydrate();
    expect(t.svc.status().tier).toBe('free');
  });

  it('testTier override beats trial computation', async () => {
    const existing: TrialRecord = {
      trialStartedAt: new Date(T0).toISOString(),
      trialMachineId: 'm',
      version: 1,
    };
    const t = makeT({ now: T0 + 5 * DAY, existing, tier: 'pro' });
    await t.svc.hydrate();
    expect(t.svc.status()).toEqual({ tier: 'pro', valid: true });
  });

  it('resetTrial() clears the cache and persistence', async () => {
    const existing: TrialRecord = {
      trialStartedAt: new Date(T0).toISOString(),
      trialMachineId: 'm',
      version: 1,
    };
    const t = makeT({ now: T0 + 5 * DAY, existing });
    await t.svc.hydrate();
    expect(t.svc.status().tier).toBe('trial');
    await t.svc.resetTrial();
    expect(t.svc.getTrialRecord()).toBeUndefined();
    expect(t.stored).toBeUndefined();
    expect(t.svc.status().tier).toBe('free');
  });

  it('setTrialRecordForTesting() replaces the record and fires change', async () => {
    const t = makeT({ now: T0 });
    let fired = 0;
    t.svc.onDidChange(() => fired++);
    const synthetic: TrialRecord = {
      trialStartedAt: new Date(T0 - 5 * DAY).toISOString(),
      trialMachineId: 'simulated',
      version: 1,
    };
    await t.svc.setTrialRecordForTesting(synthetic);
    expect(t.svc.getTrialRecord()).toEqual(synthetic);
    expect(t.svc.status().tier).toBe('trial');
    expect(fired).toBe(1);
  });

  it('setTrialRecordForTesting(undefined) clears state', async () => {
    const t = makeT({
      now: T0,
      existing: {
        trialStartedAt: new Date(T0).toISOString(),
        trialMachineId: 'm',
        version: 1,
      },
    });
    await t.svc.hydrate();
    await t.svc.setTrialRecordForTesting(undefined);
    expect(t.svc.getTrialRecord()).toBeUndefined();
    expect(t.stored).toBeUndefined();
  });
});

describe('LicensingService public-beta time-bomb (SML-1375)', () => {
  const preCutoff = fixedClock(BETA_CUTOFF_MS - 1);

  it('visibility() returns "public" pre-cutoff for the default private cache (covers the activation window before first detect)', () => {
    const { svc } = makeWithDetect({ clock: preCutoff });
    expect(svc.visibility()).toBe('public');
  });

  it('visibility() returns "public" pre-cutoff after detect() resolves private', async () => {
    const { svc } = makeWithDetect({
      detectResult: { visibility: 'private', perRoot: [] },
      clock: preCutoff,
    });
    await svc.detect();
    expect(svc.visibility()).toBe('public');
  });

  it('visibility() returns "public" pre-cutoff after detect() resolves local', async () => {
    const { svc } = makeWithDetect({
      detectResult: { visibility: 'local', perRoot: [] },
      clock: preCutoff,
    });
    await svc.detect();
    expect(svc.visibility()).toBe('public');
  });

  it('testVisibility override wins over the time-bomb pre-cutoff', () => {
    const { svc } = makeWithDetect({ vis: 'private', clock: preCutoff });
    expect(svc.visibility()).toBe('private');
  });

  it('post-cutoff returns the cached detected value (time-bomb disarmed)', async () => {
    const { svc } = makeWithDetect({
      detectResult: { visibility: 'private', perRoot: [] },
      clock: fixedClock(BETA_CUTOFF_MS + 1),
    });
    await svc.detect();
    expect(svc.visibility()).toBe('private');
  });

  it('pushContext() pre-cutoff pushes repoVisibility="public" even with private cache', () => {
    const { svc, setContextKey } = makeWithDetect({ clock: preCutoff });
    svc.pushContext();
    expect(setContextKey).toHaveBeenCalledWith('agenticBookmarks.repoVisibility', 'public');
  });
});
