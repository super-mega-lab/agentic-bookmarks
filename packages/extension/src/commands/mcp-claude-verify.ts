// ABOUTME: Pure verification that a `claude mcp add` actually landed, by reconciling
// ABOUTME: against claude's own config (~/.claude.json). No VS Code API dependency.

import { join } from 'node:path';
import * as os from 'node:os';

export const CLAUDE_SERVER_ID = 'agentic_bookmarks';

export type ClaudeInstallVerdict = 'confirmed' | 'absent' | 'inconclusive';

export interface ClaudeConfigReadResult {
  config?: unknown | null;
  unreadable?: boolean;
}

/**
 * Pure decision from a parsed-config read result.
 *
 * - user scope  -> config.mcpServers[serverId]
 * - local scope -> config.projects[projectPath].mcpServers[serverId]
 *
 * Returns:
 *   'confirmed'    the server entry is present for the scope
 *   'absent'       config readable (incl. file-missing: read.config === null) but no entry
 *   'inconclusive' config could not be read/parsed (read.unreadable === true)
 */
export function evaluateClaudeInstall(
  read: ClaudeConfigReadResult,
  scope: 'local' | 'user',
  projectPath: string,
  serverId: string = CLAUDE_SERVER_ID,
): ClaudeInstallVerdict {
  if (read.unreadable) return 'inconclusive';
  if (read.config === null) return 'absent';
  if (typeof read.config !== 'object' || Array.isArray(read.config)) return 'absent';

  const config = read.config as Record<string, any>;
  const servers =
    scope === 'user'
      ? config.mcpServers
      : config.projects?.[projectPath]?.mcpServers;

  if (servers && typeof servers === 'object' && servers[serverId]) {
    return 'confirmed';
  }
  return 'absent';
}

export interface VerifyClaudeInstallDeps {
  readConfig: () => Promise<ClaudeConfigReadResult>;
  sleep: (ms: number) => Promise<void>;
  scope: 'local' | 'user';
  projectPath: string;
  serverId?: string;
  attempts?: number;
  delayMs?: number;
}

/**
 * Polls readConfig up to `attempts` times. Returns 'confirmed' as soon as seen
 * (and does NOT sleep again after a confirm). Otherwise returns the LAST verdict.
 * Sleeps between attempts only (attempts-1 sleeps max). The terminal-driven
 * `claude mcp add` runs async, hence the retry.
 */
export async function verifyClaudeInstall(deps: VerifyClaudeInstallDeps): Promise<ClaudeInstallVerdict> {
  const attempts = deps.attempts ?? 10;
  const delayMs = deps.delayMs ?? 600;
  let last: ClaudeInstallVerdict = 'absent';
  for (let i = 0; i < attempts; i++) {
    const read = await deps.readConfig();
    last = evaluateClaudeInstall(read, deps.scope, deps.projectPath, deps.serverId);
    if (last === 'confirmed') return last;
    if (i < attempts - 1) await deps.sleep(delayMs);
  }
  return last;
}

/**
 * Real reader for `${homeDir}/.claude.json`.
 *   ENOENT/ENOTDIR        -> { config: null }   (file missing)
 *   any other read error  -> { unreadable: true }
 *   present but invalid JSON -> { unreadable: true }
 *   valid JSON            -> { config: parsed }
 */
export async function readClaudeConfig(
  readFile: (p: string) => Promise<string>,
  homeDir: string = os.homedir(),
): Promise<ClaudeConfigReadResult> {
  const configPath = join(homeDir, '.claude.json');
  let raw: string;
  try {
    raw = await readFile(configPath);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { config: null };
    return { unreadable: true };
  }
  try {
    return { config: JSON.parse(raw) };
  } catch {
    return { unreadable: true };
  }
}
