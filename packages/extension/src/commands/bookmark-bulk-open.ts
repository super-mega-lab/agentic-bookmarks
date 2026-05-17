// ABOUTME: VS Code glue for bulk-loading bookmark-bearing files — registers the
// ABOUTME: openAllFiles / scanAllFiles command pairs (visible + including-hidden).

/**
 * Bulk Open / Scan commands.
 *
 * Commands:
 *   agenticBookmarks.openAllFiles
 *     Loads every visible-bookmark file and surfaces each as a non-preview
 *     background tab (preserveFocus: true). Honors UI visibility
 *     (filterEnabled + hidden groups + hidden files + search filters), matching
 *     listAll's scope.
 *
 *   agenticBookmarks.openAllFilesIncludingHidden
 *     Loads every registered file (enabled !== false) with at least one
 *     bookmark, regardless of UI visibility. Mirrors clearAll's scope.
 *
 *   agenticBookmarks.scanAllFiles
 *     Same scope as openAllFiles, but loads each file via
 *     workspace.openTextDocument WITHOUT showing a tab. Triggers anchor
 *     validation / decoration registration as a side effect.
 *
 *   agenticBookmarks.scanAllFilesIncludingHidden
 *     Same scope as openAllFilesIncludingHidden, no tabs.
 *
 * Tab order: alphabetical by workspace-relative path (stable, deterministic).
 * Already-open files: VS Code's showTextDocument natural dedupe is relied upon;
 * no selection/revealRange is passed so the active tab's viewport is unchanged.
 * Progress notification: cancellable, surfaces when target count exceeds 5.
 */

import * as vscode from 'vscode';
import { type WorkspaceRegistryV1 } from '@agentic-bookmarks/core';
import type { Logger } from '../logger';
import { loadAllFolders } from './bookmark-loaders';
import { composeFileHiddenPredicate } from './bookmark-loaders-helpers';
import { type SearchFilter, type Visibility } from './bookmark-quickpick-items';
import {
  collectAllRegisteredBookmarkedFiles,
  collectVisibleBookmarkedFiles,
  type BulkOpenTarget,
} from './bookmark-bulk-open-helpers';

export interface BookmarkBulkOpenDeps {
  workspaceRoot: string;
  log: Logger;
  getUIState: () => {
    hidden: string[];
    focus: string | null;
    filterEnabled?: boolean;
    hiddenFiles?: string[];
    searches?: SearchFilter[];
  };
  isFileHidden: (fileId: string, reg: WorkspaceRegistryV1) => boolean;
}

type BulkOpenMode = 'open' | 'scan';
type BulkOpenScope = 'visible' | 'all';

/** Surface progress notification when the target count exceeds this. */
const PROGRESS_THRESHOLD = 5;

/**
 * Load + filter + sort targets for the chosen scope. Returns the empty list
 * (no error message) when no targets are found — caller decides how to react.
 */
async function collectTargets(
  deps: BookmarkBulkOpenDeps,
  scope: BulkOpenScope
): Promise<BulkOpenTarget[]> {
  const { workspaceRoot, log, getUIState, isFileHidden } = deps;

  const { folders, filesData } = await loadAllFolders(log, workspaceRoot);

  if (scope === 'all') {
    return collectAllRegisteredBookmarkedFiles({ folders, filesData });
  }

  const ui = getUIState();
  const visibility: Visibility = {
    hidden: ui.hidden,
    focus: ui.focus,
    filterEnabled: ui.filterEnabled === true,
    searches: ui.searches,
  };

  const composedIsFileHidden = composeFileHiddenPredicate(folders, filesData, visibility, isFileHidden);

  return collectVisibleBookmarkedFiles({
    filesData,
    visibility,
    composedIsFileHidden,
  });
}

/**
 * Iterate `targets`, calling openTextDocument (and optionally showTextDocument)
 * on each. Wraps in withProgress when count > PROGRESS_THRESHOLD. Per-file
 * try/catch: a failed load increments the failure counter and is logged, but
 * iteration continues. Cancellation is checked at the start of every iteration.
 */
