import type { ServerContext } from '../server-context.js';
import {
  readRegistry,
  resolveWorkspacePath,
  uriToWorkspaceRelative,
  getBookmarksDataRoot,
  brokenAnchorsCache,
  getCacheDir,
  gitHistory,
} from '@agentic-bookmarks/core';
import * as fs from 'node:fs/promises';
import {
  handleGetHistoricalContext,
  handleGetFileDiff,
  handleSearchMovedCode,
  handleTraceLineHistory,
  handleReadFileAtRevision,
  handleGetCommitDiff,
  handleGetLineLog,
  getRepairSkillGuide,
  findHistoricalCommit,
  getLineCache,
  getLastUpdatedLine,
} from '../anchor-git-tools.js';
import { getRegistryForWorkspace } from '../workspace.js';
import { findBookmarkById } from './anchor-repair.js';
import { toInternal, toWire } from './line-basis.js';

// ============================================================================
// anchor_getRepairSkillGuide
// ============================================================================

export async function handleAnchorGetRepairSkillGuide(ctx: ServerContext, _args: any) {
  ctx.hasServedRepairSkillGuide = true;
  const reg = await readRegistry(ctx.workspaceRoot);
  const mcpSettings = (reg.settings?.mcp as any) ?? {};
  return {
    content: [{
      type: 'text',
      text: getRepairSkillGuide({
        suggestBookmarkRelocation: mcpSettings.suggestBookmarkRelocation,
        confirmLowConfidenceRepairs: mcpSettings.confirmLowConfidenceRepairs,
        encourageParallelFixes: mcpSettings.encourageParallelFixes,
      }),
    }],
  };
}

// ============================================================================
// anchor_getHistoricalContext
// ============================================================================

export async function handleAnchorGetHistoricalContextTool(ctx: ServerContext, args: any) {
  const { bookmarkId } = args;
  const found = await findBookmarkById(ctx, bookmarkId);
  if (!found) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Bookmark not found' }) }] };
  }
  const targetRelPath = uriToWorkspaceRelative(found.bookmark.target.uri, found.workspace.workspaceRoot);
  if (!targetRelPath) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Bookmark target is outside workspace: ${found.bookmark.target.uri}` }) }] };
  }
  const reg = await readRegistry(found.workspace.workspaceRoot);
  const mcpSettings = (reg.settings?.mcp as any) ?? {};
  const enableBaselinePickaxe = mcpSettings.enableBaselinePickaxe ?? true;
  const result = await handleGetHistoricalContext(found.bookmark, found.workspace.workspaceRoot, targetRelPath, found.filePath, { enableBaselinePickaxe });
  // Convert historicalContent window to 1-based wire
  if (result?.historicalContent && typeof result.historicalContent === 'object') {
    const w = result.historicalContent as Record<string, unknown>;
    if (typeof w.startLine === 'number') w.startLine = toWire(w.startLine);
    if (typeof w.endLine === 'number') w.endLine = toWire(w.endLine);
  }
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

// ============================================================================
// anchor_getFileDiff
// ============================================================================

export async function handleAnchorGetFileDiffTool(ctx: ServerContext, args: any) {
  const { bookmarkId } = args;
  const found = await findBookmarkById(ctx, bookmarkId);
  if (!found) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Bookmark not found' }) }] };
  }
  const targetRelPath = uriToWorkspaceRelative(found.bookmark.target.uri, found.workspace.workspaceRoot);
  if (!targetRelPath) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Bookmark target is outside workspace: ${found.bookmark.target.uri}` }) }] };
  }
  const reg = await readRegistry(found.workspace.workspaceRoot);
  const mcpSettings = (reg.settings?.mcp as any) ?? {};
  const enableBaselinePickaxe = mcpSettings.enableBaselinePickaxe ?? true;
  const absoluteTargetPath = resolveWorkspacePath(targetRelPath, found.workspace.workspaceRoot);
  let fileLines: string[];
  try {
    const content = await fs.readFile(absoluteTargetPath, 'utf8');
    fileLines = content.split('\n');
  } catch {
    // File missing — return structured diagnosis with optional rename detection
    const fileMissingResult: Record<string, unknown> = {
      success: true,
      bookmarkId,
      diagnosis: 'file_missing',
      detail: { explanation: 'Target file no longer exists on disk' },
    };
    try {
      const lineCache = getLineCache(found.bookmark.anchor) ?? '';
      const lastUpdatedLine = getLastUpdatedLine(found.bookmark.anchor);
      const commitInfo = await findHistoricalCommit(
        found.workspace.workspaceRoot, targetRelPath, lastUpdatedLine,
        found.filePath, bookmarkId, lineCache,
        { enableBaselinePickaxe },
      );
      if (!('error' in commitInfo)) {
        fileMissingResult.fromCommit = commitInfo.commit;
        fileMissingResult.baselineSource = commitInfo.baselineSource;
        const validation = await gitHistory.validateGitContext(found.workspace.workspaceRoot);
        const renameResult = await gitHistory.detectFileRename(validation.repoRoot, {
          filePath: targetRelPath,
          sinceCommit: commitInfo.commit,
        });
        if (renameResult.renamed) {
          fileMissingResult.fileMovedResults = {
            detected: true,
            oldPath: renameResult.oldPath,
            newPath: renameResult.newPath,
            renameCommit: renameResult.renameCommit,
            renameCommitSubject: renameResult.renameCommitSubject,
          };
        }
      }
    } catch {
      // Rename detection is best-effort — return file_missing without it
    }
    return { content: [{ type: 'text', text: JSON.stringify(fileMissingResult) }] };
  }
  const result = await handleGetFileDiff(found.bookmark, found.workspace.workspaceRoot, targetRelPath, fileLines, found.filePath, { enableBaselinePickaxe });
  convertFileDiffLinesToWire(result);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

