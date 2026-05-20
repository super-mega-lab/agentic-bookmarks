/**
 * In-memory anchor state management.
 *
 * Tracks resolved anchor positions during a session. This state is NOT
 * persisted - it tracks positions for rendering decorations and provides
 * hints for repair flows.
 */

import type { AnchorResolutionResult } from '@agentic-bookmarks/core';
import { SMART_ANCHOR_HIGH_CONFIDENCE } from '@agentic-bookmarks/core';

export type AnchorErrorCode = 'not_found' | 'ambiguous' | 'out_of_bounds';
export type AnchorStatus = 'valid' | 'warning' | 'broken';

export interface InMemoryAnchorState {
  bookmarkId: string;
  resolvedLine: number;
  supportLine?: number;
  status: AnchorStatus;
  lastValidatedAt: number;
  errorCode?: AnchorErrorCode;
  errorDetails?: string;
  score?: number;
  /** Max gap lines needed to match before-context via flex (informational) */
  flexBefore?: number;
  /** Max gap lines needed to match after-context via flex (informational) */
  flexAfter?: number;
  /** True when lineCache is unique but context doesn't match even with flex=5.
   *  Deep flex (flex=100) in repair queue may recover the anchor. */
  needsDeepFlex?: boolean;
  /** Timestamp of last deep-flex (flex=100) check. Only re-check when
   *  lastDeepFlexAt < lastValidatedAt (new file state observed). */
  lastDeepFlexAt?: number;
}

// Primary state: docUri -> bookmarkId -> state
const anchorState = new Map<string, Map<string, InMemoryAnchorState>>();

/** Options for warning suppression on shared bookmarks. */
export interface InitStateOptions {
  /** Map of bookmarkId → isLocal for each bookmark in the file */
  isLocalMap?: Map<string, boolean>;
  /** Whether to show warning indicators on shared bookmarks (default: false) */
  showWarningOnShared?: boolean;
}

/**
 * Classify a core resolution result into an anchor status. Single source of truth
 * shared by initStateForFile (open path) and the scan path (scanValidate).
 *
 * - resolved + low score → 'warning' (suppressed to 'valid' on shared bookmarks
 *   unless showWarningOnShared);
 * - unresolved + lineCacheOnly → 'warning' (deep-flex pending);
 * - otherwise 'broken'.
 */
export function classifyAnchorStatus(
  result: AnchorResolutionResult,
  opts?: { isLocal?: boolean; showWarningOnShared?: boolean }
): AnchorStatus {
  const wouldWarn = result.score !== undefined && result.score < SMART_ANCHOR_HIGH_CONFIDENCE;
  const isLocal = opts?.isLocal ?? true; // default to local (safer)
  const showWarningOnShared = opts?.showWarningOnShared ?? false;
  const suppressSharedWarning = wouldWarn && !isLocal && !showWarningOnShared;

  return result.resolved
    ? (wouldWarn && !suppressSharedWarning)
      ? 'warning'
      : 'valid'
    : result.lineCacheOnly
      ? 'warning'
      : 'broken';
}

/**
 * Initialize state for a file from resolution results.
 */
export function initStateForFile(
  docUri: string,
  results: AnchorResolutionResult[],
  options?: InitStateOptions
): void {
  const fileState = new Map<string, InMemoryAnchorState>();
  const isLocalMap = options?.isLocalMap;
  const showWarningOnShared = options?.showWarningOnShared ?? false;

  const now = Date.now();
  for (const result of results) {
    // Determine display position: use resolved line, or lineCacheOnly position as fallback
    const resolvedLine = result.resolved
      ? (result.line ?? -1)
      : (result.lineCacheOnlyLine ?? -1);

    // Determine status via the shared classifier (see classifyAnchorStatus).
    const isLocal = isLocalMap?.get(result.anchorId) ?? true; // default to local (safer)
    const status: AnchorStatus = classifyAnchorStatus(result, { isLocal, showWarningOnShared });

    const state: InMemoryAnchorState = {
      bookmarkId: result.anchorId,
      resolvedLine,
      supportLine: result.supportLine,
      status,
      score: result.score,
      lastValidatedAt: now,
      errorCode: result.errorCode as AnchorErrorCode | undefined,
      errorDetails: result.errorDetails,
      // Flex metadata (informational — populated when anchor resolved via flex)
      flexBefore: result.flexBefore,
      flexAfter: result.flexAfter,
      // Deep-flex signal: lineCache found uniquely but context doesn't match
      needsDeepFlex: result.lineCacheOnly === true ? true : undefined,
    };
    fileState.set(result.anchorId, state);
  }

  anchorState.set(docUri, fileState);
}

/**
 * Update positions after document edit.
 */
