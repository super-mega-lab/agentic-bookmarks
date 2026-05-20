// ABOUTME: Decides whether the welcome page should offer the "Add to .gitignore" banner —
// ABOUTME: true only when machine-local data exists on disk and the canonical line is missing.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  BOOKMARKS_LOCAL_GITIGNORE_LINE,
  gitignoreContainsLine as defaultGitignoreContainsLine,
} from '@agentic-bookmarks/core';

/** Injectable seams for testing; default to real filesystem + core check. */
export interface ShouldOfferGitignoreDeps {
  pathExists?: (p: string) => Promise<boolean>;
  gitignoreContainsLine?: typeof defaultGitignoreContainsLine;
}

async function defaultPathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether to show the welcome-page banner offering to add `.bookmarks/local/`
 * to `.gitignore`. Returns true only when the machine-local data dir exists
 * (so there is actually something to ignore) AND `.gitignore` does not already
 * contain an equivalent line. Never throws — any error collapses to `false`.
 *
 * Callers must only invoke this once a workspace folder is loaded; the no-folder
 * welcome view performs no workspace evaluation.
 */
export async function shouldOfferGitignoreLine(
  workspaceRoot: string,
  deps: ShouldOfferGitignoreDeps = {},
): Promise<boolean> {
  const pathExists = deps.pathExists ?? defaultPathExists;
  const containsLine = deps.gitignoreContainsLine ?? defaultGitignoreContainsLine;
  try {
    const localDir = path.join(workspaceRoot, '.bookmarks', 'local');
    if (!(await pathExists(localDir))) return false;
    return !(await containsLine(workspaceRoot, BOOKMARKS_LOCAL_GITIGNORE_LINE));
  } catch {
    return false;
  }
}
