// ABOUTME: One-time, dismissable activation-time nudge that prompts the user to add
// ABOUTME: `.bookmarks/local/` to .gitignore when machine-local files are tracked in git.
/**
 * Per SML-1335: detection observes repo state (`git ls-files`) — not config
 * — and dismissal persists in `workspaceState` so the nudge fires at most
 * once per workspace. Detection and filesystem helpers live in
 * `@agentic-bookmarks/core`; this module supplies only the vscode-side
 * orchestration (Memento, message API).
 */

import {
  BOOKMARKS_LOCAL_GITIGNORE_LINE,
  appendGitignoreLine as defaultAppendGitignoreLine,
  listTrackedLocalFiles as defaultListTrackedLocalFiles,
} from '@agentic-bookmarks/core';

/** Workspace-state key. The "V1" suffix lets us re-prompt later if we ever change the message. */
export const GITIGNORE_NUDGE_SHOWN_KEY = 'agenticBookmarks.gitignoreNudgeShownV1';

const ADD_BUTTON = 'Add to .gitignore';
const DISMISS_BUTTON = "Don't show again";

/** Subset of `vscode.Memento` we depend on. Lets tests inject a Map-backed double. */
export interface WorkspaceStateLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

/** Subset of the logger surface used at activation time. */
export interface NudgeLog {
  error(msg: string): void;
  info(msg: string): void;
}

/** Dependencies for {@link maybeShowGitignoreNudge}. The helper-style fields are injectable for tests. */
export interface MaybeShowGitignoreNudgeDeps {
  workspaceRoot: string;
  workspaceState: WorkspaceStateLike;
  log: NudgeLog;
  listTrackedLocalFiles?: typeof defaultListTrackedLocalFiles;
  appendGitignoreLine?: typeof defaultAppendGitignoreLine;
  showInformationMessage: (
    message: string,
    ...buttons: string[]
  ) => Thenable<string | undefined> | Promise<string | undefined>;
  showWarningMessage: (
    message: string,
  ) => Thenable<string | undefined> | Promise<string | undefined>;
}

/**
 * Prompt the user — at most once per workspace — to add `.bookmarks/local/`
 * to `.gitignore` when machine-local files are tracked in git. Always
 * resolves; never throws. Caller should `void` the result.
 *
 * Behavior:
 *   - If already shown: returns immediately, no git spawn, no UI.
 *   - If detection finds no tracked local files: returns silently and does
 *     NOT mark the workspace as shown (so a future activation can still
 *     nudge if the user accidentally adds local files later).
 *   - Otherwise: marks the workspace as shown synchronously, then displays
 *     the message. On "Add to .gitignore" the canonical line is appended
 *     idempotently; any other outcome is a no-op.
 */
export async function maybeShowGitignoreNudge(
  deps: MaybeShowGitignoreNudgeDeps,
): Promise<void> {
  const {
    workspaceRoot,
    workspaceState,
    log,
    listTrackedLocalFiles = defaultListTrackedLocalFiles,
    appendGitignoreLine = defaultAppendGitignoreLine,
    showInformationMessage,
    showWarningMessage,
  } = deps;

  if (workspaceState.get<boolean>(GITIGNORE_NUDGE_SHOWN_KEY) === true) {
    return;
  }

  let trackedFiles: string[];
  try {
    trackedFiles = await listTrackedLocalFiles(workspaceRoot);
  } catch (err) {
    log.error(`[gitignoreNudge] Detection failed for ${workspaceRoot}: ${stringifyError(err)}`);
    return;
  }

  if (trackedFiles.length === 0) {
    return;
  }

  try {
    await workspaceState.update(GITIGNORE_NUDGE_SHOWN_KEY, true);
  } catch (err) {
    log.error(`[gitignoreNudge] Failed to persist nudge flag for ${workspaceRoot}: ${stringifyError(err)}`);
    // Continue — showing the nudge is still better than silently failing.
  }

  const message = buildMessage(trackedFiles);
  let pick: string | undefined;
  try {
    pick = await showInformationMessage(message, ADD_BUTTON, DISMISS_BUTTON);
  } catch (err) {
    log.error(`[gitignoreNudge] showInformationMessage failed: ${stringifyError(err)}`);
    return;
  }

  if (pick !== ADD_BUTTON) {
    return;
  }

  try {
    const status = await appendGitignoreLine(workspaceRoot, BOOKMARKS_LOCAL_GITIGNORE_LINE);
    log.info(`[gitignoreNudge] appended .bookmarks/local/ to .gitignore (status=${status}) at ${workspaceRoot}`);
  } catch (err) {
    const msg = stringifyError(err);
    log.error(`[gitignoreNudge] Failed to update .gitignore at ${workspaceRoot}: ${msg}`);
    void showWarningMessage(`Bookmarks: failed to update .gitignore — ${msg}`);
  }
}

function buildMessage(trackedFiles: string[]): string {
  const sample = trackedFiles.slice(0, 3).join(', ');
  const more = trackedFiles.length > 3 ? ` (+${trackedFiles.length - 3} more)` : '';
  return (
    `Bookmarks: machine-local files are tracked in git (${sample}${more}). ` +
    `Add \`.bookmarks/local/\` to .gitignore so collaborators don't see churn from per-machine state.`
  );
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
