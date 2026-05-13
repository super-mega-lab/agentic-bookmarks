import { describe, it, expect } from 'vitest';
import { fixedClock } from './clock';
import {
  TRIAL_DURATION_MS,
  evaluateTrial,
  startTrial,
} from './trial-timer';
import type { TrialRecord } from './types';

const T0 = Date.parse('2026-05-01T00:00:00Z');
const DAY = 86_400_000;

describe('TRIAL_DURATION_MS', () => {
  it('is exactly 14 days', () => {
    expect(TRIAL_DURATION_MS).toBe(14 * DAY);
  });
});

describe('startTrial', () => {
  it('mints a record at clock.now() with the supplied machineId', () => {
    const clock = fixedClock(T0);
    const record = startTrial({ existing: undefined, clock, machineId: 'm-1' });
    expect(record).toEqual({
      trialStartedAt: new Date(T0).toISOString(),
      trialMachineId: 'm-1',
      version: 1,
    });
  });

  it('is idempotent: returns existing record unchanged when one is present (active or expired)', () => {
    const clock = fixedClock(T0 + 30 * DAY);
    const existing: TrialRecord = {
      trialStartedAt: new Date(T0).toISOString(),
      trialMachineId: 'm-old',
      version: 1,
    };
    const result = startTrial({ existing, clock, machineId: 'm-new' });
    expect(result).toBe(existing);
  });
});

describe('evaluateTrial', () => {
  it('returns inactive when no record', () => {
    expect(evaluateTrial(undefined, fixedClock(T0))).toEqual({ active: false });
  });

  it('reports active with daysLeft within the 14-day window', () => {
    const record: TrialRecord = {
      trialStartedAt: new Date(T0).toISOString(),
      trialMachineId: 'm-1',
      version: 1,
    };
    const status = evaluateTrial(record, fixedClock(T0 + 5 * DAY));
    expect(status.active).toBe(true);
    expect(status.daysLeft).toBe(9);
    expect(status.expiresAt).toBe(new Date(T0 + 14 * DAY).toISOString());
    expect(status.startedAt).toBe(new Date(T0).toISOString());
  });

  it('rounds up — never shows 0 days while still active', () => {
    const record: TrialRecord = {
      trialStartedAt: new Date(T0).toISOString(),
      trialMachineId: 'm-1',
      version: 1,
    };
    const status = evaluateTrial(record, fixedClock(T0 + 13 * DAY + 23 * 3_600_000));
    expect(status.active).toBe(true);
    expect(status.daysLeft).toBe(1);
  });

  it('reports inactive at exactly 14 days (boundary)', () => {
    const record: TrialRecord = {
      trialStartedAt: new Date(T0).toISOString(),
      trialMachineId: 'm-1',
      version: 1,
    };
    expect(evaluateTrial(record, fixedClock(T0 + 14 * DAY)).active).toBe(false);
  });

  it('reports inactive past 14 days', () => {
    const record: TrialRecord = {
      trialStartedAt: new Date(T0).toISOString(),
      trialMachineId: 'm-1',
      version: 1,
    };
    expect(evaluateTrial(record, fixedClock(T0 + 30 * DAY))).toEqual({ active: false });
  });

  it('reports inactive when record has malformed trialStartedAt', () => {
    const record = {
      trialStartedAt: 'not-a-date',
      trialMachineId: 'm-1',
      version: 1,
    } as TrialRecord;
    expect(evaluateTrial(record, fixedClock(T0)).active).toBe(false);
  });
});
