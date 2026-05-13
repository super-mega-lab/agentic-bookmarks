import { describe, it, expect } from 'vitest';
import { checkFeature, type FeatureGateDeps } from './feature-gate';
import type { Tier, RepoVisibility } from './types';

function makeDeps(tier: Tier, visibility: RepoVisibility): FeatureGateDeps {
  return {
    getLicenseStatus: () => ({ tier, valid: true }),
    getRepoVisibility: () => visibility,
  };
}

describe('checkFeature decision matrix', () => {
  it('free features are always allowed regardless of state', () => {
    const tiers: Tier[] = ['free', 'pro', 'trial'];
    const vis: RepoVisibility[] = ['public', 'private', 'local'];
    for (const t of tiers) {
      for (const v of vis) {
        expect(checkFeature('test-free', makeDeps(t, v)).allowed).toBe(true);
      }
    }
  });

  it('pro features on public repos are allowed for all tiers', () => {
    expect(checkFeature('test-pro', makeDeps('free', 'public')).allowed).toBe(true);
    expect(checkFeature('test-pro', makeDeps('pro', 'public')).allowed).toBe(true);
    expect(checkFeature('test-pro', makeDeps('trial', 'public')).allowed).toBe(true);
  });

  it('pro features on local repos are allowed for all tiers', () => {
    expect(checkFeature('test-pro', makeDeps('free', 'local')).allowed).toBe(true);
    expect(checkFeature('test-pro', makeDeps('pro', 'local')).allowed).toBe(true);
    expect(checkFeature('test-pro', makeDeps('trial', 'local')).allowed).toBe(true);
  });

  it('pro features on private repos require pro or trial tier', () => {
    expect(checkFeature('test-pro', makeDeps('free', 'private'))).toEqual({
      allowed: false,
      reason: 'pro-required',
      tier: 'pro',
    });
    expect(checkFeature('test-pro', makeDeps('pro', 'private')).allowed).toBe(true);
    expect(checkFeature('test-pro', makeDeps('trial', 'private')).allowed).toBe(true);
  });

  it('invalid pro license on private repo denies access', () => {
    const deps: FeatureGateDeps = {
      getLicenseStatus: () => ({ tier: 'pro', valid: false }),
      getRepoVisibility: () => 'private',
    };
    expect(checkFeature('test-pro', deps).allowed).toBe(false);
  });

  it('invalid trial on private repo denies access', () => {
    const deps: FeatureGateDeps = {
      getLicenseStatus: () => ({ tier: 'trial', valid: false }),
      getRepoVisibility: () => 'private',
    };
    expect(checkFeature('test-pro', deps).allowed).toBe(false);
  });
});
