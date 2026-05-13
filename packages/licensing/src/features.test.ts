import { describe, it, expect } from 'vitest';
import { PRO_FEATURES, FREE_FEATURES, isProFeature, type FeatureName } from './features';

describe('feature registries', () => {
  it('PRO_FEATURES contains the 14 ticket-defined features plus test-pro fixture', () => {
    expect(PRO_FEATURES).toContain('smart-anchors');
    expect(PRO_FEATURES).toContain('mcp-forensics');
    expect(PRO_FEATURES).toContain('test-pro');
    expect(PRO_FEATURES).toHaveLength(15);
  });

  it('FREE_FEATURES contains the test-free fixture', () => {
    expect(FREE_FEATURES).toContain('test-free');
    expect(FREE_FEATURES).toHaveLength(1);
  });

  it('isProFeature returns true for pro features', () => {
    expect(isProFeature('test-pro')).toBe(true);
    expect(isProFeature('smart-anchors')).toBe(true);
  });

  it('isProFeature returns false for free features', () => {
    expect(isProFeature('test-free')).toBe(false);
  });

  it('FeatureName type accepts both pro and free', () => {
    const a: FeatureName = 'test-pro';
    const b: FeatureName = 'test-free';
    expect([a, b]).toEqual(['test-pro', 'test-free']);
  });
});
