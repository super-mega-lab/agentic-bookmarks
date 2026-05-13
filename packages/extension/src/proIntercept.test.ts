import { describe, it, expect, vi } from 'vitest';
import { proIntercept, type InterceptDeps, type InterceptOutcome } from './proIntercept';
import type { LicensingService } from './licensingService';

function fakeLicensing(opts: {
  allowed: boolean;
  startTrial?: () => Promise<void>;
}): LicensingService {
  return {
    check: vi.fn(() => ({
      allowed: opts.allowed,
      reason: opts.allowed ? undefined : ('pro-required' as const),
      tier: 'pro' as const,
    })),
    startTrial: vi.fn(opts.startTrial ?? (async () => {})),
  } as unknown as LicensingService;
}

describe('proIntercept', () => {
  it('returns continue when feature is allowed (no modal)', async () => {
    const deps: InterceptDeps = {
      licensing: fakeLicensing({ allowed: true }),
      showModal: vi.fn(),
      openCheckout: vi.fn(),
    };
    const outcome: InterceptOutcome = await proIntercept('test-pro', deps);
    expect(outcome).toBe('continue');
    expect(deps.showModal).not.toHaveBeenCalled();
  });

  it('"trial" choice → startTrial → continue', async () => {
    const startTrial = vi.fn(async () => {});
    const deps: InterceptDeps = {
      licensing: fakeLicensing({ allowed: false, startTrial }),
      showModal: vi.fn(async () => 'trial'),
      openCheckout: vi.fn(),
    };
    const outcome = await proIntercept('test-pro', deps);
    expect(outcome).toBe('continue');
    expect(startTrial).toHaveBeenCalledOnce();
    expect(deps.openCheckout).not.toHaveBeenCalled();
  });

  it('"buy" choice → openCheckout, returns cancel', async () => {
    const deps: InterceptDeps = {
      licensing: fakeLicensing({ allowed: false }),
      showModal: vi.fn(async () => 'buy'),
      openCheckout: vi.fn(async () => {}),
    };
    expect(await proIntercept('test-pro', deps)).toBe('cancel');
    expect(deps.openCheckout).toHaveBeenCalledOnce();
  });

  it('"dismiss" choice returns cancel', async () => {
    const deps: InterceptDeps = {
      licensing: fakeLicensing({ allowed: false }),
      showModal: vi.fn(async () => 'dismiss'),
      openCheckout: vi.fn(),
    };
    expect(await proIntercept('test-pro', deps)).toBe('cancel');
  });

  it('startTrial failure surfaces (does not silently continue)', async () => {
    const deps: InterceptDeps = {
      licensing: fakeLicensing({
        allowed: false,
        startTrial: async () => { throw new Error('persistence failed'); },
      }),
      showModal: vi.fn(async () => 'trial'),
      openCheckout: vi.fn(),
    };
    await expect(proIntercept('test-pro', deps)).rejects.toThrow('persistence failed');
  });
});