/** Convert all 0-based line fields in an anchor_getFileDiff result to 1-based wire. */
function convertFileDiffLinesToWire(result: Record<string, unknown>): void {
  const detail = result?.detail as Record<string, unknown> | undefined;
  if (detail) {
    if (typeof detail.originalLine === 'number') detail.originalLine = toWire(detail.originalLine);
    if (typeof detail.newLine === 'number') detail.newLine = toWire(detail.newLine);
    if (Array.isArray(detail.matches)) {
      for (const m of detail.matches as Array<Record<string, unknown>>) {
        if (typeof m.line === 'number') m.line = toWire(m.line);
      }
    }
    if (Array.isArray(detail.candidates)) {
      for (const c of detail.candidates as Array<Record<string, unknown>>) {
        if (typeof c.line === 'number') c.line = toWire(c.line);
      }
    }
  }
  const sv = result?.shiftValidation as Record<string, unknown> | undefined;
  if (sv && typeof sv.tracedNewLine === 'number') {
    sv.tracedNewLine = toWire(sv.tracedNewLine);
  }
}

// ============================================================================
// anchor_searchMovedCode
// ============================================================================

export async function handleAnchorSearchMovedCodeTool(ctx: ServerContext, args: any) {
  const { bookmarkId } = args;
  const found = await findBookmarkById(ctx, bookmarkId);
  if (!found) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Bookmark not found' }) }] };
  }
  const targetRelPath = uriToWorkspaceRelative(found.bookmark.target.uri, found.workspace.workspaceRoot);
  if (!targetRelPath) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Bookmark target is outside workspace: ${found.bookmark.target.uri}` }) }] };
  }
  const reg = await readRegistry(found.workspace.workspaceRoot);
  const mcpSettings = (reg.settings?.mcp as any) ?? {};
  const enableBaselinePickaxe = mcpSettings.enableBaselinePickaxe ?? true;
  const result = await handleSearchMovedCode(found.bookmark, found.workspace.workspaceRoot, targetRelPath, found.filePath, { enableBaselinePickaxe });
  // Convert match line fields to 1-based wire
  if (Array.isArray(result?.matches)) {
    for (const m of result.matches as Array<Record<string, unknown>>) {
      if (typeof m.line === 'number') m.line = toWire(m.line);
    }
  }
  if (Array.isArray(result?.fuzzyHints)) {
    for (const m of result.fuzzyHints as Array<Record<string, unknown>>) {
      if (typeof m.line === 'number') m.line = toWire(m.line);
    }
  }
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

// ============================================================================
// anchor_traceLineHistory
// ============================================================================

export async function handleAnchorTraceLineHistoryTool(ctx: ServerContext, args: any) {
  const { bookmarkId } = args;
  const found = await findBookmarkById(ctx, bookmarkId);
  if (!found) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Bookmark not found' }) }] };
  }
  const targetRelPath = uriToWorkspaceRelative(found.bookmark.target.uri, found.workspace.workspaceRoot);
  if (!targetRelPath) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Bookmark target is outside workspace: ${found.bookmark.target.uri}` }) }] };
  }
  const reg = await readRegistry(found.workspace.workspaceRoot);
  const mcpSettings = (reg.settings?.mcp as any) ?? {};
  const enableBaselinePickaxe = mcpSettings.enableBaselinePickaxe ?? true;
  const absoluteTargetPath = resolveWorkspacePath(targetRelPath, found.workspace.workspaceRoot);
  let fileLines: string[];
  try {
    const content = await fs.readFile(absoluteTargetPath, 'utf8');
    fileLines = content.split('\n');
  } catch {
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, bookmarkId, status: 'file_missing', hint: 'Use anchor_getFileDiff for file-move detection' }) }] };
  }
  const result = await handleTraceLineHistory(found.bookmark, found.workspace.workspaceRoot, targetRelPath, fileLines, found.filePath, { enableBaselinePickaxe });
  // Convert top-level originalLine and inner result line fields to 1-based wire.
  // Note: result.deletedHunk.{old,new}Range.start are already 1-based (git diff format) — leave alone.
  if (typeof result?.originalLine === 'number') {
    result.originalLine = toWire(result.originalLine);
  }
  const inner = result?.result as Record<string, unknown> | undefined;
  if (inner) {
    if (typeof inner.newLine === 'number') inner.newLine = toWire(inner.newLine);
    if (typeof inner.lastSeenLine === 'number') inner.lastSeenLine = toWire(inner.lastSeenLine);
  }
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

