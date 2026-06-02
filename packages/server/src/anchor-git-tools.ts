/**
 * Anchor Git Tools - MCP tool orchestration for anchor repair
 *
 * Composite and utility tool logic. Each function takes explicit
 * parameters and returns structured results for MCP responses.
 */

import {
  gitHistory,
  anchorRepair,
  shiftValidation,
  anchorForensics,
  comments,
  type Bookmark,
} from '@agentic-bookmarks/core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { detectInlinedConstruct } from './inline-detection.js';

const {
  validateShiftDiagnosis,
} = shiftValidation;

/**
 * Find the historical commit for a bookmark's anchor via JSON blame.
 * Uses anchorForensics.findBaselineCommit to find the baseline commit
 * from the bookmarks data file git history.
 */
export async function findHistoricalCommit(
  repoPath: string,
  targetRelPath: string,
  lastUpdatedLine: number,
  bookmarksDataFilePath: string,
  bookmarkId: string,
  lineCache: string,
  options?: { enableBaselinePickaxe?: boolean },
): Promise<{
  commit: string;
  commitDate: string;
  commitMessage: string;
  baselineSource: anchorForensics.BaselineSource;
} | { error: string; detail?: Record<string, unknown> }> {
  try {
    const validation = await gitHistory.validateGitContext(repoPath);
    if (!validation.valid) {
      return { error: 'Not a git repository' };
    }

    const baseline = await anchorForensics.findBaselineCommit(
      validation.repoRoot,
      bookmarksDataFilePath,
      bookmarkId,
      targetRelPath,
      lastUpdatedLine,
      lineCache,
      { enableBaselinePickaxe: options?.enableBaselinePickaxe },
    );

    if (baseline.commit === null) {
      return {
        error: 'Could not find baseline commit for anchor',
        detail: {
          strategiesAttempted: baseline.tried,
          lastUpdatedLine,
          lineCachePreview: baseline.lineCachePreview,
          commitSearchDepth: 20,
          hint: 'The anchor may predate the commit search window. The agent can search the current codebase for the lineCache text as a fallback.',
        },
      };
    }

    // Get commit info for the baseline commit using log (safe for root commits)
    const commits = await gitHistory.getCommitLog(validation.repoRoot, {
      maxCount: 1,
      until: baseline.commit,
    });

    const commitInfo = commits[0];
    return {
      commit: baseline.commit,
      commitDate: commitInfo ? commitInfo.date.toISOString() : new Date().toISOString(),
      commitMessage: commitInfo ? commitInfo.subject : '',
      baselineSource: baseline.source,
    };
  } catch (err: any) {
    return { error: err?.message || String(err) };
  }
}

/**
 * Extract lastUpdatedLine from any anchor type.
 */
export function getLastUpdatedLine(anchor: Bookmark['anchor']): number {
  if ('lastUpdatedLine' in anchor) {
    return (anchor as any).lastUpdatedLine;
  }
  if ('line' in anchor) {
    return (anchor as any).line;
  }
  return 0;
}

/**
 * Extract lineCache from an anchor (if available).
 */
export function getLineCache(anchor: Bookmark['anchor']): string | undefined {
  if ('lineCache' in anchor) {
    return (anchor as any).lineCache;
  }
  return undefined;
}

/**
 * Extract context from an anchor (if available).
 */
export function getAnchorContext(anchor: Bookmark['anchor']): {
  contextBefore: string[];
  contextAfter: string[];
} {
  return {
    contextBefore: (anchor as any).contextBefore ?? [],
    contextAfter: (anchor as any).contextAfter ?? [],
  };
}

/**
 * Build a window of lines around a target line.
 */
export function buildLineWindow(
  lines: string[],
  centerLine: number,
  windowSize: number = 20,
): { startLine: number; endLine: number; lines: string[] } {
  const startLine = Math.max(0, centerLine - windowSize);
  const endLine = Math.min(lines.length - 1, centerLine + windowSize);
  return {
    startLine,
    endLine,
    lines: lines.slice(startLine, endLine + 1),
  };
}

// ============================================================================
// Composite Tool: getHistoricalContext
// ============================================================================

export async function handleGetHistoricalContext(
  bookmark: Bookmark,
  repoPath: string,
  targetRelPath: string,
  bookmarksDataFilePath: string,
  options?: { enableBaselinePickaxe?: boolean },
): Promise<Record<string, unknown>> {
  const lastUpdatedLine = getLastUpdatedLine(bookmark.anchor);
  const lineCache = getLineCache(bookmark.anchor) ?? '';

  const commitInfo = await findHistoricalCommit(
    repoPath, targetRelPath, lastUpdatedLine,
    bookmarksDataFilePath, bookmark.id, lineCache,
    { enableBaselinePickaxe: options?.enableBaselinePickaxe },
  );
  if ('error' in commitInfo) {
    return { success: false, error: commitInfo.error, ...('detail' in commitInfo ? { detail: commitInfo.detail } : {}) };
  }

  try {
    const validation = await gitHistory.validateGitContext(repoPath);
    const fileResult = await gitHistory.getFileAtRevision(validation.repoRoot, {
      revision: commitInfo.commit,
      filePath: targetRelPath,
    });

    const window = buildLineWindow(fileResult.lines, lastUpdatedLine, 20);

    return {
      success: true,
      bookmarkId: bookmark.id,
      commit: commitInfo.commit,
      commitDate: commitInfo.commitDate,
      commitMessage: commitInfo.commitMessage,
      baselineSource: commitInfo.baselineSource,
      historicalContent: window,
      anchorLineContent: fileResult.lines[lastUpdatedLine] ?? null,
    };
  } catch (err: any) {
    if (err?.constructor?.name === 'FileNotFoundAtRevisionError') {
      return { success: false, error: `File not found at revision ${commitInfo.commit}` };
    }
    return { success: false, error: err?.message || String(err) };
  }
}

