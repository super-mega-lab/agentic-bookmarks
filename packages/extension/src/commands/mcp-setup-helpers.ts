// ABOUTME: Pure helpers for MCP setup: command string construction and gitignore application.
// ABOUTME: Extracted for testability — no VS Code API dependencies.

import {
  appendGitignoreLine as defaultAppendGitignoreLine,
  BOOKMARKS_LOCAL_GITIGNORE_LINE,
} from '@agentic-bookmarks/core';
import { GITIGNORE_NUDGE_SHOWN_KEY, type WorkspaceStateLike } from '../gitignore-nudge';
import {
  type FsDeps,
  isMissing,
  SERVER_ID,
  DEFAULT_BACKUP_SUFFIX,
  DEFAULT_TMP_SUFFIX,
} from './mcp-uninstall-helpers';

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

// Legacy server keys upserts must strip so re-runs don't leave stale entries.
const LEGACY_SERVER_IDS = ['mcp.bookmarks', 'mcp_bookmarks'];

export interface CursorInstallOptions {
  configPath: string;
  /** Value written under `mcpServers.agentic_bookmarks` (e.g. { type, command, args, env }). */
  serverEntry: unknown;
  fs: FsDeps;
  /** Override the backup-path suffix; defaults to `.agentic-bookmarks-backup`. */
  backupSuffix?: string;
  /** Override the temp-file suffix; defaults to `.agentic-bookmarks.tmp`. */
  tmpSuffix?: string;
}

export type InstallResult =
  | { status: 'written' }     // config created or merged
  | { status: 'malformed' };  // existing file is not a valid JSON object; left untouched

/**
 * Upserts the `mcpServers.agentic_bookmarks` entry into Cursor's `mcp.json`,
 * mirroring the safety guards of `applyCursorUninstall` (SML-1518 / F-007):
 *
 *   1. Refuse-on-malformed: if the file is present but not valid JSON (or not a
 *      JSON object), returns 'malformed' WITHOUT writing — never clobbers other
 *      configured servers on a transient/structural parse error.
 *   2. One-shot backup: copies a valid existing file to `<path><backupSuffix>`
 *      before mutating it. (No backup when the file is absent — nothing to save.)
 *   3. Atomic write: writes to a sibling .tmp then renames over the target.
 *   4. Surgical: preserves sibling servers and top-level keys; drops only the
 *      legacy server names and (re)writes our own entry.
 *
 * A missing file (ENOENT/ENOTDIR) is the normal first-install case and proceeds
 * with an empty base. Any other read error is rethrown rather than swallowed, so
 * a permission/IO failure can never be mistaken for "empty" and clobber the file.
 */
export async function applyCursorInstall(opts: CursorInstallOptions): Promise<InstallResult> {
  const { configPath, serverEntry, fs } = opts;
  const backupSuffix = opts.backupSuffix ?? DEFAULT_BACKUP_SUFFIX;
  const tmpSuffix = opts.tmpSuffix ?? DEFAULT_TMP_SUFFIX;

  let raw: string | null = null;
  try {
    raw = await fs.readFile(configPath);
  } catch (err) {
    if (!isMissing(err)) throw err; // surface permission/IO errors; never clobber
    raw = null; // ENOENT/ENOTDIR — first install, no existing config
  }

  let existing: Record<string, any> = {};
  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: 'malformed' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { status: 'malformed' };
    }
    existing = parsed as Record<string, any>;
    // Back up the valid existing file once, before any mutation.
    await fs.copyFile(configPath, configPath + backupSuffix);
  }

  const existingServers =
    existing.mcpServers && typeof existing.mcpServers === 'object' && !Array.isArray(existing.mcpServers)
      ? { ...(existing.mcpServers as Record<string, any>) }
      : {};
  for (const legacyKey of LEGACY_SERVER_IDS) delete existingServers[legacyKey];

  const next = {
    ...existing,
    mcpServers: {
      ...existingServers,
      [SERVER_ID]: serverEntry,
    },
  };

  const tmpPath = configPath + tmpSuffix;
  await fs.writeFile(tmpPath, JSON.stringify(next, null, 2));
  await fs.rename(tmpPath, configPath);

  return { status: 'written' };
}

const CODEX_BLOCK_RE = /^\[mcp_servers\."agentic_bookmarks"\][\s\S]*?(?=^\[|(?![\s\S]))/m;
const CODEX_LEGACY_KEYS = ['mcp.bookmarks', 'mcp_bookmarks'];

export interface CodexInstallOptions {
  configPath: string;
  /** Complete TOML block text to upsert (e.g. '[mcp_servers."agentic_bookmarks"]\n...\n'). */
  serverBlock: string;
  fs: FsDeps;
  /** Override the backup-path suffix; defaults to `.agentic-bookmarks-backup`. */
  backupSuffix?: string;
  /** Override the temp-file suffix; defaults to `.agentic-bookmarks.tmp`. */
  tmpSuffix?: string;
}

/**
 * Upserts the `[mcp_servers."agentic_bookmarks"]` block into Codex's `config.toml`,
 * mirroring the safety guards of `applyCursorInstall` (SML-1578):
 *
 *   1. Only swallows ENOENT/ENOTDIR (first-install, no existing config); rethrows
 *      EACCES/EBUSY/etc. so a permission/IO failure can never be mistaken for "empty"
 *      and clobber the file.
 *   2. One-shot backup: copies a valid existing file to `<path><backupSuffix>`
 *      before mutating it. (No backup when the file is absent — nothing to save.)
 *   3. Atomic write: writes to a sibling .tmp then renames over the target.
 *   4. Surgical: strips only legacy server keys and (re)writes our own block; all
 *      other `[mcp_servers.*]` sections are preserved byte-for-byte.
 *
 * Unlike the Cursor path there is no 'malformed' result: TOML is manipulated via
 * regex on the raw string, so any readable file is a valid upsert target.
 */
export async function applyCodexInstall(opts: CodexInstallOptions): Promise<InstallResult> {
  const { configPath, serverBlock, fs } = opts;
  const backupSuffix = opts.backupSuffix ?? DEFAULT_BACKUP_SUFFIX;
  const tmpSuffix = opts.tmpSuffix ?? DEFAULT_TMP_SUFFIX;

  let raw: string | null = null;
  try {
    raw = await fs.readFile(configPath);
  } catch (err) {
    if (!isMissing(err)) throw err; // surface permission/IO errors; never clobber
    raw = null; // ENOENT/ENOTDIR — first install, no existing config
  }

  let text = raw ?? '';
  if (raw !== null) {
    // Back up the existing file once, before any mutation.
    await fs.copyFile(configPath, configPath + backupSuffix);
  }

  for (const legacyKey of CODEX_LEGACY_KEYS) {
    const escapedKey = legacyKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const legacyRe = new RegExp(`^\\[mcp_servers\\."${escapedKey}"\\][\\s\\S]*?(?=^\\[|(?![\\s\\S]))`, 'm');
    text = text.replace(legacyRe, '');
  }

  if (CODEX_BLOCK_RE.test(text)) {
    text = text.replace(CODEX_BLOCK_RE, serverBlock);
  } else {
    if (text.length && !text.endsWith('\n')) text += '\n';
    text += (text.length ? '\n' : '') + serverBlock;
  }

  const tmpPath = configPath + tmpSuffix;
  await fs.writeFile(tmpPath, text);
  await fs.rename(tmpPath, configPath);

  return { status: 'written' };
}
