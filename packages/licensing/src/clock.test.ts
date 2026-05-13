import { describe, it, expect } from 'vitest';
import { systemClock, fixedClock } from './clock';

describe('clock', () => {
  it('systemClock.now() returns Date.now()', () => {
    const before = Date.now();
    const t = systemClock.now();
    const after = Date.now();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it('fixedClock returns the configured ms', () => {
    const c = fixedClock(123_456);
    expect(c.now()).toBe(123_456);
  });

  it('fixedClock can be advanced', () => {
    const c = fixedClock(0);
    c.advance(1000);
    expect(c.now()).toBe(1000);
  });

  it('fixedClock can be set absolutely', () => {
    const c = fixedClock(0);
    c.set(42);
    expect(c.now()).toBe(42);
  });
});
