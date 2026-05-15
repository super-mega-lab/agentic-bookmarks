import { describe, expect, it } from 'vitest';
import {
  classifyStickyLane,
  isExtremeSmartJump,
  lineWithinTouchedRanges,
  mergeTouchedRanges,
  summarizeStickyBatch,
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
