/**
 * Background repair queue for broken smart anchors.
 *
 * Defers git-history-based repair off the file-open hot path.
 * Processes broken anchors with debouncing, cancellation, and timeouts.
 */

import * as vscode from 'vscode';
import { FLEX_REPAIR_WINDOW } from '@agentic-bookmarks/core';
import type { InMemoryAnchorState } from './anchorState';

export interface AutoRepairResult {
  bookmarkId: string;
  status: 'candidate' | 'skipped';
  reason?: string;
  debug?: Record<string, unknown>;
  candidate?: {
    bookmarkId: string;
    candidateLine: number;
    score: number;
    tracedFromCommit: string;
  };
}

export interface RepairQueueDeps {
  /** Get broken anchors for a document URI */
  getBrokenAnchors: (docUri: string) => InMemoryAnchorState[];
  /** Get anchors needing deep-flex check (lineCache found but context outside flex=5) */
  getDeepFlexAnchors: (docUri: string) => InMemoryAnchorState[];
  /** Get the full bookmark anchor data by bookmark ID */
  getBookmarkAnchor: (bookmarkId: string) => Promise<{ anchor: any; targetRelPath: string; workspaceRoot: string; bookmarksDataFilePath: string } | null>;
  /** Find a repair candidate for a broken anchor */
  findRepairCandidate: (
    anchor: any,
    bookmarkId: string,
    repoPath: string,
    targetRelPath: string,
    currentFileLines: string[],
    options?: { canUseGit?: boolean; bookmarksDataFilePath?: string; enableFlexContext?: boolean; flexWindow?: number },
  ) => Promise<AutoRepairResult>;
  /** Apply a repair: create new anchor at candidate line and write to disk */
  applyRepair: (bookmarkId: string, candidateLine: number) => Promise<boolean>;
  /** Update in-memory anchor state after repair */
  updateAnchorState: (docUri: string, bookmarkId: string, line: number, status?: 'valid' | 'warning' | 'broken') => void;
  /** Update deep-flex tracking state after a deep-flex check */
  updateDeepFlexState: (docUri: string, bookmarkId: string, checked: boolean) => void;
  /** Refresh the tree view */
  refreshUI: () => void;
  /** Get current file lines for a URI (from editor buffer or disk) */
  getFileLines: (docUri: string) => string[] | null;
  /** Log to output channel */
  log: (message: string) => void;
}

const DEBOUNCE_MS = 500;
const PER_FILE_TIMEOUT_MS = 3000;

export class AnchorRepairQueue implements vscode.Disposable {
  private pending = new Set<string>();
  private pendingDeepFlex = new Set<string>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private deepFlexDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;
  private disposed = false;
  private editedSinceEnqueue = new Set<string>();

  constructor(private deps: RepairQueueDeps) {}

