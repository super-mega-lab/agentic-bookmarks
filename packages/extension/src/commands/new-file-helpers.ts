// ABOUTME: Decision logic for the "New Bookmarks File" command — chooses between
// ABOUTME: writing a fresh file, erroring on duplicate registration, or prompting
// ABOUTME: to load an existing on-disk file. Pure, vitest-testable, no vscode deps.

import * as path from 'node:path';
import { resolveWorkspacePath, toWorkspaceRelativePath, type WorkspaceRegistryV1 } from '@agentic-bookmarks/core';

export type NewFileAction =
  | { kind: 'write' }
  | { kind: 'error-already-registered'; relativePath: string }
  | { kind: 'prompt-load-existing'; relativePath: string };

export interface NewFileOpts {
  fileExists: boolean;
  isRegistered: boolean;
  relativePath: string;
}

export function resolveNewFileAction(opts: NewFileOpts): NewFileAction {
  if (!opts.fileExists) {
    return { kind: 'write' };
  }
  if (opts.isRegistered) {
    return { kind: 'error-already-registered', relativePath: opts.relativePath };
  }
  return { kind: 'prompt-load-existing', relativePath: opts.relativePath };
}

export function isPathRegistered(
  registry: WorkspaceRegistryV1,
  absPath: string,
  workspaceRoot: string,
): boolean {
  const normalizedAbsolute = path.resolve(absPath);

  // Short-circuit: a path outside the workspace can never be registered to it.
  if (toWorkspaceRelativePath(normalizedAbsolute, workspaceRoot) === null) {
    return false;
  }

  return registry.files.some((f) => {
    const existingAbsolute = resolveWorkspacePath(f.path, workspaceRoot);
    return path.resolve(existingAbsolute) === normalizedAbsolute;
  });
}
