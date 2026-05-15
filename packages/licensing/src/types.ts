export type Tier = 'free' | 'pro' | 'trial';

export type RepoVisibility = 'public' | 'private' | 'local';

export interface LicenseStatus {
  tier: Tier;
  valid: boolean;
  /** Reserved for SML-1333 (persistent trial timer). Always undefined in Phase 1. */
  expiresAt?: string;
}

export type FeatureAccessReason = 'pro-required';

export interface FeatureAccess {
  allowed: boolean;
  reason?: FeatureAccessReason;
  tier?: Tier;
}

export interface TrialRecord {
  trialStartedAt: string;
  trialMachineId: string;
  version: 1;
}

export interface TrialStatus {
  active: boolean;
  startedAt?: string;
  expiresAt?: string;
  daysLeft?: number;
}
