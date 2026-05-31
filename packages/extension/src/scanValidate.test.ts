// ABOUTME: Tests for pure scan-validation helpers — status mapping, missing-file
// ABOUTME: entries, and authoritative-cache merge.
import { describe, it, expect } from 'vitest';
import {
  missingFileEntries,
  buildAuthoritativeCache,
  mergeCoveredUris,
  pruneCoveredUris,
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

  it('drops a stale entry after cross-file repair moved the bookmark (id-aware)', () => {
    // b1 was broken at old.ts; a cross-file repair moved it to new.ts, which the
    // scan validates as valid. The old.ts entry is outside scannedUris but must
    // still be pruned because b1 was re-validated this scan.
    const stale = [
      { bookmarkId: 'b1', uri: 'old.ts', status: 'broken' as const, errorCode: null, errorDetails: null, score: null, discoveredAt: 100 },
    ];
    const scanned: ScanResultEntry[] = [
      { bookmarkId: 'b1', uri: 'new.ts', status: 'valid', errorCode: null, errorDetails: null, score: null },
    ];
    const out = buildAuthoritativeCache(stale, new Set(['new.ts']), scanned, 999);
    expect(out).toEqual([]); // no entry for b1 at the old URI
  });

  it('keeps warning entries', () => {
    const scanned: ScanResultEntry[] = [
      { bookmarkId: 'b9', uri: 'src/c.ts', status: 'warning', errorCode: null, errorDetails: null, score: 0.5 },
    ];
    const out = buildAuthoritativeCache([], new Set(['src/c.ts']), scanned, 999);
    expect(out[0].status).toBe('warning');
  });
});

describe('mergeCoveredUris', () => {
  it('dedupes overlapping existing and added URIs', () => {
    expect(mergeCoveredUris(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('preserves existing when added is empty', () => {
    expect(mergeCoveredUris(['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('adds new when existing is empty', () => {
    expect(mergeCoveredUris([], ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('accepts a Set as added (Iterable)', () => {
    expect(mergeCoveredUris(['a'], new Set(['a', 'b']))).toEqual(['a', 'b']);
  });
});

describe('pruneCoveredUris', () => {
  it('drops URIs no longer in the universe', () => {
    // src/gone.ts was bookmarked once (so it lingers in coveredUris) but is now
    // deleted/deregistered → absent from the universe → pruned.
    const out = pruneCoveredUris(['src/a.ts', 'src/gone.ts'], new Set(['src/a.ts']));
    expect(out).toEqual(['src/a.ts']);
  });

  it('keeps live URIs and matches ignoring #fragment', () => {
    // Covered entry carries a #fragment; the universe stores the bare path. Membership
    // is fragment-insensitive (same normalization the server applies to coverage).
    const out = pruneCoveredUris(['src/a.ts#L5', 'src/b.ts'], new Set(['src/a.ts', 'src/b.ts']));
    expect(out).toEqual(['src/a.ts#L5', 'src/b.ts']);
  });

  it('normalizes a universe that itself carries fragments', () => {
    const out = pruneCoveredUris(['src/a.ts'], new Set(['src/a.ts#L1']));
    expect(out).toEqual(['src/a.ts']);
  });

  it('empty universe prunes everything', () => {
    expect(pruneCoveredUris(['src/a.ts', 'src/b.ts'], new Set())).toEqual([]);
  });

  it('empty coveredUris returns empty', () => {
    expect(pruneCoveredUris([], new Set(['src/a.ts']))).toEqual([]);
  });

  it('preserves order and accepts an array universe (Iterable)', () => {
    const out = pruneCoveredUris(['c.ts', 'a.ts', 'b.ts'], ['a.ts', 'b.ts', 'c.ts']);
    expect(out).toEqual(['c.ts', 'a.ts', 'b.ts']);
  });
});
