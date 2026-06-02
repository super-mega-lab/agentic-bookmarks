import { describe, it, expect } from 'vitest';
import type { gitHistory } from '@agentic-bookmarks/core';
import { detectMergedConstruct } from './merged-detection';

// ---------------------------------------------------------------------------
// Helpers: build FileDiff / hunk literals with correct line numbering.
// (Mirrors inline-detection.test.ts so the two detectors share a test idiom.)
// ---------------------------------------------------------------------------

type Row = ['ctx' | 'del' | 'add', string];

function mkHunk(oldStart: number, newStart: number, rows: Row[]): gitHistory.DiffHunk {
  let oldN = oldStart;
  let newN = newStart;
  const lines: gitHistory.DiffLine[] = rows.map(([t, content]) => {
    if (t === 'ctx') {
      const l: gitHistory.DiffLine = { type: 'context', content, oldLineNumber: oldN, newLineNumber: newN };
      oldN++; newN++;
      return l;
    }
    if (t === 'del') {
      const l: gitHistory.DiffLine = { type: 'deletion', content, oldLineNumber: oldN };
      oldN++;
      return l;
    }
    const l: gitHistory.DiffLine = { type: 'addition', content, newLineNumber: newN };
    newN++;
    return l;
  });
  return { oldStart, oldCount: oldN - oldStart, newStart, newCount: newN - newStart, lines };
}

function mkDiff(...hunks: gitHistory.DiffHunk[]): gitHistory.FileDiff {
  return { oldPath: 'task.ts', newPath: 'task.ts', status: 'modified', hunks, isBinary: false };
}

