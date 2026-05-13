import { describe, it, expect, beforeEach } from 'vitest';
import { initStateForFile, getStatus, clearStateForFile } from './anchorState';
import type { AnchorResolutionResult } from '@agentic-bookmarks/core';

const DOC_URI = 'file:///test/file.ts';

function makeResult(overrides: Partial<AnchorResolutionResult> & { anchorId: string }): AnchorResolutionResult {
  return {
    resolved: true,
    line: 10,
    ...overrides,
  };
}

describe('initStateForFile warning suppression on shared bookmarks', () => {
  beforeEach(() => {
    clearStateForFile(DOC_URI);
  });

  it('suppresses warning on shared bookmark when showWarningOnShared is false', () => {
    const results = [makeResult({ anchorId: 'b1', score: 0.72 })];
    const isLocalMap = new Map([['b1', false]]);
    initStateForFile(DOC_URI, results, { isLocalMap, showWarningOnShared: false });
    expect(getStatus(DOC_URI, 'b1')).toBe('valid');
  });

  it('preserves warning on shared bookmark when showWarningOnShared is true', () => {
    const results = [makeResult({ anchorId: 'b1', score: 0.72 })];
    const isLocalMap = new Map([['b1', false]]);
    initStateForFile(DOC_URI, results, { isLocalMap, showWarningOnShared: true });
    expect(getStatus(DOC_URI, 'b1')).toBe('warning');
  });

  it('preserves warning on local bookmark regardless of showWarningOnShared', () => {
    const results = [makeResult({ anchorId: 'b1', score: 0.72 })];
    const isLocalMap = new Map([['b1', true]]);
    initStateForFile(DOC_URI, results, { isLocalMap, showWarningOnShared: false });
    expect(getStatus(DOC_URI, 'b1')).toBe('warning');
  });

  it('lineCacheOnly warning is never suppressed on shared bookmark', () => {
    const results = [makeResult({
      anchorId: 'b1',
      resolved: false,
      line: undefined,
      lineCacheOnly: true,
      lineCacheOnlyLine: 15,
    })];
    const isLocalMap = new Map([['b1', false]]);
    initStateForFile(DOC_URI, results, { isLocalMap, showWarningOnShared: false });
    expect(getStatus(DOC_URI, 'b1')).toBe('warning');
  });

  it('defaults to local (no suppression) when isLocalMap is not provided', () => {
    const results = [makeResult({ anchorId: 'b1', score: 0.72 })];
    initStateForFile(DOC_URI, results);
    expect(getStatus(DOC_URI, 'b1')).toBe('warning');
  });

  it('defaults to local when bookmark is missing from isLocalMap', () => {
    const results = [makeResult({ anchorId: 'b1', score: 0.72 })];
    const isLocalMap = new Map<string, boolean>(); // empty
    initStateForFile(DOC_URI, results, { isLocalMap, showWarningOnShared: false });
    expect(getStatus(DOC_URI, 'b1')).toBe('warning');
  });

  it('does not suppress high-confidence shared bookmarks (score >= 0.85)', () => {
    const results = [makeResult({ anchorId: 'b1', score: 0.95 })];
    const isLocalMap = new Map([['b1', false]]);
    initStateForFile(DOC_URI, results, { isLocalMap, showWarningOnShared: false });
    expect(getStatus(DOC_URI, 'b1')).toBe('valid');
  });

  it('handles mix of local and shared bookmarks correctly', () => {
    const results = [
      makeResult({ anchorId: 'local1', score: 0.72 }),
      makeResult({ anchorId: 'shared1', score: 0.72 }),
      makeResult({ anchorId: 'shared2', score: 0.95 }),
    ];
    const isLocalMap = new Map([
      ['local1', true],
      ['shared1', false],
      ['shared2', false],
    ]);
    initStateForFile(DOC_URI, results, { isLocalMap, showWarningOnShared: false });
    expect(getStatus(DOC_URI, 'local1')).toBe('warning');   // local — not suppressed
    expect(getStatus(DOC_URI, 'shared1')).toBe('valid');     // shared low-confidence — suppressed
    expect(getStatus(DOC_URI, 'shared2')).toBe('valid');     // shared high-confidence — naturally valid
  });
});
