// ABOUTME: Pure helpers for MCP setup: command string construction and gitignore application.
// ABOUTME: Extracted for testability — no VS Code API dependencies.

import {
  appendGitignoreLine as defaultAppendGitignoreLine,
  BOOKMARKS_LOCAL_GITIGNORE_LINE,
} from '@agentic-bookmarks/core';
import { GITIGNORE_NUDGE_SHOWN_KEY, type WorkspaceStateLike } from '../gitignore-nudge';

export interface ApplyGitignoreSetupDeps {
  workspaceRoot: string;
  workspaceState: WorkspaceStateLike;
  log: { error(msg: string): void; info(msg: string): void };
  appendGitignoreLineFn?: typeof defaultAppendGitignoreLine;
}

/**
 * Applies the `.bookmarks/local/` gitignore entry and suppresses the standalone
 * gitignore nudge so the user isn't prompted again after MCP setup already handled it.
 * Never throws — errors are logged and silently swallowed so MCP setup still succeeds.
 */
export async function applyGitignoreSetup(deps: ApplyGitignoreSetupDeps): Promise<void> {
  const { workspaceRoot, workspaceState, log, appendGitignoreLineFn = defaultAppendGitignoreLine } = deps;
  try {
    const status = await appendGitignoreLineFn(workspaceRoot, BOOKMARKS_LOCAL_GITIGNORE_LINE);
    log.info(`[mcpSetup] .gitignore update: status=${status} at ${workspaceRoot}`);
    await workspaceState.update(GITIGNORE_NUDGE_SHOWN_KEY, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`[mcpSetup] Failed to update .gitignore at ${workspaceRoot}: ${msg}`);
  }
}

// Quote a value for POSIX shell (single-quote style).
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Builds the terminal command string for setting up the agentic-bookmarks
 * MCP server in Claude Code. Removes from both local and user scopes first
 * so re-runs and scope switches succeed without a "already exists" error.
 *
 * @param scope      'local' (project-only) or 'user' (all projects)
 * @param serverPath Absolute path to server-bundle/index.js
 * @param bookmarksDir Absolute path to .bookmarks/local for local scope; ignored for user scope
 */
export function buildClaudeMcpSetupCommand(
  scope: 'local' | 'user',
  serverPath: string,
  bookmarksDir: string,
): string {
  const envFlags =
    scope === 'local'
      ? `--env ${shellQuote(`BOOKMARKS_DIR=${bookmarksDir}`)}`
      : '--env BOOKMARKS_DIR= --env BOOKMARKS_UPWARD_DISCOVERY=true';

  return (
    `claude mcp remove agentic_bookmarks --scope local 2>/dev/null; ` +
    `claude mcp remove agentic_bookmarks --scope user 2>/dev/null; ` +
    `claude mcp add --transport stdio ${envFlags} --scope ${scope} ` +
    `agentic_bookmarks -- node ${shellQuote(serverPath)}`
  );
}
