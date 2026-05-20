// ABOUTME: Tests for pure scan-validation helpers — status mapping, missing-file
// ABOUTME: entries, and authoritative-cache merge.
import { describe, it, expect } from 'vitest';
import {
  missingFileEntries,
  buildAuthoritativeCache,
  type ScanResultEntry,
} from './scanValidate';

describe('missingFileEntries', () => {
  it('marks every bookmark broken with file_missing', () => {
    const out = missingFileEntries(['b1', 'b2'], 'src/gone.ts');
    expect(out).toEqual([
      { bookmarkId: 'b1', uri: 'src/gone.ts', status: 'broken', errorCode: 'file_missing', errorDetails: 'Target file not found: src/gone.ts', score: null },
      { bookmarkId: 'b2', uri: 'src/gone.ts', status: 'broken', errorCode: 'file_missing', errorDetails: 'Target file not found: src/gone.ts', score: null },
    ]);
  });
});

describe('buildAuthoritativeCache', () => {
  const existing = [
    { bookmarkId: 'b1', uri: 'src/a.ts', status: 'broken' as const, errorCode: null, errorDetails: null, score: null, discoveredAt: 100 },
    { bookmarkId: 'b2', uri: 'src/b.ts', status: 'broken' as const, errorCode: null, errorDetails: null, score: null, discoveredAt: 200 },
  ];

  it('drops stale entries for scanned files that are now clean', () => {
    // Scanned src/a.ts and found nothing broken → b1 entry dropped. src/b.ts untouched (out of scope).
    const out = buildAuthoritativeCache(existing, new Set(['src/a.ts']), [], 999);
    expect(out).toEqual([existing[1]]);
  });

  it('replaces scanned-file entries and preserves discoveredAt for still-broken ones', () => {
    const scanned: ScanResultEntry[] = [
      { bookmarkId: 'b1', uri: 'src/a.ts', status: 'broken', errorCode: 'not_found', errorDetails: 'x', score: null },
    ];
    const out = buildAuthoritativeCache(existing, new Set(['src/a.ts']), scanned, 999);
    expect(out).toContainEqual({ bookmarkId: 'b1', uri: 'src/a.ts', status: 'broken', errorCode: 'not_found', errorDetails: 'x', score: null, discoveredAt: 100 });
    expect(out).toContainEqual(existing[1]); // out-of-scope kept
  });

  it('stamps now for newly-discovered breakage and skips valid entries', () => {
    const scanned: ScanResultEntry[] = [
      { bookmarkId: 'b9', uri: 'src/c.ts', status: 'broken', errorCode: 'not_found', errorDetails: null, score: null },
      { bookmarkId: 'b10', uri: 'src/c.ts', status: 'valid', errorCode: null, errorDetails: null, score: null },
    ];
    const out = buildAuthoritativeCache([], new Set(['src/c.ts']), scanned, 999);
    expect(out).toEqual([
      { bookmarkId: 'b9', uri: 'src/c.ts', status: 'broken', errorCode: 'not_found', errorDetails: null, score: null, discoveredAt: 999 },
    ]);
  });

  it('keeps warning entries', () => {
    const scanned: ScanResultEntry[] = [
      { bookmarkId: 'b9', uri: 'src/c.ts', status: 'warning', errorCode: null, errorDetails: null, score: 0.5 },
    ];
    const out = buildAuthoritativeCache([], new Set(['src/c.ts']), scanned, 999);
    expect(out[0].status).toBe('warning');
  });
});
