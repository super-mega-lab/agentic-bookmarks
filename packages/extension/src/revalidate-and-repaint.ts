/**
 * Centralized revalidate→decorate ordering invariant.
 *
 * The order MUST be: re-resolve anchors for the relevant open document(s)
 * FIRST, THEN repaint the gutter/dot decorations against the refreshed
 * in-memory state. Painting before revalidating leaves a stale broken "!"
 * gutter overlay until the file is reopened (SML-1491).
 *
 * Both steps are wrapped in try/catch: a transient resolution error still lets
 * the repaint run (SML-1491), and a failing repaint is caught + logged rather
 * than escaping as an unhandled rejection. Guarding the repaint too makes the
 * "never an unhandled rejection" guarantee total — important because some
 * callers (e.g. the debounced watcher pulse) invoke this fire-and-forget
 * (SML-1495/SML-1499).
 *
 * This module owns the invariant so call sites no longer hand-roll (and drift
 * from) the revalidate→guard→repaint sequence (SML-1496). Sites that don't fit
 * the 1:1 / all-docs shapes route through the generic `repaintAfter` primitive
 * rather than re-pairing a raw resolve with a raw `updateDecorations` (SML-1499).
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
  /**
   * Generic guarded primitive: run `resolve` (guarded), THEN repaint exactly
   * once (also guarded). For sites that don't fit the 1:1 / all-docs shapes —
   * conditional resolve (active-editor) and N:1 resolve-many→paint-once
   * (activation init-loop). `context` labels the step for error logs.
   */
  repaintAfter: (resolve: () => Promise<void>, context: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRevalidateAndRepaint(deps: RevalidateAndRepaintDeps): RevalidateAndRepaint {
  const { revalidateOpenDocuments, onFileOpened, updateDecorations, log } = deps;

  // Re-resolve anchors via `resolve` (guarded), THEN repaint exactly once (also
  // guarded). The resolve guard keeps the repaint running even when resolution
  // throws (SML-1491); the repaint guard keeps a failing paint from escaping as
  // an unhandled rejection at fire-and-forget callers (SML-1495/SML-1499).
  // `context` names the failing step (and the document, for the open path) so a
  // logged failure stays triageable.
  async function repaintAfter(resolve: () => Promise<void>, context: string): Promise<void> {
    try {
      await resolve();
    } catch (err) {
      log.error(`[revalidateAndRepaint] ${context} failed: ${err}`);
    }
    try {
      await updateDecorations();
    } catch (err) {
      log.error(`[revalidateAndRepaint] repaint after ${context} failed: ${err}`);
    }
  }

  return {
    repaintAfter,
    revalidateAndRepaint: () => repaintAfter(revalidateOpenDocuments, 'revalidateOpenDocuments'),
    openAndRepaint: (document) =>
      repaintAfter(() => onFileOpened(document), `onFileOpened(${document.uri})`),
  };
}