// ============================================================================
// Composite Tool: getFileDiff
// ============================================================================

export async function handleGetFileDiff(
  bookmark: Bookmark,
  repoPath: string,
  targetRelPath: string,
  currentFileLines: string[],
  bookmarksDataFilePath: string,
  options?: { enableBaselinePickaxe?: boolean },
): Promise<Record<string, unknown>> {
  const lastUpdatedLine = getLastUpdatedLine(bookmark.anchor);
  const lineCache = getLineCache(bookmark.anchor) ?? '';

  const commitInfo = await findHistoricalCommit(
    repoPath, targetRelPath, lastUpdatedLine,
    bookmarksDataFilePath, bookmark.id, lineCache,
    { enableBaselinePickaxe: options?.enableBaselinePickaxe },
  );
  if ('error' in commitInfo) {
    return { success: false, error: commitInfo.error, ...('detail' in commitInfo ? { detail: commitInfo.detail } : {}) };
  }

  try {
    const validation = await gitHistory.validateGitContext(repoPath);
    const diffs = await gitHistory.getDiffBetweenCommits(validation.repoRoot, {
      fromCommit: commitInfo.commit,
      toCommit: 'HEAD',
      filePath: targetRelPath,
    });

    const anchorInfo: anchorRepair.AnchorInfo = {
      kind: bookmark.anchor.kind,
      lineCache: getLineCache(bookmark.anchor),
      ...getAnchorContext(bookmark.anchor),
      lastUpdatedLine,
    };

    const diagnosis = anchorRepair.diagnoseDiff(anchorInfo, diffs, currentFileLines);

    // SML-1465: a deleted construct (setter/getter/method/util fn) whose declaration
    // line has no exact/fuzzy match yields `no_match` — but its body may have been
    // inlined at a call site that is right here in the diff. Upgrade that bare
    // no_match to a more actionable `inlined` diagnosis pointing at the call site(s).
    // Only fires on no_match, so every other diagnosis path is unchanged.
    let resolvedDiagnosis: { diagnosis: string; detail: unknown } = diagnosis;
    if (diagnosis.diagnosis === 'no_match' && diffs.length > 0) {
      const inlined = detectInlinedConstruct(
        { lineCache: getLineCache(bookmark.anchor), lastUpdatedLine },
        diffs[0],
        currentFileLines,
      );
      if (inlined) resolvedDiagnosis = inlined;
    }

    // Supplementary: detect if the file was renamed/moved
    let fileMovedResults: Record<string, unknown> | undefined;
    try {
      const renameResult = await gitHistory.detectFileRename(validation.repoRoot, {
        filePath: targetRelPath,
        sinceCommit: commitInfo.commit,
      });
      if (renameResult.renamed) {
        fileMovedResults = {
          detected: true,
          oldPath: renameResult.oldPath,
          newPath: renameResult.newPath,
          renameCommit: renameResult.renameCommit,
          renameCommitSubject: renameResult.renameCommitSubject,
          note: 'Supplementary data: git detected a file rename. This does not override the diagnosis above. Verify by checking if the anchor content exists in the new file.',
        };
      }
    } catch {
      // File move detection is optional — don't fail the main diagnosis
    }

    if (diagnosis.diagnosis === 'shifted') {
      const shiftVal = await validateShiftDiagnosis(
        {
          lineCache: getLineCache(bookmark.anchor) ?? '',
          lastUpdatedLine: getLastUpdatedLine(bookmark.anchor),
          ...getAnchorContext(bookmark.anchor),
        },
        commitInfo.commit,
        diagnosis.detail.newLine,
        validation.repoRoot,
        targetRelPath,
        currentFileLines,
      );

      if (!shiftVal.accepted) {
        const fallbackDiagnosis = anchorRepair.diagnoseDiff(
          anchorInfo,
          diffs,
          currentFileLines,
          { skipShiftTier: true }
        );

        return {
          success: true,
          bookmarkId: bookmark.id,
          fromCommit: commitInfo.commit,
          baselineSource: commitInfo.baselineSource,
          ...fallbackDiagnosis,
          shiftValidation: shiftVal,
          ...(fileMovedResults ? { fileMovedResults } : {}),
        };
      }

      return {
        success: true,
        bookmarkId: bookmark.id,
        fromCommit: commitInfo.commit,
        baselineSource: commitInfo.baselineSource,
        ...diagnosis,
        shiftValidation: shiftVal,
        ...(fileMovedResults ? { fileMovedResults } : {}),
      };
    }

    return {
      success: true,
      bookmarkId: bookmark.id,
      fromCommit: commitInfo.commit,
      baselineSource: commitInfo.baselineSource,
      ...resolvedDiagnosis,
      ...(fileMovedResults ? { fileMovedResults } : {}),
    };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

// ============================================================================
// Composite Tool: searchMovedCode
// ============================================================================

export async function handleSearchMovedCode(
  bookmark: Bookmark,
  repoPath: string,
  targetRelPath: string,
  bookmarksDataFilePath: string,
  options?: { enableBaselinePickaxe?: boolean },
): Promise<Record<string, unknown>> {
  const lineCache = getLineCache(bookmark.anchor);
  if (!lineCache) {
    return { success: false, error: 'Anchor has no content to search for' };
  }

  const lastUpdatedLine = getLastUpdatedLine(bookmark.anchor);
  const commitInfo = await findHistoricalCommit(
    repoPath, targetRelPath, lastUpdatedLine,
    bookmarksDataFilePath, bookmark.id, lineCache,
    { enableBaselinePickaxe: options?.enableBaselinePickaxe },
  );
  if ('error' in commitInfo) {
    return { success: false, error: commitInfo.error, ...('detail' in commitInfo ? { detail: commitInfo.detail } : {}) };
  }

  try {
    const validation = await gitHistory.validateGitContext(repoPath);

    // Get combined diff from baseline to HEAD — only addition lines are
    // candidates for cross-file moves (pre-existing lines are not moves).
    const fileDiffs = await gitHistory.getDiffBetweenCommits(
      validation.repoRoot,
      { fromCommit: commitInfo.commit, toCommit: 'HEAD' },
    );

    // Build map of file → added lines, excluding the anchor's own target file
    const addedLinesMap = new Map<string, Array<{ lineNumber: number; content: string }>>();
    for (const fileDiff of fileDiffs) {
      const filePath = fileDiff.newPath;
      if (!filePath || filePath === targetRelPath) continue;

      const addedLines: Array<{ lineNumber: number; content: string }> = [];
      for (const hunk of fileDiff.hunks) {
        for (const line of hunk.lines) {
          if (line.type === 'addition' && line.newLineNumber !== undefined) {
            // Convert 1-based diff coordinates to 0-based
            addedLines.push({
              lineNumber: line.newLineNumber - 1,
              content: line.content,
            });
          }
        }
      }

      if (addedLines.length > 0) {
        addedLinesMap.set(filePath, addedLines);
      }
    }

    const language = comments.getLanguageForPath(targetRelPath) ?? undefined;
    const { contextBefore: anchorCtxBefore, contextAfter: anchorCtxAfter } = getAnchorContext(bookmark.anchor);

    const result = anchorRepair.searchForMovedCode(lineCache, addedLinesMap, {
      language,
      contextBefore: anchorCtxBefore,
      contextAfter: anchorCtxAfter,
    });

    // Lazy file reads: populate context and contextScore for matches + fuzzyHints
    const hasContext = anchorCtxBefore.length > 0 || anchorCtxAfter.length > 0;

    // Collect all items (matches + fuzzyHints) that need file reads, grouped by file
    const allItems = [...result.matches, ...(result.fuzzyHints ?? [])];
    const itemsByFile = new Map<string, typeof allItems>();
    for (const item of allItems) {
      const existing = itemsByFile.get(item.file) ?? [];
      existing.push(item);
      itemsByFile.set(item.file, existing);
    }

    for (const [filePath, fileItems] of itemsByFile) {
      try {
        const absPath = path.join(validation.repoRoot, filePath);
        const content = await fs.readFile(absPath, 'utf-8');
        const fileLines = content.split('\n');

        for (const item of fileItems) {
          // Fill in surrounding context
          item.context = anchorRepair.extractContext(fileLines, item.line, 3);

          // Compute context score if anchor has context
          if (hasContext) {
            item.contextScore = shiftValidation.contextMatchScoreAtLine(
              fileLines, item.line, anchorCtxBefore, anchorCtxAfter,
            );
          }
        }
      } catch {
        // File may have been deleted since diff was computed, skip context
      }
    }

    // Re-sort matches after context scores are populated
    if (hasContext) {
      result.matches.sort((a, b) => {
        if (a.matchType !== b.matchType) return a.matchType === 'exact' ? -1 : 1;
        const csA = a.contextScore ?? -1;
        const csB = b.contextScore ?? -1;
        if (csA !== csB) return csB - csA;
        return (b.similarity ?? 1) - (a.similarity ?? 1);
      });
    }

    // Re-sort fuzzyHints after context scores are populated
    if (result.fuzzyHints?.length) {
      result.fuzzyHints.sort((a, b) => {
        const csA = a.contextScore ?? -1;
        const csB = b.contextScore ?? -1;
        if (csA !== csB) return csB - csA;
        return (b.similarity ?? 1) - (a.similarity ?? 1);
      });
    }

    return {
      success: true,
      bookmarkId: bookmark.id,
      baselineSource: commitInfo.baselineSource,
      ...result,
      fuzzyHints: result.fuzzyHints?.length
        ? result.fuzzyHints.map(m => ({
            file: m.file,
            line: m.line,
            matchType: m.matchType,
            similarity: m.similarity,
            content: m.content,
            context: m.context,
            contextScore: m.contextScore,
          }))
        : undefined,
      fuzzyHintsNote: result.fuzzyHints?.length
        ? 'Fuzzy hints are approximate matches based on shared tokens or surrounding context. You must scrutinize these carefully — they may be unrelated code.'
        : undefined,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

// ============================================================================
// Composite Tool: traceLineHistory
// ============================================================================

const MAX_HUNK_EXCERPT_LINES = 40;

/**
 * Extract a deleted hunk snippet from the patch where a line was deleted.
 * Finds the FileDiff for the target file in the patch, then locates the hunk
 * containing the deleted line and formats it as a unified diff excerpt.
 *
 * @param patch - The CommitPatch where deletion occurred
 * @param targetRelPath - Relative path of the target file
 * @param deletedLineNumber - The 1-based line number that was deleted (in the old file)
 * @returns The hunk snippet or null if it cannot be extracted
 */
function extractDeletedHunk(
  patch: { diff: Array<{ oldPath: string | null; newPath: string | null; hunks: Array<{ oldStart: number; oldCount: number; newStart: number; newCount: number; lines: Array<{ type: string; content: string }> }> }> },
  targetRelPath: string,
  deletedLineNumber: number,
): { oldRange: { start: number; count: number }; newRange: { start: number; count: number }; excerpt: string } | null {
  // Find the FileDiff for the target file
  const fileDiff = patch.diff.find(d => d.oldPath === targetRelPath || d.newPath === targetRelPath);
  if (!fileDiff) return null;

  // Find the hunk containing the deleted line
  for (const hunk of fileDiff.hunks) {
    const hunkEnd = hunk.oldStart + hunk.oldCount;
    if (deletedLineNumber >= hunk.oldStart && deletedLineNumber < hunkEnd) {
      // Format hunk lines as unified diff excerpt
      const lines = hunk.lines.map(l => {
        if (l.type === 'addition') return `+${l.content}`;
        if (l.type === 'deletion') return `-${l.content}`;
        return ` ${l.content}`;
      });

      let excerpt: string;
      if (lines.length <= MAX_HUNK_EXCERPT_LINES) {
        excerpt = lines.join('\n');
      } else {
        // Center on the deleted line within the hunk
        // Find the index of the deleted line in the hunk's line list
        let deletedIdx = 0;
        let oldLine = hunk.oldStart;
        for (let i = 0; i < hunk.lines.length; i++) {
          if (hunk.lines[i].type !== 'addition') {
            if (oldLine === deletedLineNumber) {
              deletedIdx = i;
              break;
            }
            oldLine++;
          }
        }

        const half = Math.floor(MAX_HUNK_EXCERPT_LINES / 2);
        let start = Math.max(0, deletedIdx - half);
        let end = Math.min(lines.length, start + MAX_HUNK_EXCERPT_LINES);
        // Adjust start if end hit the boundary
        start = Math.max(0, end - MAX_HUNK_EXCERPT_LINES);

        const sliced = lines.slice(start, end);
        if (start > 0) sliced.unshift('...');
        if (end < lines.length) sliced.push('...');
        excerpt = sliced.join('\n');
      }

      return {
        oldRange: { start: hunk.oldStart, count: hunk.oldCount },
        newRange: { start: hunk.newStart, count: hunk.newCount },
        excerpt,
      };
    }
  }

  return null;
}

export async function handleTraceLineHistory(
  bookmark: Bookmark,
  repoPath: string,
  targetRelPath: string,
  currentFileLines: string[],
  bookmarksDataFilePath: string,
  options?: { enableBaselinePickaxe?: boolean },
): Promise<Record<string, unknown>> {
  const lastUpdatedLine = getLastUpdatedLine(bookmark.anchor);
  const lineCache = getLineCache(bookmark.anchor) ?? '';

  const commitInfo = await findHistoricalCommit(
    repoPath, targetRelPath, lastUpdatedLine,
    bookmarksDataFilePath, bookmark.id, lineCache,
    { enableBaselinePickaxe: options?.enableBaselinePickaxe },
  );
  if ('error' in commitInfo) {
    return { success: false, error: commitInfo.error, ...('detail' in commitInfo ? { detail: commitInfo.detail } : {}) };
  }

  try {
    const validation = await gitHistory.validateGitContext(repoPath);
    const patches = await gitHistory.getPatchSequence(validation.repoRoot, {
      fromCommit: commitInfo.commit,
      toCommit: 'HEAD',
      filePath: targetRelPath,
    });

    if (patches.length === 0) {
      return {
        success: true,
        bookmarkId: bookmark.id,
        originalLine: lastUpdatedLine,
        fromCommit: commitInfo.commit,
        baselineSource: commitInfo.baselineSource,
        result: { status: 'no_history', explanation: 'No commits found between anchor commit and HEAD' },
      };
    }

    // traceLineThroughPatches uses diff-style (1-based) line coordinates.
    // Anchors are 0-based, so convert at the boundary and convert back for output.
    const traces = gitHistory
      .traceLineThroughPatches(patches, targetRelPath, lastUpdatedLine + 1)
      .map(t => {
        if (t.lineNumber === undefined) return t;
        const converted = t.lineNumber - 1;
        if (converted < 0) {
          return { ...t, lineNumber: undefined };
        }
        return { ...t, lineNumber: converted };
      });

    // Find final status
    const lastTrace = traces[traces.length - 1];
    if (!lastTrace) {
      return {
        success: true,
        bookmarkId: bookmark.id,
        originalLine: lastUpdatedLine,
        fromCommit: commitInfo.commit,
        baselineSource: commitInfo.baselineSource,
        result: { status: 'no_history', explanation: 'Trace produced no results' },
      };
    }

    if (lastTrace.status === 'deleted') {
      // Find the commit where the line was deleted
      const deletedIdx = traces.findIndex(t => t.status === 'deleted');
      const deletedTrace = traces[deletedIdx];
      const deletedPatch = patches[deletedIdx];
      const priorLine = deletedIdx > 0 ? traces[deletedIdx - 1].lineNumber : undefined;

      // Extract the hunk snippet from the patch where deletion occurred.
      // The trace uses 0-based line numbers (converted above), but the patch
      // hunks use 1-based diff coordinates. We need the 1-based line number
      // to locate the hunk — either the prior trace's line + 1 (converted back)
      // or the original lastUpdatedLine + 1 if deleted in the first patch.
      const deletedLine1Based = deletedIdx > 0
        ? (traces[deletedIdx - 1].lineNumber !== undefined ? traces[deletedIdx - 1].lineNumber! + 1 : lastUpdatedLine + 1)
        : lastUpdatedLine + 1;
      const deletedHunk = deletedPatch
        ? extractDeletedHunk(deletedPatch, targetRelPath, deletedLine1Based)
        : null;

      return {
        success: true,
        bookmarkId: bookmark.id,
        originalLine: lastUpdatedLine,
        fromCommit: commitInfo.commit,
        baselineSource: commitInfo.baselineSource,
        result: {
          status: 'deleted',
          deletedAtCommit: deletedTrace.commit,
          deletedAtCommitMessage: deletedPatch?.commit.subject ?? '',
          lastSeenLine: priorLine,
          lastSeenContent: deletedTrace.content ?? null,
          deletedHunk,
        },
      };
    }

    // Line was traced — require valid line evidence
    if (lastTrace.lineNumber === undefined) {
      return {
        success: true,
        bookmarkId: bookmark.id,
        originalLine: lastUpdatedLine,
        fromCommit: commitInfo.commit,
        baselineSource: commitInfo.baselineSource,
        result: {
          status: 'trace_invalid',
          explanation: 'Trace ended without a valid line number; not returning a fallback line.',
          lastTraceStatus: lastTrace.status,
          lastTraceCommit: lastTrace.commit,
          commitCount: patches.length,
        },
      };
    }

    const finalLine = lastTrace.lineNumber;
    const content = currentFileLines[finalLine] ?? lastTrace.content ?? null;
    const context = content ? anchorRepair.extractContext(currentFileLines, finalLine, 2) : [];

    return {
      success: true,
      bookmarkId: bookmark.id,
      originalLine: lastUpdatedLine,
      fromCommit: commitInfo.commit,
      baselineSource: commitInfo.baselineSource,
      result: {
        status: 'traced',
        newLine: finalLine,
        content,
        context,
        commitCount: patches.length,
      },
    };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

// ============================================================================
// Utility Tool: readFileAtRevision
// ============================================================================

export async function handleReadFileAtRevision(
  repoPath: string,
  filePath: string,
  commit: string,
  options?: { startLine?: number; endLine?: number; searchText?: string },
): Promise<Record<string, unknown>> {
  try {
    const validation = await gitHistory.validateGitContext(repoPath);
    if (!validation.valid) {
      return { success: false, error: 'Not a git repository' };
    }

    const fileResult = await gitHistory.getFileAtRevision(validation.repoRoot, {
      revision: commit,
      filePath,
    });

    const totalLines = fileResult.lines.length;
    let startLine: number;
    let endLine: number;
    let searchMatch: { line: number; content: string } | undefined;

    if (options?.searchText) {
      const idx = fileResult.lines.findIndex(l => l.includes(options.searchText!));
      if (idx >= 0) {
        searchMatch = { line: idx, content: fileResult.lines[idx] };
        startLine = Math.max(0, idx - 10);
        endLine = Math.min(totalLines - 1, idx + 10);
      } else {
        startLine = options?.startLine ?? 0;
        endLine = options?.endLine ?? Math.min(49, totalLines - 1);
      }
    } else if (options?.startLine !== undefined || options?.endLine !== undefined) {
      startLine = options?.startLine ?? 0;
      endLine = options?.endLine ?? Math.min(startLine + 49, totalLines - 1);
    } else {
      startLine = 0;
      endLine = Math.min(49, totalLines - 1);
    }

    return {
      success: true,
      filePath,
      commit,
      content: {
        startLine,
        endLine,
        lines: fileResult.lines.slice(startLine, endLine + 1),
      },
      totalLines,
      ...(searchMatch && { searchMatch }),
    };
  } catch (err: any) {
    if (err?.constructor?.name === 'FileNotFoundAtRevisionError') {
      return { success: false, error: `File not found at revision ${commit}` };
    }
    if (err?.constructor?.name === 'RevisionNotFoundError') {
      return { success: false, error: `Unknown revision: ${commit}` };
    }
    return { success: false, error: err?.message || String(err) };
  }
}

// ============================================================================
// Utility Tool: getCommitDiff
// ============================================================================

export async function handleGetCommitDiff(
  repoPath: string,
  commit: string,
  filePath?: string,
): Promise<Record<string, unknown>> {
  try {
    const validation = await gitHistory.validateGitContext(repoPath);
    if (!validation.valid) {
      return { success: false, error: 'Not a git repository' };
    }

    const diffResult = await gitHistory.getCommitDiff(validation.repoRoot, {
      commit,
      filePath,
    });

    // Format diff output
    const diffLines: string[] = [];
    const targetFiles = filePath
      ? diffResult.files.filter(f => f.oldPath === filePath || f.newPath === filePath)
      : diffResult.files;

    for (const file of targetFiles) {
      for (const hunk of file.hunks) {
        diffLines.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
        for (const line of hunk.lines) {
          const prefix = line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' ';
          diffLines.push(`${prefix}${line.content}`);
        }
      }
    }

    const diffText = diffLines.join('\n');
    const truncated = diffText.length > 10000;

    const result: Record<string, unknown> = {
      success: true,
      commit,
      commitMessage: diffResult.message,
      commitDate: diffResult.date.toISOString(),
      diff: truncated ? diffText.slice(0, 10000) : diffText,
      truncated,
    };

    if (!filePath) {
      result.files = diffResult.files.map(f => f.newPath || f.oldPath);
    }

    return result;
  } catch (err: any) {
    if (err?.constructor?.name === 'RevisionNotFoundError') {
      return { success: false, error: `Unknown revision: ${commit}` };
    }
    return { success: false, error: err?.message || String(err) };
  }
}

// ============================================================================
// Utility Tool: getLineLog
// ============================================================================

export async function handleGetLineLog(
  repoPath: string,
  filePath: string,
  startLine: number,
  endLine: number,
  maxCommits: number = 10,
): Promise<Record<string, unknown>> {
  try {
    const validation = await gitHistory.validateGitContext(repoPath);
    if (!validation.valid) {
      return { success: false, error: 'Not a git repository' };
    }

    const blameResults = await gitHistory.blameLine(
      validation.repoRoot,
      filePath,
      { startLine: startLine + 1, endLine: endLine + 1 },  // blame is 1-based
    );

    // Deduplicate commits and collect info
    const commitMap = new Map<string, { hash: string; message: string; date: string; author: string }>();
    for (const blame of blameResults) {
      if (!commitMap.has(blame.commit)) {
        commitMap.set(blame.commit, {
          hash: blame.commit,
          message: blame.summary,
          date: blame.authorTime.toISOString(),
          author: blame.author,
        });
      }
    }

    // Sort by date descending (newest first) and limit
    const commits = [...commitMap.values()]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, maxCommits);

    return {
      success: true,
      filePath,
      lineRange: { start: startLine, end: endLine },
      commits,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

// ============================================================================
// Skill Guide
// ============================================================================

export function getRepairSkillGuide(options?: {
  suggestBookmarkRelocation?: boolean;
  confirmLowConfidenceRepairs?: boolean;
  encourageParallelFixes?: boolean;
}): string {
  const suggestRelocation = options?.suggestBookmarkRelocation ?? false;
  const confirmLowConf = options?.confirmLowConfidenceRepairs ?? true;
  const parallelFixes = options?.encourageParallelFixes ?? false;

  const step7ConfirmBlock = confirmLowConf
    ? `The bookmark's label and note may motivate one final search for what they describe. Any candidate found this way is low confidence — present it to the user with your reasoning and ask whether they want to repair there. Never auto-repair from label-driven search alone. If nothing is found, explain why (code deleted, file removed, no matching content found).`
    : `The bookmark's label and note may motivate one final search for what they describe. Any candidate found this way is low confidence — note the possible alternative location in your summary but do not prompt the user for a decision. If nothing is found, explain why (code deleted, file removed, no matching content found).`;

  const contradictionSection = suggestRelocation
    ? `

## Contradiction Detection

When a mechanically-resolved anchor appears to have landed in an entirely different semantic scope than the bookmark's label or note describes, you may flag this to the user as a possible relocation candidate.

Constraints:
- Suggest only, never auto-relocate. A mechanically-resolved anchor is correct by definition — the code moved there. The label may simply be stale.
- Only flag clear scope mismatches. A bookmark that is slightly above, on, or inside the described code is not a contradiction — it is normal anchor drift. Only flag when the bookmark has landed in an entirely different function, class, or module than described.
- Present as informational. Frame it as: "This bookmark resolved to [location], but the label describes [something else]. You may want to review whether it is still pointing where you intended."`
    : '';

  const multiBookmarkRule = parallelFixes
    ? `- When repairing multiple bookmarks, use whatever tracking your environment provides to make sure each bookmark is accounted for and every repair is seen through to completion. If your environment supports sub-agents, you may delegate each bookmark's repair to a separate agent. Each agent must follow the full waterfall independently — the parallelism is across bookmarks, not within a single repair's waterfall steps.`
    : `- When repairing multiple bookmarks, work through them one at a time — complete the full waterfall for each before starting the next. Use whatever tracking your environment provides to make sure each bookmark is accounted for and repairs proceed in order.`;

  return `# Anchor Repair Guide

## Line Numbers

All line-number fields in this tool family are **1-based**, matching what \`grep -n\`, \`git blame\`, and the editor UI show. If you read a file and see \`12: foo\`, pass \`12\` — not \`11\`.

## Anchor Model

Bookmarks have anchors that bind them to a line in a source file. Anchor kinds:
- **smart**: Stores lineCache (the line content), contextBefore/contextAfter (surrounding lines), lastUpdatedLine, and nonce. Resolved by matching content against current file.
- **tag**: Uses comment markers (// @bookmark:<tagId>) in source files. Resolved by searching for the tag comment.
- **point**: Stores only a line number. No content matching — breaks if lines shift.

When file content changes, the anchor may no longer resolve — this is a "broken" anchor shown with an ! overlay.

## Available Tools

- \`anchor_listBroken\` — See which anchors the user has encountered as broken or low-confidence (cached, instant). Start here for awareness before diving into specific files.
- \`anchor_validate\` — Check which anchors are broken in a file
- \`anchor_getRepairPackage\` — Get full context for broken anchors (anchor data, metadata, surrounding content)
- \`anchor_repair\` — Apply a fix by rebuilding the anchor at a new line position
- \`anchor_getHistoricalContext\` — See what the code looked like when the anchor was last valid
- \`anchor_getFileDiff\` — Diagnose what changed (returns structured diagnosis: shifted/exact_match/fuzzy_match/no_match)
- \`anchor_searchMovedCode\` — Find code that moved to another file
- \`anchor_traceLineHistory\` — Mechanically trace a line through commit-by-commit patches
- \`anchor_readFileAtRevision\` — Read a section of a file at a specific commit
- \`anchor_getCommitDiff\` — Inspect what a specific commit changed
- \`anchor_getLineLog\` — Find which commits touched a region of a file

## Supplemental Evidence

The repair package includes bookmark metadata (label, note, tags). When evaluating candidates, you may also use your understanding of the code's structural context — what function, class, or module a line belongs to. These are supplemental evidence sources that inform decisions the waterfall is already asking you to make.

Not all bookmarks are semantically anchored. Some target specific code text regardless of structural location. Semantic reasoning (function/class scope) is useful for disambiguation but should not override mechanical evidence about where the actual code text landed.

When comparing semantic scope, the historical surrounding content (from Step 2) and the current surrounding content (from Step 1) both provide context. Comparing whether a line was inside function X before and whether the candidate is also inside function X now is useful — but only after you have both views.

**Clue roles by waterfall step:**

| Step | Clue Role | What's Permitted |
|------|-----------|-----------------|
| 1 (Quick Look) | Confirmation | Label can confirm an obvious match already visible in surrounding content. Cannot drive a new search. |
| 2-3 (Historical + Diff) | Disambiguation | For multi-candidate results (multiple exact_match or fuzzy_match hits), label can rank candidates. A validated shifted diagnosis needs no label input. |
| 4-5 (Cross-file, Tracing) | Evaluation context | When reading candidate code, use structural understanding to assess whether a candidate makes sense. |
| 6 (Manual Investigation) | Active guidance | Label/note can direct exploration when digging through commits. |
| 7 (Before non-repairable) | Last-resort search | Label/note can motivate one final search. Any result must be presented as low-confidence and requires user confirmation. |

**Flex Context Candidates:**

When \`includeHints\` is enabled, the repair package diagnostics may include a \`flexBestCandidate\`. This indicates the bookmarked line (lineCache) was found in the file and is unique within the surrounding context window, but the context lines are offset by some number of lines — \`flexBefore\` and \`flexAfter\` indicate how many lines of gap exist in each direction. This typically means the code is still at that location but surrounding content has changed (lines were inserted or deleted nearby). Flex candidates are worth considering as repair targets, but your judgment on the match quality is still needed — continue following the waterfall steps.

## Repair Waterfall

Follow these steps in order. Don't skip to expensive steps. Do not call the next waterfall step until you have read the result of the current step. Each step's result determines whether to proceed or repair.

0. **Awareness Check** — Determine what needs repair.
   - If the user asks to fix broken bookmarks generally, call \`anchor_listBroken\` to see what the extension has detected. This is cached and instant.
   - If the user asks to repair a specific bookmark by ID, call \`bookmark_list({"query":"<bookmarkId>"})\` to look it up directly — query matches by bookmark ID. No need to check the broken list first.

   Then proceed to Step 1 for each bookmark that needs repair.

1. **Quick Look** — Call \`anchor_getRepairPackage\`. Read the repair package and current file. Is there an obvious remapping? If the lineCache appears nearby, or the bookmark's label/notes point to something recognizable, call \`anchor_repair\` immediately. Don't overthink this step, but don't overrationalize something that is not a good match we have other steps to be sure.  Even if you are sure go ahead and do steps 2 and 3 to gain confidence.  If confidence errodes with those steps then proceed to the others.

The bookmark's label and note are visible in the repair package. If they corroborate an obvious match in the surrounding content, that adds confidence. But do not treat label/note as a search query — if the lineCache is not visible nearby, proceed to Step 2 rather than searching the file for what the label describes.

2. **Historical Context** — Call \`anchor_getHistoricalContext\`. See what the code looked like when the anchor was placed. Does recognizing the old code reveal where it is now in the current file?

You now have both old and current surrounding content. If the bookmark's label describes a semantic location (e.g., a specific function or class), you can compare whether the old context and current candidates share that structural scope.

3. **Diff Analysis** — Call \`anchor_getFileDiff\`. The tool returns a structured diagnosis:
   - \`shifted\`: Line just moved due to insertions/deletions. The new line number is provided — repair directly.
   - \`exact_match\`: Content found at a new location. Verify and repair.
   - \`fuzzy_match\`: Similar content found. Review candidates and pick the best match.
   - \`no_match\`: Full diff provided. Read it to understand what happened.

A \`shifted\` diagnosis is already high confidence — label adds nothing. For \`exact_match\` with multiple hits or \`fuzzy_match\`, the bookmark's label and note can disambiguate between candidates.

4. **Cross-File Search** — Call \`anchor_searchMovedCode\`. This tool searches only lines that were *introduced* (added) since the anchor was placed — pre-existing lines in other files are excluded. If found, note that anchor_repair works within the original file — cross-file moves may require creating a new bookmark.

Each match includes a \`contextScore\` (0-1) showing how well the anchor's original surrounding context matches around the candidate. A high contextScore (> 0.5) means the code's neighbors also moved — stronger evidence of a true move. A zero contextScore is common for cross-file moves (new neighbors) but means the match lacks structural corroboration — evaluate it with more scrutiny. When multiple matches exist, prefer the one with the highest contextScore as a starting point, but use label/note and the semantic structure of the code to make the final call.

When evaluating candidates from cross-file search or trace results, use your understanding of code structure as supplemental context for assessing whether a candidate makes sense.

5. **Line Tracing** — Call \`anchor_traceLineHistory\`. Mechanical trace through patches may reveal where the line went.

If trace returns \`status: "deleted"\`, the line was removed from this file at a specific commit. The response includes a \`deletedHunk\` — a unified diff excerpt from the commit where deletion occurred. Inspect it to understand what happened:
   - If the hunk shows the code was removed and replaced with a different API call or import, the code was refactored away — this is strong evidence for declaring non-repairable.
   - If the hunk shows code removed without clear replacement, consider whether Step 4 already found a cross-file match.
   - If Step 4 returned matches with low contextScore and the hunk shows intentional removal, prefer declaring non-repairable over repairing to a coincidental match.

When evaluating candidates from cross-file search or trace results, use your understanding of code structure as supplemental context for assessing whether a candidate makes sense.

6. **Manual Investigation** — Use utility tools (\`anchor_readFileAtRevision\`, \`anchor_getCommitDiff\`, \`anchor_getLineLog\`) to dig into specific commits where the trail went cold.

Label and note can guide your exploration. Knowing what the bookmark describes gives direction when digging through commits and file history.

7. **Declare Non-Repairable** — Before searching based on label/note, consider what the earlier waterfall steps revealed. If diff analysis or history showed the code was explicitly deleted or the concept removed, a label-driven search will find false matches — declare non-repairable instead. This search is for code that moved or was transformed beyond mechanical recognition, not for code that no longer exists.

Non-unique lineCache content (common patterns like utility calls, simple returns, variable declarations) is especially prone to false cross-file matches. When trace shows deletion and the lineCache is generic, prefer declaring non-repairable over acting on a cross-file match that lacks contextual corroboration (low or zero contextScore).

${step7ConfirmBlock}

### Full Workspace Scan

The \`anchor_listBroken\` tool only shows anchors from files the user has opened. For a comprehensive check of ALL bookmarks across the workspace, you would need to:

1. Call \`bookmark_list\` to get all bookmarks and their target files
2. Call \`anchor_validate\` on each unique target file

This is expensive and should only be done when the user explicitly requests a full scan (e.g., "scan all bookmarks and fix broken ones"). For routine work, \`anchor_listBroken\` provides sufficient awareness.

## Rules
- Supplemental evidence (label, note, tags, semantic code structure) may confirm, disambiguate, or extend mechanical findings. It never replaces the waterfall. Do not search for label-matching code as a repair strategy — follow the waterfall steps in order and use clues only at decision points within those steps.
- when working with diffs: Keep your eye on the anchor line itself. If it survived unchanged, it moved; it did not semantically change.
- Duplicate line text should trigger structure-aware disambiguation. Prefer control-flow and unique-neighbor continuity over raw line equality; auto-repair only on a clear winner.
- Follow the waterfall in order. Don't skip to expensive steps.
- Call \`anchor_repair\` to apply fixes. NEVER edit .bookmarks.json files directly.
- For tag anchors, \`anchor_repair\` returns \`tagRemovals\` and \`tagInsertions\` — you must apply those edits to the source files.
${multiBookmarkRule}
- Call \`anchor_validate\` after each repair to confirm it resolved.
- If a repair package shows \`resolved: true\`, the anchor isn't broken — skip it.
- When declaring non-repairable, explain why (code deleted, file removed, etc.).
- Post-repair validation only confirms the trivial task of re-anchoring. True confidence must come from the waterfall investigation that selected the repair line.${contradictionSection}`;
}
