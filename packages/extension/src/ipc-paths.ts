import * as path from 'node:path';
import { getCacheDir } from '@agentic-bookmarks/core';

export function getMcpToExtensionQueuePaths(
  workspaceRoot: string,
  bookmarksDataRoot: string,
): { queuePath: string; pulsePath: string } {
  const cacheDir = getCacheDir(workspaceRoot, bookmarksDataRoot);
  return {
    queuePath: path.join(cacheDir, 'mcp-to-extension.queue.jsonl'),
    pulsePath: path.join(cacheDir, 'mcp-to-extension.queue.pulse'),
  };
}
