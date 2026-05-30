import type { ServerContext } from '../server-context.js';
import {
  readRegistry,
  resolveWorkspacePath,
  uriToWorkspaceRelative,
  getBookmarksDataRoot,
  brokenAnchorsCache,
  getCacheDir,
  gitHistory,
  readFileAt,
  isLocalPath,
  resolveAnchors,
} from '@agentic-bookmarks/core';
import type { WorkspaceInfo } from '@agentic-bookmarks/core';
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

/**
 * Per-workspace index of every bookmark anchor, grouped by normalized target URI.
 * Used to validate cached broken-anchor entries against the current file state.
 */
interface WorkspaceAnchorIndex {
  enableFlexContext: boolean;
  enableFlexContextShared: boolean;
  /** normalized target URI → its bookmarks + whether the source data file is local */
  byUri: Map<string, { isLocal: boolean; bookmarks: Array<{ id: string; anchor: any; updatedAt: number }> }>;
  /** distinct normalized target URIs across all bookmarks (denominator for coverage) */
  universe: Set<string>;
}

/** Build the per-workspace anchor index once per anchor_listBroken call. */
async function loadWorkspaceAnchorIndex(workspace: WorkspaceInfo): Promise<WorkspaceAnchorIndex> {
  const registry = await getRegistryForWorkspace(workspace);
  const anchorSettings = (registry.settings?.anchors as any) ?? {};
  const enableFlexContext = anchorSettings.enableFlexContext ?? true;
  const enableFlexContextShared = anchorSettings.enableFlexContextShared ?? true;

  const byUri = new Map<string, { isLocal: boolean; bookmarks: Array<{ id: string; anchor: any; updatedAt: number }> }>();
  const universe = new Set<string>();

  for (const fileEntry of registry.files) {
    if (fileEntry.enabled === false) continue;
    try {
      const data = await readFileAt(resolveWorkspacePath(fileEntry.path, workspace.workspaceRoot));
      const isLocal = data.isLocal ?? isLocalPath(fileEntry.path);
      for (const bm of data.bookmarks) {
        const norm = bm.target.uri.split('#')[0];
        universe.add(norm);
        let slot = byUri.get(norm);
        if (!slot) {
          slot = { isLocal, bookmarks: [] };
          byUri.set(norm, slot);
        }
        slot.bookmarks.push({ id: bm.id, anchor: bm.anchor, updatedAt: bm.updatedAt ?? 0 });
      }
    } catch { /* skip unreadable file */ }
  }

  return { enableFlexContext, enableFlexContextShared, byUri, universe };
}

export async function handleAnchorListBroken(ctx: ServerContext, args: any) {
  const statusFilter = (args.status as string) || 'all';
  const results: Array<{
    workspace: string;
    entries: any[];
    lastUpdated: number;
    coverage: { covered: number; total: number };
  }> = [];

  let totalCovered = 0;
  let totalUniverse = 0;

  for (const workspace of ctx.workspaces) {
    try {
      const registry = await getRegistryForWorkspace(workspace);
      const dataRoot = getBookmarksDataRoot(registry);
      const cacheDir = getCacheDir(workspace.workspaceRoot, dataRoot);
      const cache = await brokenAnchorsCache.readBrokenAnchorsCache(cacheDir);

      const index = await loadWorkspaceAnchorIndex(workspace);

      // Group cached entries by normalized target URI.
      const entriesByUri = new Map<string, any[]>();
      for (const entry of cache.entries) {
        const norm = entry.uri.split('#')[0];
        const group = entriesByUri.get(norm);
        if (group) group.push(entry);
        else entriesByUri.set(norm, [entry]);
      }

      // Reconcile each group against the current file + bookmark state.
      const reconciledEntries: any[] = [];
      for (const [uri, entriesForUri] of entriesByUri) {
        const absPath = resolveWorkspacePath(uri, workspace.workspaceRoot);
        let st: Awaited<ReturnType<typeof fs.stat>> | null;
        try {
          st = await fs.stat(absPath);
        } catch {
          st = null;
        }

        // File missing → target is genuinely gone; keep every entry untouched.
        if (st === null) {
          reconciledEntries.push(...entriesForUri);
          continue;
        }

        const slot = index.byUri.get(uri);
        const bmById = new Map((slot?.bookmarks ?? []).map(b => [b.id, b]));

        // Fast path: nothing changed since the entry was discovered → trust cache.
        const needRecheck = entriesForUri.some(
          e => Math.max(st!.mtimeMs, bmById.get(e.bookmarkId)?.updatedAt ?? 0) > e.discoveredAt,
        );
        if (!needRecheck) {
          reconciledEntries.push(...entriesForUri);
          continue;
        }

        // Re-read and re-resolve the file's anchors.
        let lines: string[];
        try {
          lines = (await fs.readFile(absPath, 'utf8')).split('\n');
        } catch {
          reconciledEntries.push(...entriesForUri);
          continue;
        }
        const resolutionResults = resolveAnchors(
          (slot?.bookmarks ?? []).map(b => ({ id: b.id, anchor: b.anchor })),
          lines,
          {
            enableFlexContext: index.enableFlexContext,
            enableFlexContextShared: index.enableFlexContextShared,
            isLocal: slot?.isLocal ?? false,
          },
        );
        const resById = new Map(resolutionResults.map(r => [r.anchorId, r]));

        for (const e of entriesForUri) {
          const r = resById.get(e.bookmarkId);
          if (!r) continue; // bookmark gone → drop
          const freshStatus = !r.resolved
            ? 'broken'
            : (r.score !== undefined && r.score < 0.85 ? 'warning' : 'valid');
          if (freshStatus === 'valid') continue; // repaired/edited clean → evict
          reconciledEntries.push({
            ...e,
            status: freshStatus,
            score: r.score ?? null,
            errorCode: r.errorCode ?? null,
            errorDetails: r.errorDetails ?? null,
          });
        }
      }

      // Status filter applies AFTER reconciliation.
      let entries = reconciledEntries;
      if (statusFilter !== 'all') {
        entries = entries.filter((e: any) => e.status === statusFilter);
      }

      // Coverage: bookmarked files checked vs total distinct bookmarked targets.
      // Normalize the same way as `universe` so fragment-bearing URIs still match.
      const coveredSet = new Set(cache.coveredUris.map(u => u.split('#')[0]));
      let covered = 0;
      for (const u of index.universe) if (coveredSet.has(u)) covered++;
      const total = index.universe.size;
      totalCovered += covered;
      totalUniverse += total;

      if (entries.length > 0 || ctx.workspaces.length === 1) {
        results.push({
          workspace: workspace.workspaceRoot,
          entries,
          lastUpdated: cache.lastUpdated,
          coverage: { covered, total },
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
          coverage: { covered: totalCovered, total: totalUniverse },
          note: 'Entries are validated against the current file on read (repaired/edited anchors are evicted). coverage = bookmarked files checked vs total; covered < total means some files have not been checked — use anchor_validate to check a specific file.',
        },
        results,
      }),
    }],
  };
}
