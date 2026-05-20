// ABOUTME: Tests for repair-agent default-preference + consent persistence helpers.
import { describe, it, expect } from 'vitest';
import {
  getRepairAgentDefault,
  setRepairAgentDefault,
  hasRepairConsent,
  recordRepairConsent,
} from './repair-agent-state';

// Fake of the slice of ExtensionContext we use.
function fakeCtx() {
  const g = new Map<string, unknown>();
  return {
    globalState: {
      get: <T>(k: string) => g.get(k) as T | undefined,
      update: async (k: string, v: unknown) => { g.set(k, v); },
    },
  } as any;
}

describe('repair-agent-state', () => {
  it('round-trips the default agent', async () => {
    const ctx = fakeCtx();
    expect(getRepairAgentDefault(ctx)).toBeUndefined();
    await setRepairAgentDefault(ctx, 'codex');
    expect(getRepairAgentDefault(ctx)).toBe('codex');
  });
  it('tracks one-time consent', async () => {
    const ctx = fakeCtx();
    expect(hasRepairConsent(ctx)).toBe(false);
    await recordRepairConsent(ctx);
    expect(hasRepairConsent(ctx)).toBe(true);
  });
});
