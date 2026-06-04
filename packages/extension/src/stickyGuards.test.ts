import { describe, expect, it } from 'vitest';
import {
  classifyStickyLane,
  isExtremeSmartJump,
  lineWithinTouchedRanges,
  mergeTouchedRanges,
  summarizeStickyBatch,
  toTouchedRange,
  STICKY_BULK_CHANGE_COUNT,
  STICKY_BULK_TOUCHED_RATIO,
  STICKY_BULK_SINGLE_CHANGE_RATIO,
  STICKY_MICRO_TOUCHED_LINES,
  STICKY_MICRO_CHANGE_COUNT,
  STICKY_TOUCH_RADIUS,
  STICKY_EXTREME_JUMP_LINES,
  type StickyBatchMetrics,
  type StickyChangeLike,
} from './stickyGuards';

function change(
  startLine: number,
  endLine: number,
  text: string,
  startCharacter = 0,
  endCharacter = 0
): StickyChangeLike {
  return {
    range: {
      start: { line: startLine, character: startCharacter },
      end: { line: endLine, character: endCharacter },
    },
    text,
  };
}

// Build a StickyBatchMetrics object directly so each classifyStickyLane OR-condition can
// be pinned at its exact threshold in isolation. Real summarizeStickyBatch output couples
// touchedRatio and maxSingleChangeRatio — a single change makes them equal, and
// maxSingleChangeRatio is always <= touchedRatio (the max single span can't exceed the
// merged total) — so synthetic metrics are the only way to exercise the changeCount and
// maxSingleChangeRatio branches independently. The defaults classify as 'medium'.
function metrics(overrides: Partial<StickyBatchMetrics> = {}): StickyBatchMetrics {
  return {
    fileLineCount: 100,
    changeCount: 10,
    touchedLines: 15,
    touchedRatio: 0.15,
    maxSingleChangeRatio: 0.15,
    touchedRanges: [],
    hasNearWholeDocumentReplace: false,
    ...overrides,
  };
}

describe('stickyGuards', () => {
  it('classifies low-volume edits as micro', () => {
    const metrics = summarizeStickyBatch(
      [
        change(10, 10, 'small tweak'),
        change(11, 11, 'x'),
      ],
      200
    );
    expect(classifyStickyLane(metrics)).toBe('micro');
  });

  it('classifies moderate local edits as medium', () => {
    const metrics = summarizeStickyBatch(
      [
        change(10, 12, 'a\nb\nc'),
        change(20, 22, 'd\ne\nf'),
        change(30, 31, 'g\nh'),
      ],
      200
    );
    expect(classifyStickyLane(metrics)).toBe('medium');
  });

  it('classifies near-whole-document replace as bulk', () => {
    const fullReplace = change(0, 199, 'new file body', 0, 0);
    const metrics = summarizeStickyBatch([fullReplace], 200);
    expect(classifyStickyLane(metrics)).toBe('bulk');
  });

  it('merges overlapping ranges and reports proximity checks', () => {
    const ranges = mergeTouchedRanges([
      { startLine: 10, endLine: 12 },
      { startLine: 12, endLine: 14 },
      { startLine: 30, endLine: 30 },
    ]);
    expect(ranges).toEqual([
      { startLine: 10, endLine: 14 },
      { startLine: 30, endLine: 30 },
    ]);
    expect(lineWithinTouchedRanges(9, ranges, 1)).toBe(true);
    expect(lineWithinTouchedRanges(16, ranges, 1)).toBe(false);
  });

  it('flags large jumps as extreme', () => {
    expect(isExtremeSmartJump(10, 41)).toBe(true);
    expect(isExtremeSmartJump(10, 30)).toBe(false);
  });
});

describe('stickyGuards threshold constants', () => {
  // Pin the literal threshold values so the boundary tests below (which assert against
  // literals, not the constants) document the intended thresholds and any drift fails loudly.
  it('exposes the documented threshold literals', () => {
    expect(STICKY_BULK_CHANGE_COUNT).toBe(25);
    expect(STICKY_BULK_TOUCHED_RATIO).toBe(0.2);
    expect(STICKY_BULK_SINGLE_CHANGE_RATIO).toBe(0.3);
    expect(STICKY_MICRO_TOUCHED_LINES).toBe(8);
    expect(STICKY_MICRO_CHANGE_COUNT).toBe(2);
    expect(STICKY_TOUCH_RADIUS).toBe(1);
    expect(STICKY_EXTREME_JUMP_LINES).toBe(25);
  });
});

