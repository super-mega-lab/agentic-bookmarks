// ABOUTME: Pure helpers for safely removing the agentic_bookmarks entry from
// ABOUTME: Cursor's mcp.json and Codex's config.toml. No VS Code API dependency.

/**
 * Filesystem dependencies injected by the caller so these helpers are unit
 * testable against an in-memory fs and so the production wiring is a one-line
 * pass-through of node:fs/promises.
 */
export interface FsDeps {
  /** Read a UTF-8 file. Should reject with an ENOENT-shaped error if missing. */
  readFile(path: string): Promise<string>;
  /** Write a UTF-8 file. */
  writeFile(path: string, data: string): Promise<void>;
  /** Rename `from` -> `to`, overwriting `to` if present. */
  rename(from: string, to: string): Promise<void>;
  /** Copy `from` -> `to`. Used for the one-shot backup. */
  copyFile(from: string, to: string): Promise<void>;
}

export type UninstallResult =
  | { status: 'removed' }     // we modified the file and removed our entry
  | { status: 'absent' }      // file missing OR our entry not present — nothing to do
  | { status: 'malformed' };  // file present but unsafe to modify; user must edit by hand

export interface CursorUninstallOptions {
  configPath: string;
  fs: FsDeps;
  /** Override the backup-path suffix; defaults to `.agentic-bookmarks-backup`. */
  backupSuffix?: string;
  /** Override the temp-file suffix; defaults to `.agentic-bookmarks.tmp`. */
  tmpSuffix?: string;
}

export const DEFAULT_BACKUP_SUFFIX = '.agentic-bookmarks-backup';
export const DEFAULT_TMP_SUFFIX = '.agentic-bookmarks.tmp';
export const SERVER_ID = 'agentic_bookmarks';

export function isMissing(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Removes the `mcpServers.agentic_bookmarks` entry from a Cursor `mcp.json`
 * file. Honors the five safety guards from the SML-1437 design:
 *
 *   1. Verify-before-write: returns 'absent' without touching the file when
 *      our entry isn't present.
 *   2. Refuse-on-malformed: returns 'malformed' without touching the file when
 *      the JSON cannot be parsed.
 *   3. Atomic rename: writes to a sibling .tmp then renames over the target.
 *   4. One-shot backup: copies the original to `<path><backupSuffix>` before
 *      the first write.
 *   5. Surgical: leaves all sibling keys untouched, including an empty
 *      `mcpServers: {}` if our entry was the only one.
 */
export async function applyCursorUninstall(opts: CursorUninstallOptions): Promise<UninstallResult> {
  const { configPath, fs } = opts;
  const backupSuffix = opts.backupSuffix ?? DEFAULT_BACKUP_SUFFIX;
  const tmpSuffix = opts.tmpSuffix ?? DEFAULT_TMP_SUFFIX;

  let raw: string;
  try {
    raw = await fs.readFile(configPath);
  } catch (err) {
    if (isMissing(err)) return { status: 'absent' };
    throw err;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'malformed' };
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !parsed.mcpServers ||
    typeof parsed.mcpServers !== 'object' ||
    !(SERVER_ID in parsed.mcpServers)
  ) {
    return { status: 'absent' };
  }

  await fs.copyFile(configPath, configPath + backupSuffix);

  delete parsed.mcpServers[SERVER_ID];
  const next = JSON.stringify(parsed, null, 2);

  const tmpPath = configPath + tmpSuffix;
  await fs.writeFile(tmpPath, next);
  await fs.rename(tmpPath, configPath);

  return { status: 'removed' };
}

export interface CodexUninstallOptions {
  configPath: string;
  fs: FsDeps;
  backupSuffix?: string;
  tmpSuffix?: string;
}

const CODEX_BLOCK_RE = /^\[mcp_servers\."agentic_bookmarks"\][\s\S]*?(?=^\[|(?![\s\S]))/m;

/**
 * Removes the `[mcp_servers."agentic_bookmarks"]` block from a Codex
 * `config.toml`. Same five safety guards as `applyCursorUninstall`.
 * The regex is anchored exactly like the install path's upsert regex, so a
 * file with multiple unrelated `[mcp_servers."..."]` blocks keeps the others
 * byte-identical.
 */
export async function applyCodexUninstall(opts: CodexUninstallOptions): Promise<UninstallResult> {
  const { configPath, fs } = opts;
  const backupSuffix = opts.backupSuffix ?? DEFAULT_BACKUP_SUFFIX;
  const tmpSuffix = opts.tmpSuffix ?? DEFAULT_TMP_SUFFIX;

  let raw: string;
  try {
    raw = await fs.readFile(configPath);
  } catch (err) {
    if (isMissing(err)) return { status: 'absent' };
    throw err;
  }

  if (!CODEX_BLOCK_RE.test(raw)) {
    return { status: 'absent' };
  }

  await fs.copyFile(configPath, configPath + backupSuffix);

  // Reset lastIndex isn't an issue: the regex isn't /g. Re-run replace.
  let next = raw.replace(CODEX_BLOCK_RE, '');
  // Collapse the leading blank line that often precedes the removed block so we
  // don't leave double-blank artefacts.
  next = next.replace(/\n{3,}/g, '\n\n');

  const tmpPath = configPath + tmpSuffix;
  await fs.writeFile(tmpPath, next);
  await fs.rename(tmpPath, configPath);

  return { status: 'removed' };
}
