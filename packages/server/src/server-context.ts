import type { WorkspaceInfo } from '@agentic-bookmarks/core';

export interface ServerContext {
  /** Multi-workspace state -- populated during initialization */
  workspaces: WorkspaceInfo[];

  /** Legacy single-root fallback -- kept for backward compatibility with handlers
   *  that haven't been migrated to multi-workspace. Always equals workspaces[0].workspaceRoot. */
  workspaceRoot: string;

  /** Debug: meta from last Initialize request */
  lastInitMeta: any;

  /** Debug: rootUris from last Initialize request */
  lastInitRootUris: string[] | undefined;

  /** Whether the repair skill guide has been served this session */
  hasServedRepairSkillGuide: boolean;
}

export function createServerContext(): ServerContext {
  return {
    workspaces: [],
    workspaceRoot: process.cwd(),
    lastInitMeta: null,
    lastInitRootUris: undefined,
    hasServedRepairSkillGuide: false,
  };
}
