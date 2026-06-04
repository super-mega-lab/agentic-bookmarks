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

  it('merges into a same-named method with a different signature (SML-1568 item 4)', () => {
    // The deleted `set config(v: string)` setter's body lands inside a method that
    // happens to share the name `config` but has a DIFFERENT signature
    // (`config(opts: Options)`). The self-merge guard must exclude only the same
    // construct (name + signature), not every same-named method — otherwise this
    // legitimate merge target is wrongly dropped and the result is null.
    const file = [
      'export class X {',                          // 0
      '  config(opts: Options): void {',           // 1
      '    this.alpha = computeAlpha(opts);',      // 2
      '    this.beta = computeBeta(opts);',        // 3
      '  }',                                        // 4
      '}',                                          // 5
    ];
    const diff = mkDiff(
      mkHunk(20, 20, [
        ['del', '  set config(v: string) {'],
        ['del', '    this.alpha = computeAlpha(v);'],
        ['del', '    this.beta = computeBeta(v);'],
        ['del', '  }'],
      ]),
      mkHunk(20, 2, [
        ['add', '  config(opts: Options): void {'],
        ['add', '    this.alpha = computeAlpha(opts);'],
        ['add', '    this.beta = computeBeta(opts);'],
        ['add', '  }'],
      ]),
    );
    const result = detectMergedConstruct({ lineCache: 'set config(v: string) {', lastUpdatedLine: 19 }, diff, file);
    expect(result).not.toBeNull();
    expect(result!.detail.deletedSymbol).toBe('config');
    expect(result!.detail.mergedInto.symbol).toBe('config');
    expect(result!.detail.mergedInto.line).toBe(1);
    expect(result!.detail.candidates).toHaveLength(1);
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

  it('does not report a merge target when the working tree has drifted from HEAD (SML-1556)', () => {
    // mergeDiff's additions are HEAD-relative: cleanseAnsi -> line0 12, listr -> line0 13.
    // But currentFileLines is the WORKING TREE, which the user has edited above the
    // construct — a `decoy` method now occupies those rows. Indexing the working tree
    // with HEAD-relative numbers would walk up to `decoy` and misattribute the merge.
    // The guard must distrust the position and decline rather than report a bogus target.
    const driftedFile = [
      'export class TaskWrapper {',         // 0
      '  private listr: any;',              // 1
      '  private task = {};',               // 2
      '',                                   // 3
      '  public decoy(a: string): void {',  // 4  <- unrelated decl the stale line0s land under
      '    const a1 = a;',                  // 5
      '    const a2 = a;',                  // 6
      '    const a3 = a;',                  // 7
      '    const a4 = a;',                  // 8
      '    const a5 = a;',                  // 9
      '    const a6 = a;',                  // 10
      '    const a7 = a;',                  // 11
      '    const a8 = a;',                  // 12  <- cleanseAnsi addition (line0 12) indexes here
      '    const a9 = a;',                  // 13  <- listr addition (line0 13) indexes here
      '  }',                                // 14
      '}',                                  // 15
    ];
    const result = detectMergedConstruct(
      { lineCache: 'set promptOutput$(data: string) {', lastUpdatedLine: 41 },
      mergeDiff,
      driftedFile,
    );
    expect(result).toBeNull();
  });
});
