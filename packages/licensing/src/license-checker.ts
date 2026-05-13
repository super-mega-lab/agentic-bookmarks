import type { LicenseStatus, TrialRecord } from './types';
import type { Clock } from './clock';
import { evaluateTrial } from './trial-timer';

export interface LicenseCheckerDeps {
  getProLicense: () => LicenseStatus | undefined;
  getTrialRecord: () => TrialRecord | undefined;
  clock: Clock;
}

export function createLicenseChecker(deps: LicenseCheckerDeps): () => LicenseStatus {
  return () => {
    const pro = deps.getProLicense();
    if (pro && pro.valid && pro.tier === 'pro') return pro;

    const trial = evaluateTrial(deps.getTrialRecord(), deps.clock);
    if (trial.active) {
      return { tier: 'trial', valid: true, expiresAt: trial.expiresAt };
    }

    return { tier: 'free', valid: true };
  };
}
