import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import {
  readRegistry,
  readFileV2 as readFileV2Paths,
  editFileV2,
  pathsForDataFile,
  getBookmarksDataRoot,
  type BookmarksFileV2,
  workspaceRelativeToUri,
  resolveIsLocal,
  createAnchor,
  autoRepairCandidate,
  gitHistory,
} from '@agentic-bookmarks/core';
import { updateAnchorState } from './anchorState';
import { getLastKnownLineForAnchor, getFileLinesForDocUri } from './workspace-helpers';
import type { Logger } from './logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BookmarkRepairLookup = {
  anchor: BookmarksFileV2['bookmarks'][number]['anchor'];
  targetRelPath: string;
  workspaceRoot: string;
  targetDocUri: string;
  lastKnownLine: number;
  bookmarksDataFilePath: string;
};

export type AutoRepairResult = {
  status: 'repaired' | 'skipped' | 'failed';
  reason?: string;
  oldLine?: number;
  newLine?: number;
  score?: number;
  debug?: Record<string, unknown>;
};

export type FileMoveRepairResult = {
  status: 'repaired' | 'skipped' | 'failed';
  reason?: string;
  newFilePath?: string;
  newLine?: number;
  score?: number;
  debug?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Dependencies injected from activate()
// ---------------------------------------------------------------------------

export interface RepairDeps {
  workspaceRoot: string;
  log: Logger;
  getLineCacheLength: () => number;
  updateDecorations: () => Promise<void>;
  debouncedCacheSync: () => void;
  refreshTrees: () => void;
}

// ---------------------------------------------------------------------------
// getBookmarkAnchorForRepair
// ---------------------------------------------------------------------------

export async function getBookmarkAnchorForRepair(
  bookmarkId: string,
  workspaceRoot: string,
): Promise<BookmarkRepairLookup | null> {
  try {
    const reg = await readRegistry(workspaceRoot);
    const dataRoot = getBookmarksDataRoot(reg);
    const enabledFiles = reg.files.filter(f => f.enabled !== false);
    for (const rf of enabledFiles) {
      try {
        const filePaths = pathsForDataFile(rf.path, workspaceRoot, dataRoot);
        const file = await readFileV2Paths(filePaths);
        const bookmark = file.bookmarks.find(b => b.id === bookmarkId);
        if (!bookmark) continue;

        const targetUri = bookmark.target.uri.split('#')[0];
        let targetRelPath: string;
        let targetDocUri: string;
        if (targetUri.startsWith('file://')) {
          const absPath = vscode.Uri.parse(targetUri).fsPath;
          targetRelPath = path.relative(workspaceRoot, absPath);
          targetDocUri = vscode.Uri.file(absPath).toString();
        } else {
          targetRelPath = targetUri;
          targetDocUri = workspaceRelativeToUri(targetUri, workspaceRoot);
        }

        return {
          anchor: bookmark.anchor,
          targetRelPath,
          workspaceRoot,
          targetDocUri,
          lastKnownLine: getLastKnownLineForAnchor(bookmark.anchor),
          bookmarksDataFilePath: filePaths.data,
        };
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Registry read failed
  }
  return null;
}

// ---------------------------------------------------------------------------
// applyAutoRepairCandidate
// ---------------------------------------------------------------------------

export async function applyAutoRepairCandidate(
  bookmarkId: string,
  candidateLine: number,
  workspaceRoot: string,
  getLineCacheLength: () => number,
  fileLines?: string[],
): Promise<boolean> {
  try {
    const reg = await readRegistry(workspaceRoot);
    const dataRoot = getBookmarksDataRoot(reg);
    const enabledFiles = reg.files.filter(f => f.enabled !== false);
    for (const rf of enabledFiles) {
      try {
        const filePaths = pathsForDataFile(rf.path, workspaceRoot, dataRoot);
        const file = await readFileV2Paths(filePaths);
        const bookmark = file.bookmarks.find(b => b.id === bookmarkId);
        if (bookmark) {
          let lines: string[];
          if (fileLines) {
            lines = fileLines;
          } else {
            // Read current file lines from target
            const targetUri = bookmark.target.uri.split('#')[0];
            let targetFsPath: string;
            if (targetUri.startsWith('file://')) {
              targetFsPath = vscode.Uri.parse(targetUri).fsPath;
            } else {
              const absoluteUri = workspaceRelativeToUri(targetUri, workspaceRoot);
              targetFsPath = vscode.Uri.parse(absoluteUri).fsPath;
            }
            const fileContent = await fsp.readFile(targetFsPath, 'utf-8');
            lines = fileContent.split('\n');
          }
          const isLocal = resolveIsLocal(file, filePaths.data, workspaceRoot);
          const blankLinesUseSupport = vscode.workspace.getConfiguration('agenticBookmarks.anchors').get('blankLinesUseSupport', true);
          const newAnchor = createAnchor('smart', lines, candidateLine, {
            isLocal,
            blankLinesUseSupport,
            lineCacheLength: getLineCacheLength(),
          });
          await editFileV2(filePaths, (f: BookmarksFileV2) => {
            const b = f.bookmarks.find(bk => bk.id === bookmarkId);
            if (b) {
              b.anchor = newAnchor;
            }
          });
          return true;
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Registry read failed
  }
  return false;
}

// ---------------------------------------------------------------------------
// applyFileMoveRepairCandidate
// ---------------------------------------------------------------------------

export async function applyFileMoveRepairCandidate(
  bookmarkId: string,
  newRelPath: string,
  candidateLine: number,
  workspaceRoot: string,
  getLineCacheLength: () => number,
): Promise<boolean> {
  try {
    const reg = await readRegistry(workspaceRoot);
    const dataRoot = getBookmarksDataRoot(reg);
    const enabledFiles = reg.files.filter(f => f.enabled !== false);
    for (const rf of enabledFiles) {
      try {
        const filePaths = pathsForDataFile(rf.path, workspaceRoot, dataRoot);
        const file = await readFileV2Paths(filePaths);
        const bookmark = file.bookmarks.find(b => b.id === bookmarkId);
        if (bookmark) {
          const newAbsPath = path.join(workspaceRoot, newRelPath);
          const fileContent = await fsp.readFile(newAbsPath, 'utf-8');
          const fileLines = fileContent.split('\n');
          const isLocal = resolveIsLocal(file, filePaths.data, workspaceRoot);
          const blankLinesUseSupport = vscode.workspace.getConfiguration('agenticBookmarks.anchors').get('blankLinesUseSupport', true);
          const newAnchor = createAnchor('smart', fileLines, candidateLine, {
            isLocal,
            blankLinesUseSupport,
            lineCacheLength: getLineCacheLength(),
          });

          await editFileV2(filePaths, (f: BookmarksFileV2) => {
            const b = f.bookmarks.find(bk => bk.id === bookmarkId);
            if (b) {
              b.target.uri = newRelPath;
              b.anchor = newAnchor;
            }
          });
          return true;
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Registry read failed
  }
  return false;
}

// ---------------------------------------------------------------------------
// runAutoRepairForBookmark
// ---------------------------------------------------------------------------

export async function runAutoRepairForBookmark(
  bookmarkId: string,
  deps: RepairDeps,
  options?: { ignoreAutoRepairSetting?: boolean },
): Promise<AutoRepairResult> {
  const { workspaceRoot, log, getLineCacheLength, updateDecorations, debouncedCacheSync, refreshTrees } = deps;

  if (!options?.ignoreAutoRepairSetting) {
    const enabled = vscode.workspace.getConfiguration('agenticBookmarks').get('autoRepair', true);
    if (!enabled) {
      return { status: 'skipped', reason: 'agenticBookmarks.autoRepair is disabled' };
    }
  }

  const bookmarkData = await getBookmarkAnchorForRepair(bookmarkId, workspaceRoot);
  if (!bookmarkData) {
    return { status: 'failed', reason: 'bookmark not found' };
  }

  const fileLines = await getFileLinesForDocUri(bookmarkData.targetDocUri);
  if (!fileLines) {
    return { status: 'failed', reason: 'target file not readable' };
  }

  try {
    const autoRepairEnabled = vscode.workspace.getConfiguration('agenticBookmarks').get('autoRepair', true);
    const canUseGit = vscode.workspace.getConfiguration('agenticBookmarks').get('autoRepairCanUseGit', true);
    log.debug(
      `[autoRepairDebug] Manual repair start bookmark=${bookmarkId} file=${bookmarkData.targetRelPath} autoRepair=${autoRepairEnabled} autoRepairCanUseGit=${canUseGit}`
    );
    const result = await autoRepairCandidate.findRepairCandidate(
      bookmarkData.anchor,
      bookmarkId,
      bookmarkData.workspaceRoot,
      bookmarkData.targetRelPath,
      fileLines,
      { canUseGit, bookmarksDataFilePath: bookmarkData.bookmarksDataFilePath },
    );
    if (result.debug) {
      log.trace(() => `[autoRepairDebug] Candidate search result for ${bookmarkId}: ${JSON.stringify(result.debug)}`);
    }

    if (result.status === 'skipped' || !result.candidate) {
      return {
        status: 'skipped',
        reason: result.reason || 'no repair candidate',
        debug: result.debug as Record<string, unknown> | undefined,
      };
    }

    const applied = await applyAutoRepairCandidate(
      bookmarkId,
      result.candidate.candidateLine,
      workspaceRoot,
      getLineCacheLength,
      fileLines,
    );

    if (!applied) {
      return {
        status: 'failed',
        reason: 'failed to apply repair candidate',
        debug: result.debug as Record<string, unknown> | undefined,
      };
    }

    updateAnchorState(bookmarkData.targetDocUri, bookmarkId, result.candidate.candidateLine, 'valid');
    refreshTrees();
    debouncedCacheSync();
    await updateDecorations();

    return {
      status: 'repaired',
      oldLine: bookmarkData.lastKnownLine,
      newLine: result.candidate.candidateLine,
      score: result.candidate.score,
      debug: result.debug as Record<string, unknown> | undefined,
    };
  } catch (err: any) {
    return { status: 'failed', reason: err?.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// runFileMoveRepairForBookmark
// ---------------------------------------------------------------------------

export async function runFileMoveRepairForBookmark(
  bookmarkId: string,
  wsRoot: string,
  deps: RepairDeps,
): Promise<FileMoveRepairResult> {
  const { workspaceRoot, log, getLineCacheLength, updateDecorations, debouncedCacheSync, refreshTrees } = deps;

  const bookmarkData = await getBookmarkAnchorForRepair(bookmarkId, workspaceRoot);
  if (!bookmarkData) {
    return { status: 'failed', reason: 'bookmark not found' };
  }

  const canUseGit = vscode.workspace.getConfiguration('agenticBookmarks').get('autoRepairCanUseGit', true);
  const canCrossFileSearch = vscode.workspace.getConfiguration('agenticBookmarks').get('autoRepairCanCrossFileSearch', false);

  if (!canUseGit) {
    return { status: 'skipped', reason: 'autoRepairCanUseGit is disabled' };
  }

  // Read rename detection settings from registry
  const renameSettings = await (async () => {
    try {
      const reg = await readRegistry(workspaceRoot);
      return {
        enableRenameDetection: reg.settings?.anchors?.enableRenameDetection ?? true,
        renameDetectionThreshold: reg.settings?.anchors?.renameDetectionThreshold ?? 70,
      };
    } catch {
      return { enableRenameDetection: true, renameDetectionThreshold: 70 };
    }
  })();

  try {
    const result = await autoRepairCandidate.findFileMoveRepairCandidate(
      bookmarkData.anchor,
      bookmarkId,
      bookmarkData.workspaceRoot,
      bookmarkData.targetRelPath,
      {
        canUseGit,
        canCrossFileSearch,
        enableRenameDetection: renameSettings.enableRenameDetection,
        renameDetectionThreshold: renameSettings.renameDetectionThreshold,
        bookmarksDataFilePath: bookmarkData.bookmarksDataFilePath,
        readFileLines: async (repoRelPath: string) => {
          try {
            const absPath = path.join(bookmarkData.workspaceRoot, repoRelPath);
            const content = await fsp.readFile(absPath, 'utf-8');
            return content.split('\n');
          } catch {
            return null;
          }
        },
        getAddedLinesMap: async (baselineCommit: string) => {
          try {
            const validation = await gitHistory.validateGitContext(bookmarkData.workspaceRoot);
            const diffs = await gitHistory.getDiffBetweenCommits(validation.repoRoot, {
              fromCommit: baselineCommit,
              toCommit: 'HEAD',
            });
            const map = new Map<string, { lineNumber: number; content: string }[]>();
            for (const fileDiff of diffs) {
              const fp = fileDiff.newPath;
              if (!fp || fp === bookmarkData.targetRelPath) continue;
              const addedLines: { lineNumber: number; content: string }[] = [];
              for (const hunk of fileDiff.hunks) {
                for (const line of hunk.lines) {
                  if (line.type === 'addition' && line.newLineNumber !== undefined) {
                    addedLines.push({
                      lineNumber: line.newLineNumber - 1,
                      content: line.content,
                    });
                  }
                }
              }
              if (addedLines.length > 0) {
                map.set(fp, addedLines);
              }
            }
            return map;
          } catch {
            return null;
          }
        },
      },
    );

    if (result.debug) {
      log.trace(() => `[autoRepairDebug] File-move repair for ${bookmarkId}: ${JSON.stringify(result.debug)}`);
    }

    if (result.status === 'skipped' || !result.candidate) {
      return {
        status: 'skipped',
        reason: result.reason || 'no file-move repair candidate',
        debug: result.debug as Record<string, unknown> | undefined,
      };
    }

    const applied = await applyFileMoveRepairCandidate(
      bookmarkId,
      result.candidate.newFilePath,
      result.candidate.candidateLine,
      workspaceRoot,
      getLineCacheLength,
    );

    if (!applied) {
      return { status: 'failed', reason: 'failed to apply file-move repair' };
    }

    const newDocUri = workspaceRelativeToUri(result.candidate.newFilePath, wsRoot);
    updateAnchorState(newDocUri, bookmarkId, result.candidate.candidateLine, 'valid');
    refreshTrees();
    debouncedCacheSync();
    await updateDecorations();

    return {
      status: 'repaired',
      newFilePath: result.candidate.newFilePath,
      newLine: result.candidate.candidateLine,
      score: result.candidate.score,
      debug: result.debug as Record<string, unknown> | undefined,
    };
  } catch (err: any) {
    return { status: 'failed', reason: err?.message || String(err) };
  }
}
