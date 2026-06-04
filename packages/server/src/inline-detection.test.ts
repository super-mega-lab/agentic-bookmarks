import { describe, it, expect } from 'vitest';
import type { gitHistory } from '@agentic-bookmarks/core';
import { detectInlinedConstruct, parseDeclaration } from './inline-detection';

// ---------------------------------------------------------------------------
// Helpers: build FileDiff / hunk literals with correct line numbering.
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
  return { oldPath: 'task-wrapper.ts', newPath: 'task-wrapper.ts', status: 'modified', hunks, isBinary: false };
}

describe('parseDeclaration', () => {
  it('parses a private setter with its parameter', () => {
    expect(parseDeclaration('  private set promptOutput(output: string) {')).toEqual({
      symbol: 'promptOutput',
      paramNames: ['output'],
      kind: 'setter',
    });
  });

  it('parses a getter with no parameters', () => {
    expect(parseDeclaration('  get displayLabel() {')).toEqual({ symbol: 'displayLabel', paramNames: [], kind: 'getter' });
  });

  it('does not mistake control flow for a method declaration', () => {
    expect(parseDeclaration('  if (cond) {')).toBeNull();
    expect(parseDeclaration('  for (const x of xs) {')).toBeNull();
    expect(parseDeclaration('  return foo(x);')).toBeNull();
  });

  it('does not treat a call expression as a declaration', () => {
    expect(parseDeclaration('  this.promptOutput = chunk;')).toBeNull();
    expect(parseDeclaration('  this.setName(first);')).toBeNull();
  });
});

