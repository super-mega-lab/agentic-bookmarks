export interface StickyPositionLike {
  line: number;
  character: number;
}

export interface StickyRangeLike {
  start: StickyPositionLike;
  end: StickyPositionLike;
}

export interface StickyChangeLike {
  range: StickyRangeLike;
  text: string;
}

export interface StickyTouchedRange {
  startLine: number;
  endLine: number;
}

export interface StickyBatchMetrics {
  fileLineCount: number;
  changeCount: number;
  touchedLines: number;
  touchedRatio: number;
  maxSingleChangeRatio: number;
  touchedRanges: StickyTouchedRange[];
  hasNearWholeDocumentReplace: boolean;
}

export type StickyEditLane = 'micro' | 'medium' | 'bulk';

export const STICKY_BULK_SINGLE_CHANGE_RATIO = 0.3;
export const STICKY_BULK_TOUCHED_RATIO = 0.2;
export const STICKY_BULK_CHANGE_COUNT = 25;
export const STICKY_MICRO_TOUCHED_LINES = 8;
export const STICKY_MICRO_CHANGE_COUNT = 2;
export const STICKY_TOUCH_RADIUS = 1;
export const STICKY_EXTREME_JUMP_LINES = 25;

function insertedLineBreaks(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length - 1;
}

export function toTouchedRange(
  change: StickyChangeLike,
  _fileLineCount: number
): StickyTouchedRange {
  const startLine = Math.max(0, change.range.start.line);
  const removedSpan = Math.max(1, change.range.end.line - change.range.start.line + 1);
  const insertedSpan = Math.max(1, insertedLineBreaks(change.text) + 1);
  const span = Math.max(removedSpan, insertedSpan);
  return {
    startLine,
    endLine: Math.max(startLine, startLine + span - 1),
  };
}

export function mergeTouchedRanges(ranges: StickyTouchedRange[]): StickyTouchedRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  const merged: StickyTouchedRange[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const tail = merged[merged.length - 1];
    if (current.startLine <= tail.endLine + 1) {
      tail.endLine = Math.max(tail.endLine, current.endLine);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

export function countTouchedLines(ranges: StickyTouchedRange[]): number {
  return ranges.reduce((total, range) => total + Math.max(0, range.endLine - range.startLine + 1), 0);
}

function hasNearWholeDocumentReplace(changes: StickyChangeLike[], fileLineCount: number): boolean {
  if (changes.length !== 1) return false;
  const only = changes[0];
  const startsAtTop = only.range.start.line === 0 && only.range.start.character === 0;
  if (!startsAtTop) return false;

  const touched = toTouchedRange(only, fileLineCount);
  const touchedSpan = touched.endLine - touched.startLine + 1;
  const touchedRatio = fileLineCount > 0 ? touchedSpan / fileLineCount : 1;
  const endsNearBottom = fileLineCount <= 1 || only.range.end.line >= fileLineCount - 1;
  const largeInsertedBody = insertedLineBreaks(only.text) >= Math.max(20, Math.floor(fileLineCount * 0.8));
  return endsNearBottom || touchedRatio >= 0.8 || largeInsertedBody;
}

export function summarizeStickyBatch(
  changes: StickyChangeLike[],
  fileLineCount: number
): StickyBatchMetrics {
  const rawRanges = changes.map(change => toTouchedRange(change, fileLineCount));
  const touchedRanges = mergeTouchedRanges(rawRanges);
  const touchedLines = countTouchedLines(touchedRanges);
  const safeLineCount = Math.max(1, fileLineCount);
  const maxTouchedSpan = rawRanges.reduce(
    (max, range) => Math.max(max, range.endLine - range.startLine + 1),
    0
  );

  return {
    fileLineCount,
    changeCount: changes.length,
    touchedLines,
    touchedRatio: touchedLines / safeLineCount,
    maxSingleChangeRatio: maxTouchedSpan / safeLineCount,
    touchedRanges,
    hasNearWholeDocumentReplace: hasNearWholeDocumentReplace(changes, fileLineCount),
  };
}

export function classifyStickyLane(metrics: StickyBatchMetrics): StickyEditLane {
  if (
    metrics.hasNearWholeDocumentReplace ||
    metrics.maxSingleChangeRatio > STICKY_BULK_SINGLE_CHANGE_RATIO ||
    metrics.touchedRatio > STICKY_BULK_TOUCHED_RATIO ||
    metrics.changeCount > STICKY_BULK_CHANGE_COUNT
  ) {
    return 'bulk';
  }

  if (
    metrics.touchedLines <= STICKY_MICRO_TOUCHED_LINES &&
    metrics.changeCount <= STICKY_MICRO_CHANGE_COUNT
  ) {
    return 'micro';
  }

  return 'medium';
}

export function lineWithinTouchedRanges(
  line: number,
  ranges: StickyTouchedRange[],
  radius: number = STICKY_TOUCH_RADIUS
): boolean {
  for (const range of ranges) {
    if (line >= range.startLine - radius && line <= range.endLine + radius) {
      return true;
    }
  }
  return false;
}

export function isExtremeSmartJump(
  previousLine: number,
  nextLine: number,
  threshold: number = STICKY_EXTREME_JUMP_LINES
): boolean {
  return Math.abs(nextLine - previousLine) > threshold;
}
