// ABOUTME: Tests for bookmark-export-helpers — covers template substitution,
// ABOUTME: 1-based line conversion, default pattern shape, and edge-case robustness.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EXPORT_PATTERN,
  pickItemToExportRow,
  renderExportLine,
  renderBookmarksMarkdown,
  type ExportRowFields,
} from './bookmark-export-helpers';
import type { BookmarkPickItem } from './bookmark-quickpick-items';

function pickItem(overrides: Partial<BookmarkPickItem> = {}): BookmarkPickItem {
  return {
    bookmarkId: overrides.bookmarkId ?? 'b1',
    fileId: overrides.fileId ?? 'f1',
    groupId: overrides.groupId ?? 'gA',
    fsPath: overrides.fsPath ?? '/ws/src/foo.ts',
    line: overrides.line ?? 0,
    endLine: overrides.endLine ?? 0,
    label: overrides.label ?? '',
    groupName: overrides.groupName ?? 'Group A',
    relativePath: overrides.relativePath ?? 'src/foo.ts',
    note: overrides.note ?? '',
  };
}

function row(overrides: Partial<ExportRowFields> = {}): ExportRowFields {
  return {
    file: overrides.file ?? 'src/foo.ts',
    line: overrides.line ?? 1,
    endLine: overrides.endLine ?? 1,
    label: overrides.label ?? '',
    group: overrides.group ?? 'Group A',
    note: overrides.note ?? '',
  };
}

describe('pickItemToExportRow', () => {
  it('maps relativePath → file and groupName → group', () => {
    const r = pickItemToExportRow(
      pickItem({ relativePath: 'src/bar.ts', groupName: 'Reviews' })
    );
    expect(r.file).toBe('src/bar.ts');
    expect(r.group).toBe('Reviews');
  });

  it('converts 0-based line to 1-based (line=0 → 1)', () => {
    const r = pickItemToExportRow(pickItem({ line: 0, endLine: 0 }));
    expect(r.line).toBe(1);
    expect(r.endLine).toBe(1);
  });

  it('converts both line and endLine for range bookmarks', () => {
    const r = pickItemToExportRow(pickItem({ line: 4, endLine: 9 }));
    expect(r.line).toBe(5);
    expect(r.endLine).toBe(10);
  });

  it('passes label and note through unchanged', () => {
    const r = pickItemToExportRow(
      pickItem({ label: 'My Note', note: 'hello world' })
    );
    expect(r.label).toBe('My Note');
    expect(r.note).toBe('hello world');
  });
});

describe('renderExportLine', () => {
  it('substitutes ${file}, ${line}, ${endLine}, ${label}, ${group}, ${note}', () => {
    const pattern =
      'F=${file} L=${line} E=${endLine} La=${label} G=${group} N=${note}';
    const out = renderExportLine(
      pattern,
      row({
        file: 'src/foo.ts',
        line: 5,
        endLine: 8,
        label: 'My Label',
        group: 'My Group',
        note: 'My Note',
      })
    );
    expect(out).toBe(
      'F=src/foo.ts L=5 E=8 La=My Label G=My Group N=My Note'
    );
  });

  it('substitutes ${file} alone', () => {
    expect(renderExportLine('${file}', row({ file: 'a/b.ts' }))).toBe('a/b.ts');
  });

  it('substitutes ${line} alone (numeric → string)', () => {
    expect(renderExportLine('${line}', row({ line: 42 }))).toBe('42');
  });

  it('substitutes ${endLine} alone', () => {
    expect(renderExportLine('${endLine}', row({ endLine: 7 }))).toBe('7');
  });

  it('substitutes ${label} alone', () => {
    expect(renderExportLine('${label}', row({ label: 'hi' }))).toBe('hi');
  });

  it('substitutes ${group} alone', () => {
    expect(renderExportLine('${group}', row({ group: 'g' }))).toBe('g');
  });

  it('substitutes ${note} alone', () => {
    expect(renderExportLine('${note}', row({ note: 'n' }))).toBe('n');
  });

  it('leaves unknown placeholders verbatim', () => {
    const out = renderExportLine(
      '${file} ${unknown} ${other}',
      row({ file: 'a.ts' })
    );
    expect(out).toBe('a.ts ${unknown} ${other}');
  });

  it('does not throw on unknown placeholders', () => {
    expect(() =>
      renderExportLine('${nope}', row())
    ).not.toThrow();
  });

  it('trims trailing whitespace (empty label leaves no dangling space)', () => {
    const out = renderExportLine('${file} ${label}', row({ file: 'x.ts', label: '' }));
    expect(out).toBe('x.ts');
  });

  it('renders empty pattern as empty string', () => {
    expect(renderExportLine('', row())).toBe('');
  });

  it('renders ${note} as empty string when row.note is empty', () => {
    const out = renderExportLine('note=[${note}]', row({ note: '' }));
    expect(out).toBe('note=[]');
  });
});

