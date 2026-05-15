import { TRIAL_LENGTH_DAYS } from './constants';
import type { Clock } from './clock';
import type { TrialRecord, TrialStatus } from './types';

const DAY_MS = 86_400_000;
export const TRIAL_DURATION_MS = TRIAL_LENGTH_DAYS * DAY_MS;

export interface StartTrialDeps {
  existing: TrialRecord | undefined;
  clock: Clock;
  machineId: string;
}

export function startTrial(deps: StartTrialDeps): TrialRecord {
  if (deps.existing) return deps.existing;
  return {
    trialStartedAt: new Date(deps.clock.now()).toISOString(),
    trialMachineId: deps.machineId,
    version: 1,
  };
}

export function evaluateTrial(
  record: TrialRecord | undefined,
  clock: Clock,
): TrialStatus {
  if (!record) return { active: false };
  const startedMs = Date.parse(record.trialStartedAt);
  if (!Number.isFinite(startedMs)) return { active: false };
  const expiresMs = startedMs + TRIAL_DURATION_MS;
  const remainingMs = expiresMs - clock.now();
  if (remainingMs <= 0) return { active: false };
  return {
    active: true,
    startedAt: record.trialStartedAt,
    expiresAt: new Date(expiresMs).toISOString(),
    daysLeft: Math.max(1, Math.ceil(remainingMs / DAY_MS)),
  };
}