describe('detectMergedConstruct', () => {
  // The canonical ticket example: the `promptOutput$` setter is deleted and its
  // body is combined into a new `emitData(...)` method (output$ + promptOutput$
  // setters merged). The setter's `this.emit(... PROMPT, data)` line is reflowed
  // across several lines in emitData, but `cleanseAnsi(data)` and the
  // `this.listr.events.emit(...)` line survive verbatim inside it.
  const mergedFile = [
    'export class TaskWrapper {',                                                     // 0
    '  private listr: any;',                                                          // 1
    "  private task = { output$: '', promptOutput$: '' };",                           // 2
    '',                                                                               // 3
    '  public emitData(type: "output" | "prompt", data: string): void {',            // 4
    '    if (type === "output") {',                                                   // 5
    '      this.task.output$ = data;',                                                // 6
    '    }',                                                                          // 7
    '    this.emit(',                                                                 // 8
    '      type === "output" ? ListrTaskEventType.OUTPUT : ListrTaskEventType.PROMPT,', // 9
    '      data,',                                                                    // 10
    '    );',                                                                         // 11
    '    if (type === "output" || cleanseAnsi(data)) {',                             // 12
    '      this.listr.events.emit(ListrEventType.SHOULD_REFRESH_RENDER);',           // 13
    '    }',                                                                          // 14
    '  }',                                                                            // 15
    '}',                                                                             // 16
  ];

  const mergeDiff = mkDiff(
    // Deletion hunk: the promptOutput$ setter removed.
    mkHunk(40, 40, [
      ['ctx', '  }'],
      ['del', '  set promptOutput$(data: string) {'],
      ['del', '    this.emit(ListrTaskEventType.PROMPT, data);'],
      ['del', '    if (cleanseAnsi(data)) {'],
      ['del', '      this.listr.events.emit(ListrEventType.SHOULD_REFRESH_RENDER);'],
      ['del', '    }'],
      ['del', '  }'],
      ['ctx', ''],
    ]),
    // Addition hunk: the whole emitData method is new. newStart=5 => first add is
    // 1-based line 5 (0-based 4), so the cleanseAnsi line lands at 0-based 12 and
    // the listr.events.emit line at 0-based 13 — matching `mergedFile`.
    mkHunk(40, 5, [
      ['add', '  public emitData(type: "output" | "prompt", data: string): void {'],
      ['add', '    if (type === "output") {'],
      ['add', '      this.task.output$ = data;'],
      ['add', '    }'],
      ['add', '    this.emit('],
      ['add', '      type === "output" ? ListrTaskEventType.OUTPUT : ListrTaskEventType.PROMPT,'],
      ['add', '      data,'],
      ['add', '    );'],
      ['add', '    if (type === "output" || cleanseAnsi(data)) {'],
      ['add', '      this.listr.events.emit(ListrEventType.SHOULD_REFRESH_RENDER);'],
      ['add', '    }'],
      ['add', '  }'],
    ]),
  );

  it('detects a setter merged into another method (AC1) with medium confidence (AC3)', () => {
    const result = detectMergedConstruct(
      { lineCache: 'set promptOutput$(data: string) {', lastUpdatedLine: 41 },
      mergeDiff,
      mergedFile,
    );
    expect(result).not.toBeNull();
    expect(result!.diagnosis).toBe('merged');
    expect(result!.detail.deletedSymbol).toBe('promptOutput$');
    // Repair target is the merged method's *declaration* line (AC4), 0-based.
    expect(result!.detail.mergedInto.line).toBe(4);
    expect(result!.detail.mergedInto.symbol).toBe('emitData');
    expect(result!.detail.mergedInto.content).toContain('emitData');
    expect(result!.detail.mergedInto.confidence).toBe('medium');
    expect(result!.detail.candidates).toHaveLength(1);
    // At least the two surviving fragments were located.
    expect(result!.detail.mergedInto.line).toBe(result!.detail.candidates[0].line);
    expect(result!.detail.candidates[0].matchedFragments.length).toBeGreaterThanOrEqual(2);
    expect(result!.detail.candidates[0].matchedFragments.some(f => f.includes('cleanseAnsi'))).toBe(true);
  });

  it('reports low confidence with all candidates when the body is scattered across new methods (AC3)', () => {
    const file = [
      'export class X {',                       // 0
      '  onOpen(evt: Event) {',                 // 1
      '    this.logger.record(evt.id);',        // 2
      '  }',                                    // 3
      '  onClose(evt: Event) {',                // 4
      '    this.metrics.increment(evt.kind);',  // 5
      '  }',                                    // 6
      '}',                                      // 7
    ];
    const diff = mkDiff(
      mkHunk(10, 10, [
        ['del', '  handle(evt: Event) {'],
        ['del', '    this.logger.record(evt.id);'],
        ['del', '    this.metrics.increment(evt.kind);'],
        ['del', '  }'],
      ]),
      mkHunk(10, 2, [
        ['add', '  onOpen(evt: Event) {'],
        ['add', '    this.logger.record(evt.id);'],
        ['add', '  }'],
        ['add', '  onClose(evt: Event) {'],
        ['add', '    this.metrics.increment(evt.kind);'],
        ['add', '  }'],
      ]),
    );
    const result = detectMergedConstruct({ lineCache: 'handle(evt: Event) {', lastUpdatedLine: 9 }, diff, file);
    expect(result).not.toBeNull();
    expect(result!.detail.deletedSymbol).toBe('handle');
    expect(result!.detail.mergedInto.confidence).toBe('low');
    expect(result!.detail.candidates).toHaveLength(2);
    expect(result!.detail.candidates.map(c => c.line)).toEqual([1, 4]);
  });

  it('returns null when the deleted body does not appear in any addition (true rewrite)', () => {
    const file = [
      'export class X {',
      '  recompute(data: string) {',
      '    return totallyDifferent(data);',
      '  }',
      '}',
    ];
    const diff = mkDiff(
      mkHunk(10, 10, [
        ['del', '  set promptOutput$(data: string) {'],
        ['del', '    this.emit(ListrTaskEventType.PROMPT, data);'],
        ['del', '    this.listr.events.emit(ListrEventType.SHOULD_REFRESH_RENDER);'],
        ['del', '  }'],
      ]),
      mkHunk(10, 2, [
        ['add', '  recompute(data: string) {'],
        ['add', '    return totallyDifferent(data);'],
        ['add', '  }'],
      ]),
    );
    const result = detectMergedConstruct({ lineCache: 'set promptOutput$(data: string) {', lastUpdatedLine: 9 }, diff, file);
    expect(result).toBeNull();
  });

  it('returns null for a single-statement body (inlined territory, not a merge)', () => {
    // Only one body fragment exists; even if it lands inside a method, that is the
    // `inlined` detector\'s job. merged requires >= 2 matched fragments.
    const file = [
      'export class X {',
      '  stdout(chunk: string) {',
      '    this.task.promptOutput$ = chunk;',
      '  }',
      '}',
    ];
    const diff = mkDiff(
      mkHunk(10, 10, [
        ['del', '  set promptOutput$(data: string) {'],
        ['del', '    this.task.promptOutput$ = data;'],
        ['del', '  }'],
      ]),
      mkHunk(10, 2, [
        ['ctx', '  stdout(chunk: string) {'],
        ['add', '    this.task.promptOutput$ = chunk;'],
        ['ctx', '  }'],
      ]),
    );
    const result = detectMergedConstruct({ lineCache: 'set promptOutput$(data: string) {', lastUpdatedLine: 9 }, diff, file);
    expect(result).toBeNull();
  });

  it('returns null when no deleted declaration ties to the anchor', () => {
    const result = detectMergedConstruct(
      { lineCache: 'const totallyUnrelated = compute();', lastUpdatedLine: 41 },
      mergeDiff,
      mergedFile,
    );
    expect(result).toBeNull();
  });

  it('returns null for an empty diff', () => {
    expect(detectMergedConstruct({ lineCache: 'set x(v: string) {', lastUpdatedLine: 1 }, mkDiff(), [])).toBeNull();
  });
});
