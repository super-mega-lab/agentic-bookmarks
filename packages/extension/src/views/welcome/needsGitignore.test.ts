import { describe, it, expect } from 'vitest';
import { shouldOfferGitignoreLine } from './needsGitignore';

const ROOT = '/ws';

describe('shouldOfferGitignoreLine', () => {
  it('returns false when the local data dir does not exist', async () => {
    const result = await shouldOfferGitignoreLine(ROOT, {
      pathExists: async () => false,
      gitignoreContainsLine: async () => false,
    });
    expect(result).toBe(false);
  });

  it('returns false when the local dir exists but the line is already present', async () => {
    const result = await shouldOfferGitignoreLine(ROOT, {
      pathExists: async () => true,
      gitignoreContainsLine: async () => true,
    });
    expect(result).toBe(false);
  });

  it('returns true when the local dir exists and the line is absent', async () => {
    const result = await shouldOfferGitignoreLine(ROOT, {
      pathExists: async () => true,
      gitignoreContainsLine: async () => false,
    });
    expect(result).toBe(true);
  });

  it('does not check .gitignore when the local dir is absent', async () => {
    let checked = false;
    await shouldOfferGitignoreLine(ROOT, {
      pathExists: async () => false,
      gitignoreContainsLine: async () => {
        checked = true;
        return false;
      },
    });
    expect(checked).toBe(false);
  });

  it('returns false (never throws) when a dependency rejects', async () => {
    const result = await shouldOfferGitignoreLine(ROOT, {
      pathExists: async () => {
        throw new Error('boom');
      },
      gitignoreContainsLine: async () => false,
    });
    expect(result).toBe(false);
  });
});
