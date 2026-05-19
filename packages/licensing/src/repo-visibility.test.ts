import { describe, it, expect } from 'vitest';
import {
  createStubRepoVisibility,
  effectiveVisibility,
  BETA_CUTOFF_ISO,
  BETA_CUTOFF_MS,
} from './repo-visibility';
import { fixedClock } from './clock';
import type { RepoVisibility } from './types';

describe('createStubRepoVisibility', () => {
  it('returns the value from the config getter', () => {
    const get = createStubRepoVisibility(() => 'private');
    expect(get()).toBe('private');
  });

  it('defaults to public when getter returns undefined', () => {
    const get = createStubRepoVisibility(() => undefined);
    expect(get()).toBe('public');
  });

  it('defaults to public when getter returns garbage', () => {
    const get = createStubRepoVisibility(() => 'xyzzy' as unknown as string);
    expect(get()).toBe('public');
  });
});

describe('BETA_CUTOFF constants', () => {
  it('BETA_CUTOFF_ISO is the agreed beta cutoff (2027-01-01T00:00:00Z)', () => {
    expect(BETA_CUTOFF_ISO).toBe('2027-01-01T00:00:00Z');
  });

  it('BETA_CUTOFF_MS parses BETA_CUTOFF_ISO', () => {
    expect(BETA_CUTOFF_MS).toBe(Date.parse('2027-01-01T00:00:00Z'));
  });
});

describe('effectiveVisibility — beta time-bomb', () => {
  const inputs: RepoVisibility[] = ['public', 'private', 'local'];
  const preCutoff = BETA_CUTOFF_MS - 1;
  const atCutoff = BETA_CUTOFF_MS;
  const postCutoff = BETA_CUTOFF_MS + 1000;

  for (const v of inputs) {
    it(`returns 'public' pre-cutoff when detected='${v}'`, () => {
      expect(effectiveVisibility(v, fixedClock(preCutoff))).toBe('public');
    });
  }

  for (const v of inputs) {
    it(`returns '${v}' unchanged at cutoff when detected='${v}'`, () => {
      expect(effectiveVisibility(v, fixedClock(atCutoff))).toBe(v);
    });
  }

  for (const v of inputs) {
    it(`returns '${v}' unchanged post-cutoff when detected='${v}'`, () => {
      expect(effectiveVisibility(v, fixedClock(postCutoff))).toBe(v);
    });
  }

  it('strict-less-than boundary: one ms before cutoff still returns public', () => {
    expect(effectiveVisibility('private', fixedClock(BETA_CUTOFF_MS - 1))).toBe('public');
  });

  it('strict-less-than boundary: exact cutoff returns input', () => {
    expect(effectiveVisibility('private', fixedClock(BETA_CUTOFF_MS))).toBe('private');
  });
});
