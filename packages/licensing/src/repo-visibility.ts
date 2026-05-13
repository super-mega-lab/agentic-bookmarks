import type { Clock } from './clock';
import type { RepoVisibility } from './types';

const VALID = new Set<RepoVisibility>(['public', 'private', 'local']);

/**
 * Phase 1 stub: reads visibility from a config getter.
 * Replaced in a follow-up ticket by real git-remote/HTTP-HEAD detection.
 */
export function createStubRepoVisibility(
  getConfig: () => string | undefined,
): () => RepoVisibility {
  return () => {
    const v = getConfig();
    if (v && VALID.has(v as RepoVisibility)) return v as RepoVisibility;
    return 'public';
  };
}

/**
 * Public beta cutoff: while the clock is strictly before this instant,
 * effectiveVisibility() returns 'public' for every input — the launch build
 * silently treats every repo as if it were public so pro features stay
 * available to everyone. At and after this instant the cached detection
 * is reported unchanged and pro is gated on private repos again.
 *
 * If you change this date, also update the badge and opening paragraph in
 * the repo root README.md.
 */
export const BETA_CUTOFF_ISO = '2026-07-01T00:00:00Z';
export const BETA_CUTOFF_MS = Date.parse(BETA_CUTOFF_ISO);

/**
 * Wraps the detected visibility with the public-beta time-bomb. Before
 * BETA_CUTOFF_MS, returns 'public' regardless of input. From BETA_CUTOFF_MS
 * onwards, returns the detected visibility unchanged.
 */
export function effectiveVisibility(detected: RepoVisibility, clock: Clock): RepoVisibility {
  if (clock.now() < BETA_CUTOFF_MS) return 'public';
  return detected;
}