async function openOrScanFiles(
  deps: BookmarkBulkOpenDeps,
  mode: BulkOpenMode,
  targets: BulkOpenTarget[]
): Promise<void> {
  const verb = mode === 'open' ? 'Opening' : 'Scanning';
  const past = mode === 'open' ? 'Opened' : 'Scanned';

  let succeeded = 0;
  let failed = 0;
  let cancelled = false;

  const runOne = async (target: BulkOpenTarget): Promise<void> => {
    const cmdLabel = mode === 'open' ? 'openAllFiles' : 'scanAllFiles';
    let doc: vscode.TextDocument;
    try {
      const uri = vscode.Uri.file(target.fsPath);
      doc = await vscode.workspace.openTextDocument(uri);
    } catch (err) {
      // Load failed — no anchor validation, no tab, nothing accomplished.
      // This is the only case that counts as a failure for the user-facing tally.
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      deps.log.error(`${cmdLabel}: failed to load ${target.fsPath}: ${msg}`);
      return;
    }

    if (mode === 'open') {
      try {
        // preview:false → permanent tab. preserveFocus:true → active editor
        // unchanged. viewColumn:Active → tabs land in the focused column.
        // Explicitly DO NOT pass selection or revealRange — already-open
        // files would otherwise have their viewport disturbed.
        await vscode.window.showTextDocument(doc, {
          preview: false,
          preserveFocus: true,
          viewColumn: vscode.ViewColumn.Active,
        });
      } catch (err) {
        // Doc IS loaded (anchor validation already fired). The tab just
        // couldn't be shown — log it but count as succeeded since the
        // primary side effect happened.
        const msg = err instanceof Error ? err.message : String(err);
        deps.log.error(
          `${cmdLabel}: loaded ${target.fsPath} but failed to show as tab: ${msg}`
        );
      }
    }
    succeeded += 1;
  };

  const iterate = async (
    progress?: vscode.Progress<{ increment?: number; message?: string }>,
    token?: vscode.CancellationToken
  ): Promise<void> => {
    const total = targets.length;
    const step = total > 0 ? 100 / total : 0;
    for (let i = 0; i < total; i++) {
      if (token?.isCancellationRequested) {
        cancelled = true;
        return;
      }
      const target = targets[i];
      progress?.report({
        message: `${i + 1} of ${total}: ${target.relativePath}`,
        increment: step,
      });
      await runOne(target);
    }
  };

  if (targets.length > PROGRESS_THRESHOLD) {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        cancellable: true,
        title: `${verb} ${targets.length} bookmarked file${targets.length === 1 ? '' : 's'}…`,
      },
      async (progress, token) => {
        await iterate(progress, token);
      }
    );
  } else {
    await iterate();
  }

  const parts: string[] = [`${past} ${succeeded} file${succeeded === 1 ? '' : 's'}`];
  if (failed > 0) parts.push(`${failed} failed`);
  if (cancelled) parts.push('cancelled');
  vscode.window.showInformationMessage(parts.join(' · '));
}

async function runCommand(
  deps: BookmarkBulkOpenDeps,
  mode: BulkOpenMode,
  scope: BulkOpenScope
): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    vscode.window.showWarningMessage('No workspace folder open');
    return;
  }
  const targets = await collectTargets(deps, scope);
  if (targets.length === 0) {
    vscode.window.showInformationMessage('No bookmarks found');
    return;
  }
  await openOrScanFiles(deps, mode, targets);
}

export function registerBookmarkBulkOpenCommands(
  deps: BookmarkBulkOpenDeps
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('agenticBookmarks.openAllFiles', async () => {
      await runCommand(deps, 'open', 'visible');
    }),
    vscode.commands.registerCommand(
      'agenticBookmarks.openAllFilesIncludingHidden',
      async () => {
        await runCommand(deps, 'open', 'all');
      }
    ),
    vscode.commands.registerCommand('agenticBookmarks.scanAllFiles', async () => {
      await runCommand(deps, 'scan', 'visible');
    }),
    vscode.commands.registerCommand(
      'agenticBookmarks.scanAllFilesIncludingHidden',
      async () => {
        await runCommand(deps, 'scan', 'all');
      }
    ),
  ];
}
