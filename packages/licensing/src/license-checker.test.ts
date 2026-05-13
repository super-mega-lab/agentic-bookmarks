import { describe, it, expect } from 'vitest';
import { createLicenseChecker } from './license-checker';
import { fixedClock } from './clock';
import type { TrialRecord } from './types';

const T0 = Date.parse('2026-05-01T00:00:00Z');
const DAY = 86_400_000;

describe('createLicenseChecker', () => {
  it('returns free when nothing is active', () => {
    const get = createLicenseChecker({
      getProLicense: () => undefined,
      getTrialRecord: () => undefined,
      clock: fixedClock(T0),
    });
    expect(get()).toEqual({ tier: 'free', valid: true });
  });

  it('returns trial with expiresAt when within window', () => {
    const record: TrialRecord = {
      trialStartedAt: new Date(T0).toISOString(),
      trialMachineId: 'm-1',
      version: 1,
    };
    const get = createLicenseChecker({
      getProLicense: () => undefined,
      getTrialRecord: () => record,
      clock: fixedClock(T0 + 5 * DAY),
    });
    expect(get()).toEqual({
      tier: 'trial',
      valid: true,
      expiresAt: new Date(T0 + 14 * DAY).toISOString(),
    });
  });

  it('returns free when trial expired', () => {
    const record: TrialRecord = {
      trialStartedAt: new Date(T0).toISOString(),
      trialMachineId: 'm-1',
      version: 1,
    };
    const get = createLicenseChecker({
      getProLicense: () => undefined,
      getTrialRecord: () => record,
      clock: fixedClock(T0 + 30 * DAY),
    });
    expect(get()).toEqual({ tier: 'free', valid: true });
  });

  it('returns pro when getProLicense returns a valid status — pro wins over active trial', () => {
    const record: TrialRecord = {
      trialStartedAt: new Date(T0).toISOString(),
      trialMachineId: 'm-1',
      version: 1,
    };
    const get = createLicenseChecker({
      getProLicense: () => ({ tier: 'pro', valid: true }),
      getTrialRecord: () => record,
      clock: fixedClock(T0 + 5 * DAY),
    });
    expect(get()).toEqual({ tier: 'pro', valid: true });
  });

  it('ignores invalid pro license and falls through to trial', () => {
    const record: TrialRecord = {
      trialStartedAt: new Date(T0).toISOString(),
      trialMachineId: 'm-1',
      version: 1,
    };
    const get = createLicenseChecker({
      getProLicense: () => ({ tier: 'pro', valid: false }),
      getTrialRecord: () => record,
      clock: fixedClock(T0 + 5 * DAY),
    });
    expect(get().tier).toBe('trial');
  });
});