// ============================================================================
// anchor_readFileAtRevision
// ============================================================================

export async function handleAnchorReadFileAtRevisionTool(ctx: ServerContext, args: any) {
  const { filePath, commit, startLine, endLine, searchText } = args;
  const workspace = ctx.workspaces[0];
  if (!workspace) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No workspace configured' }) }] };
  }
  const internalStart = startLine !== undefined ? toInternal(startLine) : undefined;
  const internalEnd = endLine !== undefined ? toInternal(endLine) : undefined;
  const result = await handleReadFileAtRevision(workspace.workspaceRoot, filePath, commit, {
    startLine: internalStart,
    endLine: internalEnd,
    searchText,
  });
  // Convert response line fields to 1-based wire
  if (result?.success && result.content && typeof result.content === 'object') {
    const c = result.content as Record<string, unknown>;
    if (typeof c.startLine === 'number') c.startLine = toWire(c.startLine);
    if (typeof c.endLine === 'number') c.endLine = toWire(c.endLine);
  }
  if (result?.searchMatch && typeof (result.searchMatch as any).line === 'number') {
    (result.searchMatch as any).line = toWire((result.searchMatch as any).line);
  }
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

// ============================================================================
// anchor_getCommitDiff
// ============================================================================

export async function handleAnchorGetCommitDiffTool(ctx: ServerContext, args: any) {
  const { commit, filePath } = args;
  const workspace = ctx.workspaces[0];
  if (!workspace) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No workspace configured' }) }] };
  }
  const result = await handleGetCommitDiff(workspace.workspaceRoot, commit, filePath);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

// ============================================================================
// anchor_getLineLog
// ============================================================================

export async function handleAnchorGetLineLogTool(ctx: ServerContext, args: any) {
  const { filePath, startLine, endLine, maxCommits } = args;
  const workspace = ctx.workspaces[0];
  if (!workspace) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No workspace configured' }) }] };
  }
  const result = await handleGetLineLog(workspace.workspaceRoot, filePath, toInternal(startLine), toInternal(endLine), maxCommits);
  // Convert echoed lineRange fields back to 1-based wire
  if (result?.lineRange && typeof result.lineRange === 'object') {
    const r = result.lineRange as Record<string, unknown>;
    if (typeof r.start === 'number') r.start = toWire(r.start);
    if (typeof r.end === 'number') r.end = toWire(r.end);
  }
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

// ============================================================================
// anchor_listBroken
// ============================================================================

export async function handleAnchorListBroken(ctx: ServerContext, args: any) {
  const statusFilter = (args.status as string) || 'all';
  const results: Array<{
    workspace: string;
    entries: any[];
    lastUpdated: number;
  }> = [];

  for (const workspace of ctx.workspaces) {
    try {
      const registry = await getRegistryForWorkspace(workspace);
      const dataRoot = getBookmarksDataRoot(registry);
      const cacheDir = getCacheDir(workspace.workspaceRoot, dataRoot);
      const cache = await brokenAnchorsCache.readBrokenAnchorsCache(cacheDir);

      let entries = cache.entries;
      if (statusFilter !== 'all') {
        entries = entries.filter((e: any) => e.status === statusFilter);
      }

      if (entries.length > 0 || ctx.workspaces.length === 1) {
        results.push({
          workspace: workspace.workspaceRoot,
          entries,
          lastUpdated: cache.lastUpdated,
        });
      }
    } catch { /* skip unreadable */ }
  }

  const totalBroken = results.reduce((sum, r) => sum + r.entries.filter((e: any) => e.status === 'broken').length, 0);
  const totalWarning = results.reduce((sum, r) => sum + r.entries.filter((e: any) => e.status === 'warning').length, 0);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        summary: {
          broken: totalBroken,
          warning: totalWarning,
          total: totalBroken + totalWarning,
          note: 'These are cached results from files the user has opened. For a fresh check of a specific file, use anchor_validate.',
        },
        results,
      }),
    }],
  };
}
