// ABOUTME: Tests for new-file-helpers — covers the resolveNewFileAction truth table
// ABOUTME: and isPathRegistered path-normalization edge cases.

import { describe, it, expect } from 'vitest';
import type { WorkspaceRegistryV1 } from '@agentic-bookmarks/core';
import { resolveNewFileAction, isPathRegistered } from './new-file-helpers';

function makeRegistry(
  files: Array<{ fileId: string; path: string; enabled?: boolean; watch?: boolean }> = [],
): WorkspaceRegistryV1 {
  return {
    version: 1,
    files: files.map((f) => ({
      fileId: f.fileId,
      path: f.path,
      enabled: f.enabled ?? true,
      watch: f.watch ?? true,
    })),
    nameIndex: {},
    settings: {
      watchersEnabled: true,
      sortByFile: true,
      sortByGroup: false,
      general: { showInlineDots: true },
      appearance: { showDifferentColors: true, showDifferentStyles: true },
    },
  } as any;
}

describe('resolveNewFileAction', () => {
  it('returns write when file does not exist (regardless of registration)', () => {
    expect(
      resolveNewFileAction({ fileExists: false, isRegistered: false, relativePath: 'a.json' }),
    ).toEqual({ kind: 'write' });
    expect(
      resolveNewFileAction({ fileExists: false, isRegistered: true, relativePath: 'a.json' }),
    ).toEqual({ kind: 'write' });
  });

  it('returns error-already-registered when file exists and is registered', () => {
    const result = resolveNewFileAction({
      fileExists: true,
      isRegistered: true,
      relativePath: '.bookmarks/shared/foo.json',
    });
    expect(result.kind).toBe('error-already-registered');
    expect((result as { kind: 'error-already-registered'; relativePath: string }).relativePath).toBe(
      '.bookmarks/shared/foo.json',
    );
  });

  it('returns prompt-load-existing when file exists but is not registered', () => {
    const result = resolveNewFileAction({
      fileExists: true,
      isRegistered: false,
      relativePath: '.bookmarks/shared/bar.json',
    });
    expect(result.kind).toBe('prompt-load-existing');
    expect((result as { kind: 'prompt-load-existing'; relativePath: string }).relativePath).toBe(
      '.bookmarks/shared/bar.json',
    );
  });
});

describe('isPathRegistered', () => {
  it('returns false for an empty registry', () => {
    const registry = makeRegistry([]);
    expect(isPathRegistered(registry, '/ws/bookmarks.json', '/ws')).toBe(false);
  });

  it('returns true when an absolute path matches a registered relative path', () => {
    const registry = makeRegistry([
      { fileId: 'f1', path: 'bookmarks.json', enabled: true, watch: true },
    ]);
    expect(isPathRegistered(registry, '/ws/bookmarks.json', '/ws')).toBe(true);
  });

  it('returns true when path-normalization equivalents match', () => {
    const registry = makeRegistry([
      { fileId: 'f1', path: '.bookmarks/shared/foo.json', enabled: true, watch: true },
    ]);
    expect(
      isPathRegistered(registry, '/ws/.bookmarks/shared/foo.json', '/ws'),
    ).toBe(true);
  });

  it('returns false for a path outside the workspace', () => {
    const registry = makeRegistry([
      { fileId: 'f1', path: 'bookmarks.json', enabled: true, watch: true },
    ]);
    expect(isPathRegistered(registry, '/elsewhere/bookmarks.json', '/ws')).toBe(false);
  });

  it('returns false when no registered file matches', () => {
    const registry = makeRegistry([
      { fileId: 'f1', path: 'bookmarks.json', enabled: true, watch: true },
      { fileId: 'f2', path: '.bookmarks/shared/other.json', enabled: true, watch: true },
    ]);
    expect(isPathRegistered(registry, '/ws/something-else.json', '/ws')).toBe(false);
  });
});