describe('detectInlinedConstruct', () => {
  // The canonical ticket example: setter inlined into stdout(), declaration removed.
  const setterDiff = mkDiff(
    mkHunk(158, 158, [
      ['ctx', '  }'],
      ['del', '  /** Send an output to the output channel as prompt. */'],
      ['del', '  private set promptOutput(output: string) {'],
      ['del', '    this.task.promptOutput$ = output;'],
      ['del', '  }'],
      ['ctx', ''],
    ]),
    mkHunk(200, 196, [
      ['ctx', '          const chunk = data.toString();'],
      ['del', '          this.promptOutput = chunk;'],
      ['add', '          this.task.promptOutput$ = chunk;'],
      ['ctx', '        }'],
    ]),
  );

  it('detects a setter inlined at a single call site (AC1) with medium confidence', () => {
    const result = detectInlinedConstruct(
      { lineCache: 'private set promptOutput(output: string) {', lastUpdatedLine: 159 },
      setterDiff,
      [],
    );
    expect(result).not.toBeNull();
    expect(result!.diagnosis).toBe('inlined');
    expect(result!.detail.deletedSymbol).toBe('promptOutput');
    expect(result!.detail.deletedBody).toBe('this.task.promptOutput$ = output;');
    expect(result!.detail.candidates).toHaveLength(1);
    expect(result!.detail.inlinedAt.line).toBe(196); // 0-based: addition newLineNumber 197 - 1
    expect(result!.detail.inlinedAt.content).toBe('          this.task.promptOutput$ = chunk;');
    expect(result!.detail.inlinedAt.confidence).toBe('medium');
  });

  it('tolerates argument renaming at the call site (AC2: output -> chunk)', () => {
    // The body uses parameter `output`; the call site substitutes `chunk`.
    const result = detectInlinedConstruct(
      { lineCache: 'private set promptOutput(output: string) {', lastUpdatedLine: 159 },
      setterDiff,
      [],
    );
    expect(result).not.toBeNull();
    expect(result!.detail.inlinedAt.content).toContain('= chunk;');
  });

  it('reports low confidence with all candidates for multiple call sites (AC3)', () => {
    const diff = mkDiff(
      mkHunk(10, 10, [
        ['del', '  private setName(name: string) {'],
        ['del', '    this._name = name.trim();'],
        ['del', '  }'],
      ]),
      mkHunk(30, 27, [
        ['del', '    this.setName(first);'],
        ['add', '    this._name = first.trim();'],
        ['ctx', ''],
      ]),
      mkHunk(40, 36, [
        ['del', '    this.setName(last);'],
        ['add', '    this._name = last.trim();'],
        ['ctx', ''],
      ]),
    );
    const result = detectInlinedConstruct({ lineCache: 'private setName(name: string) {', lastUpdatedLine: 9 }, diff, []);
    expect(result).not.toBeNull();
    expect(result!.detail.deletedSymbol).toBe('setName');
    expect(result!.detail.candidates).toHaveLength(2);
    expect(result!.detail.candidates.map(c => c.line)).toEqual([26, 35]);
    expect(result!.detail.inlinedAt.confidence).toBe('low');
  });

  it('returns null when the declaration was deleted with no call-site substitution (AC5)', () => {
    const diff = mkDiff(
      mkHunk(158, 158, [
        ['ctx', '  }'],
        ['del', '  private set promptOutput(output: string) {'],
        ['del', '    this.task.promptOutput$ = output;'],
        ['del', '  }'],
        ['ctx', ''],
      ]),
    );
    const result = detectInlinedConstruct(
      { lineCache: 'private set promptOutput(output: string) {', lastUpdatedLine: 158 },
      diff,
      [],
    );
    expect(result).toBeNull();
  });

  it('returns null for a generic body that would match too much (AC6)', () => {
    const diff = mkDiff(
      mkHunk(5, 5, [
        ['del', 'function getId() {'],
        ['del', '  return id;'],
        ['del', '}'],
      ]),
      mkHunk(20, 18, [
        ['del', '  const x = getId();'],
        ['add', '  const x = id;'],
      ]),
    );
    const result = detectInlinedConstruct({ lineCache: 'function getId() {', lastUpdatedLine: 4 }, diff, []);
    expect(result).toBeNull();
  });

  it('detects a getter inlined into an expression context (AC7)', () => {
    const diff = mkDiff(
      mkHunk(5, 5, [
        ['del', '  get displayLabel() {'],
        ['del', '    return this.label.toUpperCase();'],
        ['del', '  }'],
      ]),
      mkHunk(20, 18, [
        ['del', '    const t = this.displayLabel;'],
        ['add', '    const t = this.label.toUpperCase();'],
      ]),
    );
    const result = detectInlinedConstruct({ lineCache: 'get displayLabel() {', lastUpdatedLine: 4 }, diff, []);
    expect(result).not.toBeNull();
    expect(result!.detail.deletedSymbol).toBe('displayLabel');
    expect(result!.detail.deletedBody).toBe('this.label.toUpperCase()');
    expect(result!.detail.inlinedAt.line).toBe(17);
    expect(result!.detail.inlinedAt.confidence).toBe('medium');
  });

  it('returns null when no deleted declaration ties to the anchor', () => {
    const result = detectInlinedConstruct(
      { lineCache: 'const totallyUnrelated = compute();', lastUpdatedLine: 5 },
      setterDiff,
      [],
    );
    expect(result).toBeNull();
  });

  it('matches an unrenamed body exactly (no parameter variation needed)', () => {
    const diff = mkDiff(
      mkHunk(10, 10, [
        ['del', '  set value(v: number) {'],
        ['del', '    this._store.value = v;'],
        ['del', '  }'],
      ]),
      mkHunk(30, 27, [
        ['del', '    this.value = v;'],
        ['add', '    this._store.value = v;'],
        ['ctx', ''],
      ]),
    );
    const result = detectInlinedConstruct({ lineCache: 'set value(v: number) {', lastUpdatedLine: 9 }, diff, []);
    expect(result).not.toBeNull();
    expect(result!.detail.deletedSymbol).toBe('value');
    expect(result!.detail.inlinedAt.confidence).toBe('medium');
  });

  it('does not report an inline site when the working tree has drifted from HEAD (SML-1556)', () => {
    // setterDiff's inlined addition is HEAD-relative (newLineNumber 197 -> line0 196).
    // currentFileLines is the WORKING TREE, which the user edited above the call site,
    // so row 196 now holds an unrelated line. Reporting line0 196 with that row's
    // content would yield an inlinedAt whose line/content disagree with the real site.
    // (Note: the other tests pass [] — the pure-diff fallback — and must keep working;
    // the guard only fires on a PRESENT, mismatched row, never an absent one.)
    const driftedFile = new Array(200).fill('// unrelated drifted working-tree line');
    driftedFile[196] = '          someOtherCall();';
    const result = detectInlinedConstruct(
      { lineCache: 'private set promptOutput(output: string) {', lastUpdatedLine: 159 },
      setterDiff,
      driftedFile,
    );
    expect(result).toBeNull();
  });

  it('ties a point anchor (no lineCache) to the deleted decl by position (SML-1568 item 5)', () => {
    // A point anchor stores only a line number, no lineCache. declTiedToAnchor must
    // fall back to position: lastUpdatedLine 159 -> 1-based old line 160, which sits
    // inside the setter's deletion hunk (oldStart 158, oldCount 6), so the deleted
    // declaration is tied and the inline is detected.
    const result = detectInlinedConstruct(
      { lineCache: undefined, lastUpdatedLine: 159 },
      setterDiff,
      [],
    );
    expect(result).not.toBeNull();
    expect(result!.diagnosis).toBe('inlined');
    expect(result!.detail.deletedSymbol).toBe('promptOutput');
    expect(result!.detail.inlinedAt.line).toBe(196);
  });
});
