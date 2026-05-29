/**
 * Centralized revalidate→decorate ordering invariant.
 *
 * The order MUST be: re-resolve anchors for the relevant open document(s)
 * FIRST, THEN repaint the gutter/dot decorations against the refreshed
 * in-memory state. Painting before revalidating leaves a stale broken "!"
 * gutter overlay until the file is reopened (SML-1491).
 *
 * The resolve step is wrapped in a try/catch so a transient resolution error
 * still lets the repaint run, and never escapes as an unhandled rejection
 * (SML-1495). The repaint itself is intentionally NOT guarded — that matches
 * the behavior at every existing call site, none of which guard the repaint.
 *
 * This module owns the invariant so call sites no longer hand-roll (and drift
 * from) the revalidate→guard→repaint sequence (SML-1496).
 */

import type * as vscode from 'vscode';
import type { Logger } from './logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RevalidateAndRepaintDeps {
  /** Re-resolve anchors for all open docs that already have in-memory state. */
  revalidateOpenDocuments: () => Promise<void>;
  /** Resolve anchors for one specific document (the wrapped onFileOpened from extension.ts). */
  onFileOpened: (document: vscode.TextDocument) => Promise<void>;
  /** Repaint gutter/dot decorations from current in-memory state. */
  updateDecorations: () => Promise<void>;
  log: Pick<Logger, 'error'>;
}

export interface RevalidateAndRepaint {
  /** Re-resolve ALL open docs, THEN repaint. For rename / pulse / manual-refresh sites. */
  revalidateAndRepaint: () => Promise<void>;
  /** Resolve ONE doc, THEN repaint. For the document-open site. */
  openAndRepaint: (document: vscode.TextDocument) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRevalidateAndRepaint(deps: RevalidateAndRepaintDeps): RevalidateAndRepaint {
  const { revalidateOpenDocuments, onFileOpened, updateDecorations, log } = deps;

  // Re-resolve anchors via `resolve` (guarded), THEN repaint exactly once.
  // The guard wraps only the resolve step so the repaint always runs even when
  // resolution throws (SML-1491/SML-1495).
  async function repaintAfter(resolve: () => Promise<void>): Promise<void> {
    try {
      await resolve();
    } catch (err) {
      log.error(`[revalidateAndRepaint] resolve step failed: ${err}`);
    }
    await updateDecorations();
  }

  return {
    revalidateAndRepaint: () => repaintAfter(revalidateOpenDocuments),
    openAndRepaint: (document) => repaintAfter(() => onFileOpened(document)),
  };
}