describe('DEFAULT_EXPORT_PATTERN', () => {
  it('preserves placeholder syntax literally (not pre-substituted)', () => {
    expect(DEFAULT_EXPORT_PATTERN).toContain('${file}');
    expect(DEFAULT_EXPORT_PATTERN).toContain('${line}');
    expect(DEFAULT_EXPORT_PATTERN).toContain('${label}');
  });

  it('DEFAULT_EXPORT_PATTERN renders to a Markdown link of form [path:line](path#Lline)', () => {
    const out = renderExportLine(
      DEFAULT_EXPORT_PATTERN,
      row({ file: 'src/foo.ts', line: 42, label: 'My label' })
    );
    expect(out).toBe('- [`src/foo.ts:42`](src/foo.ts#L42) My label');
  });

  it('DEFAULT_EXPORT_PATTERN trims trailing whitespace when label is empty', () => {
    const out = renderExportLine(
      DEFAULT_EXPORT_PATTERN,
      row({ file: 'src/foo.ts', line: 1, label: '' })
    );
    expect(out).toBe('- [`src/foo.ts:1`](src/foo.ts#L1)');
  });
});

describe('renderBookmarksMarkdown', () => {
  it('returns "" for empty items', () => {
    expect(renderBookmarksMarkdown([], DEFAULT_EXPORT_PATTERN)).toBe('');
  });

  it('renders a single item via renderExportLine + pickItemToExportRow', () => {
    const out = renderBookmarksMarkdown(
      [pickItem({ relativePath: 'src/foo.ts', line: 0, endLine: 0, label: 'L' })],
      DEFAULT_EXPORT_PATTERN
    );
    expect(out).toBe('- [`src/foo.ts:1`](src/foo.ts#L1) L');
  });

  it('preserves input order across multiple items, joined by \\n', () => {
    const items = [
      pickItem({ bookmarkId: 'a', relativePath: 'a.ts', line: 0, label: 'A' }),
      pickItem({ bookmarkId: 'b', relativePath: 'b.ts', line: 1, label: 'B' }),
      pickItem({ bookmarkId: 'c', relativePath: 'c.ts', line: 2, label: 'C' }),
    ];
    const out = renderBookmarksMarkdown(items, '${file}:${line} ${label}');
    expect(out).toBe('a.ts:1 A\nb.ts:2 B\nc.ts:3 C');
  });

  it('renders ${note} from item.note (filled and empty)', () => {
    const items = [
      pickItem({ bookmarkId: 'a', relativePath: 'a.ts', line: 0, note: 'has note' }),
      pickItem({ bookmarkId: 'b', relativePath: 'b.ts', line: 0, note: '' }),
    ];
    const out = renderBookmarksMarkdown(items, '${file} N=[${note}]');
    expect(out).toBe('a.ts N=[has note]\nb.ts N=[]');
  });

  it('range bookmark renders distinct ${line} and ${endLine}', () => {
    const items = [pickItem({ relativePath: 'r.ts', line: 4, endLine: 9 })];
    const out = renderBookmarksMarkdown(items, '${file} ${line}-${endLine}');
    expect(out).toBe('r.ts 5-10');
  });

  it('boundary: line=0 renders as 1 (1-based)', () => {
    const items = [pickItem({ relativePath: 'f.ts', line: 0, endLine: 0 })];
    const out = renderBookmarksMarkdown(items, '${file}:${line}');
    expect(out).toBe('f.ts:1');
  });

  it('pattern with ${unknown} placeholder is left verbatim, no throw', () => {
    const items = [pickItem({ relativePath: 'f.ts', line: 0 })];
    expect(() =>
      renderBookmarksMarkdown(items, '${file} ${unknown}')
    ).not.toThrow();
    const out = renderBookmarksMarkdown(items, '${file} ${unknown}');
    expect(out).toBe('f.ts ${unknown}');
  });

  it('empty pattern produces empty lines joined by \\n', () => {
    const items = [pickItem({ bookmarkId: 'a' }), pickItem({ bookmarkId: 'b' })];
    expect(renderBookmarksMarkdown(items, '')).toBe('\n');
  });

  it('empty pattern with single item produces ""', () => {
    expect(renderBookmarksMarkdown([pickItem()], '')).toBe('');
  });

  it('label="" results in line with no trailing whitespace (trimEnd applied)', () => {
    const items = [pickItem({ relativePath: 'f.ts', line: 0, label: '' })];
    const out = renderBookmarksMarkdown(items, DEFAULT_EXPORT_PATTERN);
    expect(out).toBe('- [`f.ts:1`](f.ts#L1)');
    expect(out).not.toMatch(/ $/);
  });
});