export function applyEditDelta(
  docUri: string,
  startLine: number,
  delta: number
): void {
  const fileState = anchorState.get(docUri);
  if (!fileState) return;

  for (const state of fileState.values()) {
    if (state.resolvedLine >= startLine) {
      state.resolvedLine = Math.max(0, state.resolvedLine + delta);
    }
  }
}

/**
 * Mark anchors for re-validation when content changed.
 */
export function markForRevalidation(
  docUri: string,
  affectedLines: number[]
): void {
  const fileState = anchorState.get(docUri);
  if (!fileState) return;

  const lineSet = new Set(affectedLines);
  for (const state of fileState.values()) {
    if (lineSet.has(state.resolvedLine)) {
      state.status = 'warning';
    }
  }
}

/**
 * Get resolved line for rendering.
 */
export function getResolvedLine(
  docUri: string,
  bookmarkId: string
): number | undefined {
  const fileState = anchorState.get(docUri);
  if (!fileState) return undefined;

  const state = fileState.get(bookmarkId);
  if (!state || state.status === 'broken') return undefined;

  return state.resolvedLine;
}

/**
 * Get status for UI indicators.
 */
export function getStatus(
  docUri: string,
  bookmarkId: string
): AnchorStatus | undefined {
  const fileState = anchorState.get(docUri);
  if (!fileState) return undefined;

  return fileState.get(bookmarkId)?.status;
}

/**
 * Get error details for UI display (tooltips).
 */
export function getErrorDetails(
  docUri: string,
  bookmarkId: string
): string | undefined {
  const fileState = anchorState.get(docUri);
  if (!fileState) return undefined;

  return fileState.get(bookmarkId)?.errorDetails;
}

/**
 * Get resolution score for UI display (tooltips).
 */
export function getScore(
  docUri: string,
  bookmarkId: string
): number | undefined {
  const fileState = anchorState.get(docUri);
  if (!fileState) return undefined;

  return fileState.get(bookmarkId)?.score;
}

/**
 * Clear state when file closes.
 */
export function clearStateForFile(docUri: string): void {
  anchorState.delete(docUri);
}

/**
 * Get all broken anchors for a file (for repair flows).
 */
export function getBrokenAnchors(docUri: string): InMemoryAnchorState[] {
  const fileState = anchorState.get(docUri);
  if (!fileState) return [];

  return Array.from(fileState.values()).filter(s => s.status === 'broken');
}

/**
 * Get anchors that need deep-flex checking (lineCache found but context outside flex=5).
 * Only returns anchors where lastDeepFlexAt < lastValidatedAt (new state to check).
 */
export function getDeepFlexAnchors(docUri: string): InMemoryAnchorState[] {
  const fileState = anchorState.get(docUri);
  if (!fileState) return [];

  return Array.from(fileState.values()).filter(s =>
    s.needsDeepFlex === true &&
    (!s.lastDeepFlexAt || s.lastDeepFlexAt < s.lastValidatedAt)
  );
}

/**
 * Update anchor state after auto-repair.
 */
export function updateAnchorState(
  docUri: string,
  bookmarkId: string,
  line: number,
  status: AnchorStatus = 'valid'
): void {
  const fileState = anchorState.get(docUri);
  if (!fileState) return;

  const state = fileState.get(bookmarkId);
  if (state) {
    state.resolvedLine = line;
    state.status = status;
    state.lastValidatedAt = Date.now();
    state.errorCode = undefined;
    state.errorDetails = undefined;
  }
}

/**
 * Update deep-flex tracking state after a deep-flex check completes.
 * Sets lastDeepFlexAt and clears needsDeepFlex.
 */
export function updateDeepFlexState(
  docUri: string,
  bookmarkId: string,
  checked: boolean
): void {
  const fileState = anchorState.get(docUri);
  if (!fileState) return;

  const state = fileState.get(bookmarkId);
  if (state && checked) {
    state.lastDeepFlexAt = Date.now();
    state.needsDeepFlex = undefined;
  }
}

/**
 * Mark a single bookmark as broken without requiring the file to be open.
 * Used when the bookmark's target file is missing (deleted/moved).
 */
export function markBookmarkBroken(
  docUri: string,
  bookmarkId: string,
  errorCode: AnchorErrorCode,
  errorDetails: string,
): void {
  if (!anchorState.has(docUri)) {
    anchorState.set(docUri, new Map());
  }
  const fileMap = anchorState.get(docUri)!;
  fileMap.set(bookmarkId, {
    bookmarkId,
    resolvedLine: -1,
    status: 'broken',
    lastValidatedAt: Date.now(),
    errorCode,
    errorDetails,
  });
}

/**
 * Check if we have state for a file.
 */
export function hasStateForFile(docUri: string): boolean {
  return anchorState.has(docUri);
}

/**
 * Get all state for a file (for debugging).
 */
export function getStateForFile(docUri: string): Map<string, InMemoryAnchorState> | undefined {
  return anchorState.get(docUri);
}
