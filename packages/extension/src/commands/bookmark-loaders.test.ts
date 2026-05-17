// ABOUTME: Tests for bookmark-loaders' composeFileHiddenPredicate — encodes the
// ABOUTME: "Bullseye trumps UI-hide, registry-disable still wins" precedence rule.

import { describe, it, expect } from 'vitest';
import type {
  BookmarksFileV2,
  WorkspaceRegistryV1,
} from '@agentic-bookmarks/core';
import { composeFileHiddenPredicate } from './bookmark-loaders-helpers';
import type { LoadedFile, LoadedFolder } from './bookmark-loaders';
import type { Visibility } from './bookmark-quickpick-items';

const WS = '/ws';

function makeFile(opts: {
  fileId: string;
  groups?: Array<{ id: string; name: string }>;
  bookmarks?: any[];
}): BookmarksFileV2 {
  return {
    schemaVersion: 2,
    fileId: opts.fileId,
    defaultAnchorType: 'smart',
    groups: opts.groups ?? [{ id: 'gA', name: 'A' }],
    bookmarks: opts.bookmarks ?? [],
  } as any;
}

function makeLoadedFile(opts: {
  fileId: string;
  regPath: string;
  wsRoot?: string;
}): LoadedFile {
  return {
    wsRoot: opts.wsRoot ?? WS,
    dataRoot: '.bookmarks',
    regPath: opts.regPath,
    data: makeFile({ fileId: opts.fileId }),
  };
}

function makeRegistry(files: Array<{
  fileId: string;
  path: string;
  enabled?: boolean;
}>): WorkspaceRegistryV1 {
  return {
    version: 1,
    files: files.map((f) => ({
      fileId: f.fileId,
      path: f.path,
      ...(f.enabled !== undefined && { enabled: f.enabled }),
    })),
    nameIndex: {},
    settings: {
      watchersEnabled: true,
      sortByGroup: false,
      sortByFile: true,
      appearance: {
        showDifferentColors: true,
        showDifferentStyles: true,
      },
    },
  } as any;
}

function makeLoadedFolder(opts: {
  wsRoot?: string;
  files: Array<{ fileId: string; path: string; enabled?: boolean }>;
}): LoadedFolder {
  return {
    wsRoot: opts.wsRoot ?? WS,
    reg: makeRegistry(opts.files),
    dataRoot: '.bookmarks',
  };
}

const VISIBILITY_FILTER_OFF: Visibility = {
  hidden: [],
  focus: null,
  filterEnabled: false,
  searches: [],
};

const VISIBILITY_BULLSEYE: Visibility = {
  hidden: [],
  focus: 'gA',
  filterEnabled: true,
  searches: [],
};

describe('composeFileHiddenPredicate', () => {
  it('returns false when fileId is not in any loaded folder', () => {
    const folders = [makeLoadedFolder({ files: [{ fileId: 'f1', path: 'm.json' }] })];
    const filesData: LoadedFile[] = [];
    const predicate = composeFileHiddenPredicate(
      folders,
      filesData,
      VISIBILITY_FILTER_OFF,
      () => true,
    );
    expect(predicate('missing')).toBe(false);
  });

  it('returns false when isFileHidden(fileId, reg) is false', () => {
    const folders = [makeLoadedFolder({ files: [{ fileId: 'f1', path: 'm.json' }] })];
    const filesData = [makeLoadedFile({ fileId: 'f1', regPath: 'm.json' })];
    const predicate = composeFileHiddenPredicate(
      folders,
      filesData,
      VISIBILITY_FILTER_OFF,
      () => false,
    );
    expect(predicate('f1')).toBe(false);
  });

  it('returns true when reg.files[..].enabled === false (non-Bullseye)', () => {
    const folders = [
      makeLoadedFolder({ files: [{ fileId: 'f1', path: 'm.json', enabled: false }] }),
    ];
    const filesData = [makeLoadedFile({ fileId: 'f1', regPath: 'm.json' })];
    const predicate = composeFileHiddenPredicate(
      folders,
      filesData,
      VISIBILITY_FILTER_OFF,
      () => true,
    );
    expect(predicate('f1')).toBe(true);
  });

  it('returns true when reg.files[..].enabled === false even in Bullseye mode (registry-disable wins)', () => {
    const folders = [
      makeLoadedFolder({ files: [{ fileId: 'f1', path: 'm.json', enabled: false }] }),
    ];
    const filesData = [makeLoadedFile({ fileId: 'f1', regPath: 'm.json' })];
    const predicate = composeFileHiddenPredicate(
      folders,
      filesData,
      VISIBILITY_BULLSEYE,
      () => true,
    );
    expect(predicate('f1')).toBe(true);
  });

  it('returns false in Bullseye mode when file is UI-hidden but registry-enabled', () => {
    const folders = [
      makeLoadedFolder({ files: [{ fileId: 'f1', path: 'm.json', enabled: true }] }),
    ];
    const filesData = [makeLoadedFile({ fileId: 'f1', regPath: 'm.json' })];
    const predicate = composeFileHiddenPredicate(
      folders,
      filesData,
      VISIBILITY_BULLSEYE,
      () => true,
    );
    expect(predicate('f1')).toBe(false);
  });

  it('returns true in non-Bullseye mode when file is UI-hidden and registry-enabled', () => {
    const folders = [
      makeLoadedFolder({ files: [{ fileId: 'f1', path: 'm.json', enabled: true }] }),
    ];
    const filesData = [makeLoadedFile({ fileId: 'f1', regPath: 'm.json' })];
    const predicate = composeFileHiddenPredicate(
      folders,
      filesData,
      VISIBILITY_FILTER_OFF,
      () => true,
    );
    expect(predicate('f1')).toBe(true);
  });
});
