// ABOUTME: Unit tests for the dirty-buffer fix in applyAutoRepairCandidate (SML-1576).
// ABOUTME: Verifies that when fileLines are provided, the anchor is created from those lines
// ABOUTME: instead of re-reading the file from disk, preventing wrong-line repairs on dirty buffers.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks — accessible inside vi.mock factory closures.
const mockFspReadFile = vi.hoisted(() => vi.fn());
const mockCreateAnchor = vi.hoisted(() => vi.fn());
const mockGetFileLinesForDocUri = vi.hoisted(() => vi.fn());
const mockFindRepairCandidate = vi.hoisted(() => vi.fn());
const mockEditFileV2 = vi.hoisted(() => vi.fn());

vi.mock('node:fs/promises', () => ({
  readFile: mockFspReadFile,
}));

vi.mock('vscode', () => ({
  Uri: {
    parse: vi.fn((uri: string) => ({
      fsPath: uri.replace('file://', ''),
      toString: () => uri,
    })),
    file: vi.fn((fsPath: string) => ({
      fsPath,
      toString: () => `file://${fsPath}`,
    })),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, def: any) => def),
    })),
  },
}));

vi.mock('@agentic-bookmarks/core', () => ({
  readRegistry: vi.fn(async () => ({
    files: [{ path: 'default.json', enabled: true }],
    settings: {},
  })),
  readFileV2: vi.fn(async () => ({
    bookmarks: [{
      id: 'b1',
      anchor: { kind: 'smart', lastUpdatedLine: 0 },
      target: { uri: 'file:///ws/src/file.ts' },
    }],
    groups: [],
  })),
  editFileV2: mockEditFileV2,
  pathsForDataFile: vi.fn(() => ({ data: '/ws/.bookmarks/local/default.json' })),
  getBookmarksDataRoot: vi.fn(() => '.bookmarks/local'),
  workspaceRelativeToUri: vi.fn((rel: string, root: string) => `file://${root}/${rel}`),
  resolveIsLocal: vi.fn(() => true),
  createAnchor: mockCreateAnchor,
  autoRepairCandidate: {
    findRepairCandidate: mockFindRepairCandidate,
    findFileMoveRepairCandidate: vi.fn(),
  },
  gitHistory: {
    validateGitContext: vi.fn(),
    getDiffBetweenCommits: vi.fn(),
  },
  FLEX_REPAIR_WINDOW: 100,
}));

vi.mock('./workspace-helpers', () => ({
  getFileLinesForDocUri: mockGetFileLinesForDocUri,
  getLastKnownLineForAnchor: vi.fn(() => 3),
}));

import { applyAutoRepairCandidate, runAutoRepairForBookmark } from './anchor-repair-helpers';
import type { RepairDeps } from './anchor-repair-helpers';

const WORKSPACE_ROOT = '/ws';
const DISK_LINES = ['disk-line-0', 'disk-target-line', 'disk-line-2'];
const BUFFER_LINES = ['buffer-line-0', 'buffer-target-line', 'buffer-line-2'];
const MOCK_ANCHOR = { kind: 'smart', lastUpdatedLine: 1 };

function makeDeps(): RepairDeps {
  return {
    workspaceRoot: WORKSPACE_ROOT,
    log: { debug: vi.fn(), trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    getLineCacheLength: () => 10,
    updateDecorations: vi.fn(async () => {}),
    debouncedCacheSync: vi.fn(),
    refreshTrees: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateAnchor.mockReturnValue(MOCK_ANCHOR);
  mockEditFileV2.mockImplementation(async (_paths: any, callback: any) => {
    callback({
      bookmarks: [{ id: 'b1', anchor: { kind: 'smart' }, target: { uri: 'file:///ws/src/file.ts' } }],
      groups: [],
    });
  });
  mockFspReadFile.mockResolvedValue(DISK_LINES.join('\n'));
  mockGetFileLinesForDocUri.mockResolvedValue(BUFFER_LINES);
});

describe('applyAutoRepairCandidate', () => {
  it('uses provided fileLines and does not read from disk', async () => {
    const result = await applyAutoRepairCandidate('b1', 1, WORKSPACE_ROOT, () => 10, BUFFER_LINES);

    expect(result).toBe(true);
    expect(mockFspReadFile).not.toHaveBeenCalled();
    expect(mockCreateAnchor).toHaveBeenCalledWith('smart', BUFFER_LINES, 1, expect.any(Object));
  });

  it('reads from disk when fileLines is not provided', async () => {
    const result = await applyAutoRepairCandidate('b1', 1, WORKSPACE_ROOT, () => 10);

    expect(result).toBe(true);
    expect(mockFspReadFile).toHaveBeenCalled();
    expect(mockCreateAnchor).toHaveBeenCalledWith('smart', DISK_LINES, 1, expect.any(Object));
  });
});

describe('runAutoRepairForBookmark', () => {
  it('passes buffer lines to anchor creation, not disk lines', async () => {
    mockFindRepairCandidate.mockResolvedValue({
      status: 'candidate',
      candidate: { candidateLine: 1, score: 0.95, tracedFromCommit: 'abc123', bookmarkId: 'b1' },
    });

    const result = await runAutoRepairForBookmark('b1', makeDeps(), { ignoreAutoRepairSetting: true });

    expect(result.status).toBe('repaired');
    expect(mockFspReadFile).not.toHaveBeenCalled();
    expect(mockCreateAnchor).toHaveBeenCalledWith('smart', BUFFER_LINES, 1, expect.any(Object));
  });

  it('returns skipped when no repair candidate found', async () => {
    mockFindRepairCandidate.mockResolvedValue({
      status: 'skipped',
      reason: 'no candidate found',
    });

    const result = await runAutoRepairForBookmark('b1', makeDeps(), { ignoreAutoRepairSetting: true });

    expect(result.status).toBe('skipped');
    expect(mockFspReadFile).not.toHaveBeenCalled();
    expect(mockCreateAnchor).not.toHaveBeenCalled();
  });

  it('returns failed when getFileLinesForDocUri returns null', async () => {
    mockGetFileLinesForDocUri.mockResolvedValue(null);

    const result = await runAutoRepairForBookmark('b1', makeDeps(), { ignoreAutoRepairSetting: true });

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('target file not readable');
  });
});