  /**
   * Enqueue a file URI for background repair processing.
   * Resets the debounce timer on each call.
   */
  enqueue(docUri: string): void {
    if (this.disposed) return;

    // Check if autoRepair is enabled
    const enabled = vscode.workspace.getConfiguration('agenticBookmarks').get('autoRepair', true);
    if (!enabled) return;
    this.pending.add(docUri);
    this.editedSinceEnqueue.delete(docUri);

    // Reset debounce
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.processQueue();
    }, DEBOUNCE_MS);
  }

  /**
   * Enqueue a file for deep-flex position check only.
   * NOT gated by autoRepair — always runs because it only updates
   * in-memory display state. The actual disk write (applyRepair)
   * is still gated by autoRepair inside the processing loop.
   */
  enqueueDeepFlexOnly(docUri: string): void {
    if (this.disposed) return;
    this.pendingDeepFlex.add(docUri);

    if (this.deepFlexDebounceTimer) {
      clearTimeout(this.deepFlexDebounceTimer);
    }
    this.deepFlexDebounceTimer = setTimeout(() => {
      this.deepFlexDebounceTimer = null;
      this.processDeepFlexQueue();
    }, DEBOUNCE_MS);
  }

  /**
   * Cancel pending repair for a file (called on file close).
   */
  cancel(docUri: string): void {
    this.pending.delete(docUri);
    this.pendingDeepFlex.delete(docUri);
    this.editedSinceEnqueue.delete(docUri);
  }

  /**
   * Mark a file as edited (skip repair if edited between enqueue and processing).
   */
  markEdited(docUri: string): void {
    if (this.pending.has(docUri)) {
      this.editedSinceEnqueue.add(docUri);
    }
    // Also cancel pending deep-flex for edited files
    this.pendingDeepFlex.delete(docUri);
  }

  /**
   * True when both queues are drained and no processing/debounce is in flight.
   * Used by the action rows to avoid refreshing counts mid-repair.
   */
  isIdle(): boolean {
    return (
      !this.processing &&
      this.pending.size === 0 &&
      this.pendingDeepFlex.size === 0 &&
      this.debounceTimer === null &&
      this.deepFlexDebounceTimer === null
    );
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.deepFlexDebounceTimer) {
      clearTimeout(this.deepFlexDebounceTimer);
      this.deepFlexDebounceTimer = null;
    }
    this.pending.clear();
    this.pendingDeepFlex.clear();
    this.editedSinceEnqueue.clear();
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.disposed) return;
    this.processing = true;

    try {
      while (this.pending.size > 0 && !this.disposed) {
        const docUri = this.pending.values().next().value!;
        this.pending.delete(docUri);

        // Skip if file was edited since enqueue
        if (this.editedSinceEnqueue.has(docUri)) {
          this.editedSinceEnqueue.delete(docUri);
          this.deps.log(`[autoRepair] Skipping ${docUri} — file was edited`);
          continue;
        }

        const enabled = vscode.workspace.getConfiguration('agenticBookmarks').get('autoRepair', true);
        if (!enabled) {
          this.deps.log(`[autoRepair] Skipping ${docUri} — bookmarks.autoRepair is disabled`);
          continue;
        }
        await this.processFile(docUri);

        // Yield to event loop between files
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally {
      this.processing = false;
    }
  }

  private async processFile(docUri: string): Promise<void> {
    const brokenAnchors = this.deps.getBrokenAnchors(docUri);
    if (brokenAnchors.length === 0) return;

    this.deps.log(`[autoRepair] Processing ${brokenAnchors.length} broken anchors in ${docUri}`);

    let repairCount = 0;
    const deadline = Date.now() + PER_FILE_TIMEOUT_MS;

    for (const anchor of brokenAnchors) {
      if (this.disposed || Date.now() > deadline) {
        if (Date.now() > deadline) {
          this.deps.log(`[autoRepair] Timeout reached for ${docUri}, stopping`);
        }
        break;
      }

      try {
        const bookmarkData = await this.deps.getBookmarkAnchor(anchor.bookmarkId);
        if (!bookmarkData) continue;

        const fileLines = this.deps.getFileLines(docUri);
        if (!fileLines) continue;

        const canUseGit = vscode.workspace.getConfiguration('agenticBookmarks').get('autoRepairCanUseGit', true);
        const result = await this.deps.findRepairCandidate(
          bookmarkData.anchor,
          anchor.bookmarkId,
          bookmarkData.workspaceRoot,
          bookmarkData.targetRelPath,
          fileLines,
          { canUseGit, bookmarksDataFilePath: bookmarkData.bookmarksDataFilePath },
        );

        if (result.status === 'candidate' && result.candidate) {
          if (result.debug) {
            this.deps.log(`[autoRepairDebug] Candidate details for ${anchor.bookmarkId}: ${JSON.stringify(result.debug)}`);
          }
          const applied = await this.deps.applyRepair(
            anchor.bookmarkId,
            result.candidate.candidateLine,
          );

          if (applied) {
            this.deps.updateAnchorState(docUri, anchor.bookmarkId, result.candidate.candidateLine, 'valid');
            repairCount++;
            this.deps.log(
              `[autoRepair] Repaired ${anchor.bookmarkId}: line ${anchor.resolvedLine} → ${result.candidate.candidateLine} (score: ${result.candidate.score.toFixed(2)})`,
            );
          } else if (result.debug) {
            this.deps.log(`[autoRepairDebug] Failed to apply candidate for ${anchor.bookmarkId}: ${JSON.stringify(result.debug)}`);
          }
        } else if (result.status === 'skipped') {
          this.deps.log(`[autoRepair] Skipped ${anchor.bookmarkId}: ${result.reason}`);
          if (result.debug) {
            this.deps.log(`[autoRepairDebug] Skip details for ${anchor.bookmarkId}: ${JSON.stringify(result.debug)}`);
          }
        }
      } catch (err: any) {
        this.deps.log(`[autoRepair] Error processing ${anchor.bookmarkId}: ${err?.message || err}`);
      }

      // Yield between anchors
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    // Deep-flex pass: process anchors where lineCache was found but context
    // was outside the resolution flex window (flex=5). Try with repair window (flex=100).
    const deepFlexAnchors = this.deps.getDeepFlexAnchors(docUri);
    if (deepFlexAnchors.length > 0) {
      this.deps.log(`[autoRepair] Processing ${deepFlexAnchors.length} deep-flex anchors in ${docUri}`);
    }

    for (const anchor of deepFlexAnchors) {
      if (this.disposed || Date.now() > deadline) break;

      try {
        const bookmarkData = await this.deps.getBookmarkAnchor(anchor.bookmarkId);
        if (!bookmarkData) {
          this.deps.updateDeepFlexState(docUri, anchor.bookmarkId, true);
          continue;
        }

        const fileLines = this.deps.getFileLines(docUri);
        if (!fileLines) {
          this.deps.updateDeepFlexState(docUri, anchor.bookmarkId, true);
          continue;
        }

        const canUseGit = vscode.workspace.getConfiguration('agenticBookmarks').get('autoRepairCanUseGit', true);
        const result = await this.deps.findRepairCandidate(
          bookmarkData.anchor,
          anchor.bookmarkId,
          bookmarkData.workspaceRoot,
          bookmarkData.targetRelPath,
          fileLines,
          {
            canUseGit,
            bookmarksDataFilePath: bookmarkData.bookmarksDataFilePath,
            enableFlexContext: true,
            flexWindow: FLEX_REPAIR_WINDOW,
          },
        );

        if (result.status === 'candidate' && result.candidate) {
          this.deps.log(`[autoRepair:deepFlex] Candidate found for ${anchor.bookmarkId} at line ${result.candidate.candidateLine} (score: ${result.candidate.score.toFixed(2)})`);
          const applied = await this.deps.applyRepair(
            anchor.bookmarkId,
            result.candidate.candidateLine,
          );

          if (applied) {
            this.deps.updateAnchorState(docUri, anchor.bookmarkId, result.candidate.candidateLine, 'valid');
            repairCount++;
            this.deps.log(
              `[autoRepair:deepFlex] Repaired ${anchor.bookmarkId}: → line ${result.candidate.candidateLine}`,
            );
          }
        } else {
          this.deps.log(`[autoRepair:deepFlex] No candidate for ${anchor.bookmarkId}: ${result.reason ?? 'unknown'}`);
        }

        // Mark as checked regardless of outcome
        this.deps.updateDeepFlexState(docUri, anchor.bookmarkId, true);
      } catch (err: any) {
        this.deps.log(`[autoRepair:deepFlex] Error processing ${anchor.bookmarkId}: ${err?.message || err}`);
        this.deps.updateDeepFlexState(docUri, anchor.bookmarkId, true);
      }

      await new Promise(resolve => setTimeout(resolve, 0));
    }

    if (repairCount > 0) {
      this.deps.log(`[autoRepair] Repaired ${repairCount} anchors in ${docUri}`);
      this.deps.refreshUI();
    }
  }

  /**
   * Process the deep-flex-only queue. NOT gated by autoRepair.
   * Only processes needsDeepFlex anchors. Updates in-memory display state.
   * Disk writes (applyRepair) are still gated by autoRepair.
   */
  private async processDeepFlexQueue(): Promise<void> {
    // Allow concurrent with main queue — deep flex is lower priority but independent
    if (this.disposed) return;

    while (this.pendingDeepFlex.size > 0 && !this.disposed) {
      const docUri = this.pendingDeepFlex.values().next().value!;
      this.pendingDeepFlex.delete(docUri);

      await this.processDeepFlexFile(docUri);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  private async processDeepFlexFile(docUri: string): Promise<void> {
    const deepFlexAnchors = this.deps.getDeepFlexAnchors(docUri);
    if (deepFlexAnchors.length === 0) return;

    this.deps.log(`[deepFlex] Processing ${deepFlexAnchors.length} deep-flex anchors in ${docUri}`);
    const autoRepairEnabled = vscode.workspace.getConfiguration('agenticBookmarks').get('autoRepair', true);
    const deadline = Date.now() + PER_FILE_TIMEOUT_MS;
    let updated = false;

    for (const anchor of deepFlexAnchors) {
      if (this.disposed || Date.now() > deadline) break;

      try {
        const bookmarkData = await this.deps.getBookmarkAnchor(anchor.bookmarkId);
        if (!bookmarkData) {
          this.deps.updateDeepFlexState(docUri, anchor.bookmarkId, true);
          continue;
        }

        const fileLines = this.deps.getFileLines(docUri);
        if (!fileLines) {
          this.deps.updateDeepFlexState(docUri, anchor.bookmarkId, true);
          continue;
        }

        const canUseGit = vscode.workspace.getConfiguration('agenticBookmarks').get('autoRepairCanUseGit', true);
        const result = await this.deps.findRepairCandidate(
          bookmarkData.anchor,
          anchor.bookmarkId,
          bookmarkData.workspaceRoot,
          bookmarkData.targetRelPath,
          fileLines,
          {
            canUseGit,
            bookmarksDataFilePath: bookmarkData.bookmarksDataFilePath,
            enableFlexContext: true,
            flexWindow: FLEX_REPAIR_WINDOW,
          },
        );

        if (result.status === 'candidate' && result.candidate) {
          if (autoRepairEnabled) {
            // Full repair: write new anchor to disk
            const applied = await this.deps.applyRepair(
              anchor.bookmarkId,
              result.candidate.candidateLine,
            );
            if (applied) {
              this.deps.updateAnchorState(docUri, anchor.bookmarkId, result.candidate.candidateLine, 'valid');
              updated = true;
              this.deps.log(`[deepFlex] Repaired ${anchor.bookmarkId}: → line ${result.candidate.candidateLine}`);
            }
          } else {
            // Display-only: update in-memory position without writing to disk
            this.deps.updateAnchorState(docUri, anchor.bookmarkId, result.candidate.candidateLine, 'warning');
            updated = true;
            this.deps.log(`[deepFlex] Updated display for ${anchor.bookmarkId}: → line ${result.candidate.candidateLine} (autoRepair off, display-only)`);
          }
        } else {
          this.deps.log(`[deepFlex] No candidate for ${anchor.bookmarkId}: ${result.reason ?? 'unknown'}`);
        }

        this.deps.updateDeepFlexState(docUri, anchor.bookmarkId, true);
      } catch (err: any) {
        this.deps.log(`[deepFlex] Error processing ${anchor.bookmarkId}: ${err?.message || err}`);
        this.deps.updateDeepFlexState(docUri, anchor.bookmarkId, true);
      }

      await new Promise(resolve => setTimeout(resolve, 0));
    }

    if (updated) {
      this.deps.refreshUI();
    }
  }
}