describe('classifyStickyLane bulk boundaries', () => {
  it('treats 25 changes as not-bulk and 26 as bulk (strict >)', () => {
    expect(classifyStickyLane(metrics({ changeCount: 25 }))).not.toBe('bulk');
    expect(classifyStickyLane(metrics({ changeCount: 26 }))).toBe('bulk');
  });

  it('treats touchedRatio 0.2 as not-bulk and 0.21 as bulk (strict >)', () => {
    expect(classifyStickyLane(metrics({ touchedRatio: 0.2 }))).not.toBe('bulk');
    expect(classifyStickyLane(metrics({ touchedRatio: 0.21 }))).toBe('bulk');
  });

  it('treats maxSingleChangeRatio 0.3 as not-bulk and 0.31 as bulk (strict >)', () => {
    // touchedRatio held below its own threshold so maxSingleChangeRatio is the decider.
    expect(classifyStickyLane(metrics({ maxSingleChangeRatio: 0.3, touchedRatio: 0.05 }))).not.toBe('bulk');
    expect(classifyStickyLane(metrics({ maxSingleChangeRatio: 0.31, touchedRatio: 0.05 }))).toBe('bulk');
  });

  it('forces bulk when hasNearWholeDocumentReplace is set, even for an otherwise-micro batch', () => {
    expect(
      classifyStickyLane(
        metrics({
          hasNearWholeDocumentReplace: true,
          changeCount: 1,
          touchedLines: 1,
          touchedRatio: 0.01,
          maxSingleChangeRatio: 0.01,
        })
      )
    ).toBe('bulk');
  });
});

describe('classifyStickyLane micro boundary', () => {
  it('is micro at exactly 2 changes / 8 touched lines (<= on both)', () => {
    expect(
      classifyStickyLane(metrics({ changeCount: 2, touchedLines: 8, touchedRatio: 0.08, maxSingleChangeRatio: 0.08 }))
    ).toBe('micro');
  });

  it('falls to medium when touched lines cross to 9', () => {
    expect(
      classifyStickyLane(metrics({ changeCount: 2, touchedLines: 9, touchedRatio: 0.09, maxSingleChangeRatio: 0.09 }))
    ).toBe('medium');
  });

  it('falls to medium when change count crosses to 3', () => {
    expect(
      classifyStickyLane(metrics({ changeCount: 3, touchedLines: 8, touchedRatio: 0.08, maxSingleChangeRatio: 0.08 }))
    ).toBe('medium');
  });
});

describe('toTouchedRange', () => {
  it('spans a multi-line removal', () => {
    expect(toTouchedRange(change(10, 14, ''), 200)).toEqual({ startLine: 10, endLine: 14 });
  });

  it('spans a multi-line insertion by counting inserted newlines', () => {
    expect(toTouchedRange(change(10, 10, 'a\nb\nc'), 200)).toEqual({ startLine: 10, endLine: 12 });
  });

  it('uses the larger of the removed and inserted spans', () => {
    // remove 5 lines (10..14) while inserting a single line → the removed span wins
    expect(toTouchedRange(change(10, 14, 'x'), 200)).toEqual({ startLine: 10, endLine: 14 });
  });

  it('clamps a negative start line to 0', () => {
    expect(toTouchedRange(change(-3, -1, 'x'), 200)).toEqual({ startLine: 0, endLine: 2 });
  });
});

describe('mergeTouchedRanges', () => {
  it('merges ranges separated by a single-line gap (end + 1)', () => {
    expect(
      mergeTouchedRanges([
        { startLine: 10, endLine: 12 },
        { startLine: 13, endLine: 14 },
      ])
    ).toEqual([{ startLine: 10, endLine: 14 }]);
  });

  it('keeps ranges split when the gap is two lines', () => {
    expect(
      mergeTouchedRanges([
        { startLine: 10, endLine: 12 },
        { startLine: 14, endLine: 15 },
      ])
    ).toEqual([
      { startLine: 10, endLine: 12 },
      { startLine: 14, endLine: 15 },
    ]);
  });

  it('is order-independent (sorts before merging)', () => {
    expect(
      mergeTouchedRanges([
        { startLine: 30, endLine: 30 },
        { startLine: 12, endLine: 14 },
        { startLine: 10, endLine: 12 },
      ])
    ).toEqual([
      { startLine: 10, endLine: 14 },
      { startLine: 30, endLine: 30 },
    ]);
  });
});

