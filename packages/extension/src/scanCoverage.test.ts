// ABOUTME: Tests for the session-scoped validated-files set backing Scan coverage.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  markFileValidated,
  isFileValidated,
  countValidatedAmong,
  resetScanCoverage,
} from './scanCoverage';

describe('scanCoverage', () => {
  beforeEach(() => resetScanCoverage());

  it('records and reports validated files', () => {
    expect(isFileValidated('/ws/a.ts')).toBe(false);
    markFileValidated('/ws/a.ts');
    expect(isFileValidated('/ws/a.ts')).toBe(true);
  });

  it('counts how many of a candidate set are validated', () => {
    markFileValidated('/ws/a.ts');
    markFileValidated('/ws/c.ts');
    const total = new Set(['/ws/a.ts', '/ws/b.ts', '/ws/c.ts']);
    expect(countValidatedAmong(total)).toBe(2);
  });

  it('counts only members of the candidate set (validated extras ignored)', () => {
    markFileValidated('/ws/a.ts');
    markFileValidated('/ws/zzz.ts'); // not in candidate set
    expect(countValidatedAmong(new Set(['/ws/a.ts']))).toBe(1);
  });
});
