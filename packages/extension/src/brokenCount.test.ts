// ABOUTME: Tests for counting genuinely-broken anchors (warnings excluded).
import { describe, it, expect } from 'vitest';
import { countBroken } from './brokenCount';

const e = (status: 'broken' | 'warning', bookmarkId: string) =>
  ({ bookmarkId, uri: 'x', status, errorCode: null, errorDetails: null, score: null, discoveredAt: 0 });

describe('countBroken', () => {
  it('counts only broken, not warning', () => {
    expect(countBroken([e('broken', 'a'), e('warning', 'b'), e('broken', 'c')])).toBe(2);
  });
  it('dedupes by bookmarkId', () => {
    expect(countBroken([e('broken', 'a'), e('broken', 'a')])).toBe(1);
  });
  it('handles empty', () => {
    expect(countBroken([])).toBe(0);
  });
});