describe('lineWithinTouchedRanges', () => {
  const ranges = [{ startLine: 10, endLine: 14 }];

  it('includes the trailing radius edge but excludes one line past it', () => {
    expect(lineWithinTouchedRanges(15, ranges, 1)).toBe(true); // end + 1
    expect(lineWithinTouchedRanges(16, ranges, 1)).toBe(false); // end + 2
  });

  it('includes the leading radius edge but excludes one line before it', () => {
    expect(lineWithinTouchedRanges(9, ranges, 1)).toBe(true); // start - 1
    expect(lineWithinTouchedRanges(8, ranges, 1)).toBe(false); // start - 2
  });

  it('requires an exact match when radius is 0', () => {
    expect(lineWithinTouchedRanges(14, ranges, 0)).toBe(true);
    expect(lineWithinTouchedRanges(15, ranges, 0)).toBe(false);
  });

  it('defaults the radius to STICKY_TOUCH_RADIUS (1)', () => {
    expect(lineWithinTouchedRanges(15, ranges)).toBe(true); // end + 1 with the default radius
    expect(lineWithinTouchedRanges(16, ranges)).toBe(false);
  });
});

describe('isExtremeSmartJump', () => {
  it('uses a strict threshold of 25 lines', () => {
    expect(isExtremeSmartJump(10, 35)).toBe(false); // diff exactly 25 → not > 25
    expect(isExtremeSmartJump(10, 36)).toBe(true); // diff 26
  });

  it('is symmetric in jump direction via Math.abs', () => {
    expect(isExtremeSmartJump(36, 10)).toBe(true); // diff -26
    expect(isExtremeSmartJump(35, 10)).toBe(false); // diff -25
  });

  it('honors an explicit threshold override', () => {
    expect(isExtremeSmartJump(0, 5, 4)).toBe(true);
    expect(isExtremeSmartJump(0, 4, 4)).toBe(false);
  });
});

describe('summarizeStickyBatch metrics', () => {
  it('computes touchedRatio and maxSingleChangeRatio from the merged ranges', () => {
    // two far-apart single-line changes on a 100-line file: 2 touched lines, max span 1
    const m = summarizeStickyBatch([change(5, 5, 'a'), change(50, 50, 'b')], 100);
    expect(m.changeCount).toBe(2);
    expect(m.touchedLines).toBe(2);
    expect(m.touchedRatio).toBeCloseTo(0.02, 10);
    expect(m.maxSingleChangeRatio).toBeCloseTo(0.01, 10);
  });

  it('flags a top-to-bottom single change as a near-whole-document replace', () => {
    expect(
      summarizeStickyBatch([change(0, 99, 'new body')], 100).hasNearWholeDocumentReplace
    ).toBe(true);
  });

  it('flags a replace via the touchedRatio >= 0.8 path without reaching the bottom', () => {
    // covers lines 0..79 of a 100-line file: touchedRatio 0.8, end line 79 (not near bottom)
    expect(
      summarizeStickyBatch([change(0, 79, 'x')], 100).hasNearWholeDocumentReplace
    ).toBe(true);
  });

  it('flags a large top-of-file paste as a replace (large-inserted-body path)', () => {
    // replace line 0 with a 25-newline paste into a 30-line file; the inserted body exceeds
    // max(20, floor(30 * 0.8)) = 24 lines (the touchedRatio threshold is also met here).
    const bigPaste = Array.from({ length: 26 }, (_, i) => `N${i}`).join('\n');
    expect(
      summarizeStickyBatch([change(0, 0, bigPaste)], 30).hasNearWholeDocumentReplace
    ).toBe(true);
  });

  it('does not flag a small top-of-file edit as a replace', () => {
    expect(
      summarizeStickyBatch([change(0, 0, 'x')], 100).hasNearWholeDocumentReplace
    ).toBe(false);
  });

  it('never treats a two-change batch as a whole-document replace', () => {
    expect(
      summarizeStickyBatch([change(0, 50, 'a'), change(60, 99, 'b')], 100).hasNearWholeDocumentReplace
    ).toBe(false);
  });

  it('requires the single change to start at the very top of the document', () => {
    // starts at line 1 → not the top
    expect(
      summarizeStickyBatch([change(1, 99, 'x')], 100).hasNearWholeDocumentReplace
    ).toBe(false);
    // starts at line 0 but character 1 → not the top
    expect(
      summarizeStickyBatch([change(0, 99, 'x', 1, 0)], 100).hasNearWholeDocumentReplace
    ).toBe(false);
  });
});
