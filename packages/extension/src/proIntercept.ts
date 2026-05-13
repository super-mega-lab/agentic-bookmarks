import type { FeatureName } from '@agentic-bookmarks/licensing';
import type { LicensingService } from './licensingService';

export type InterceptOutcome = 'continue' | 'cancel';
export type ModalChoice = 'buy' | 'trial' | 'dismiss';

export interface InterceptDeps {
  licensing: LicensingService;
  showModal: () => Promise<ModalChoice>;
  openCheckout: () => Promise<void>;
}

/**
 * Single enforcement point for pro-feature gating UX. Every gated command
 * MUST route through this helper rather than calling licensing.check()
 * directly — otherwise the trial would start passively on background checks,
 * which is the opposite of the SML-1333 design.
 *
 * Returns 'continue' when the feature is already allowed OR when the user
 * just started the trial; 'cancel' otherwise (buy or dismiss).
 */
export async function proIntercept(
  feature: FeatureName,
  deps: InterceptDeps,
): Promise<InterceptOutcome> {
  const access = deps.licensing.check(feature);
  if (access.allowed) return 'continue';

  const choice = await deps.showModal();
  if (choice === 'buy') {
    await deps.openCheckout();
    return 'cancel';
  }
  if (choice === 'trial') {
    await deps.licensing.startTrial();
    return 'continue';
  }
  return 'cancel';
}
