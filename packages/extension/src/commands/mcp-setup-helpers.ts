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
 * Builds the bare `claude mcp remove agentic_bookmarks --scope <scope>` command.
 * Used by the uninstall flow directly, and embedded with stderr suppression
 * by `buildClaudeMcpSetupCommand` so the install's pre-clean step succeeds on
 * first-time runs where no prior entry exists.
 */
export function buildClaudeMcpRemoveCommand(scope: 'local' | 'user'): string {
  return `claude mcp remove agentic_bookmarks --scope ${scope}`;
}

function buildClaudeMcpAddCommand(
  scope: 'local' | 'user',
  serverPath: string,
  bookmarksDir: string,
): string {
  const envFlags =
    scope === 'local'
      ? `--env ${shellQuote(`BOOKMARKS_DIR=${bookmarksDir}`)}`
      : '--env BOOKMARKS_DIR= --env BOOKMARKS_UPWARD_DISCOVERY=true';
  return (
    `claude mcp add --transport stdio ${envFlags} --scope ${scope} ` +
    `agentic_bookmarks -- node ${shellQuote(serverPath)}`
  );
}

/**
 * Builds the terminal command string for setting up the agentic-bookmarks
 * MCP server in Claude Code. Removes from both local and user scopes first
 * so re-runs and scope switches succeed without a "already exists" error.
 *
 * Accepts either a single scope (target scope replaces any prior install at
 * either scope) or an array of scopes (install at every listed scope in one
 * combined shell invocation). The array form is used by the Update-all and
 * dual-scope smart-update paths so re-installing both Local and User in one
 * pass doesn't have the second invocation wipe the first.
 *
 * @param scopes     'local' | 'user' | Array<'local' | 'user'>
 * @param serverPath Absolute path to server-bundle/index.js
 * @param bookmarksDir Absolute path to .bookmarks/local for local scope; ignored for user scope
 */
export function buildClaudeMcpSetupCommand(
  scopes: 'local' | 'user' | Array<'local' | 'user'>,
  serverPath: string,
  bookmarksDir: string,
): string {
  const scopesArr: Array<'local' | 'user'> = Array.isArray(scopes) ? scopes : [scopes];
  const addLines = scopesArr.map((s) => buildClaudeMcpAddCommand(s, serverPath, bookmarksDir));
  return (
    `${buildClaudeMcpRemoveCommand('local')} 2>/dev/null; ` +
    `${buildClaudeMcpRemoveCommand('user')} 2>/dev/null; ` +
    addLines.join('; ')
  );
}
