import { isProFeature, type FeatureName } from './features';
import type { FeatureAccess, LicenseStatus, RepoVisibility } from './types';

export interface FeatureGateDeps {
  getLicenseStatus(): LicenseStatus;
  getRepoVisibility(): RepoVisibility;
}

export function checkFeature(name: FeatureName, deps: FeatureGateDeps): FeatureAccess {
  if (!isProFeature(name)) return { allowed: true };

  const visibility = deps.getRepoVisibility();
  if (visibility === 'public' || visibility === 'local') return { allowed: true };

  // Private repo: require valid pro or trial license. Trial == pro for gating.
  const license = deps.getLicenseStatus();
  if (license.valid && (license.tier === 'pro' || license.tier === 'trial')) {
    return { allowed: true };
  }

  return { allowed: false, reason: 'pro-required', tier: 'pro' };
}
