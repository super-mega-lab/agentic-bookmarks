import type { ServerContext } from './server-context.js';
import {
  pathsForRoot,
  readFileV2,
  readFileAt,
  readRegistry,
  resolveWorkspacePath,
} from '@agentic-bookmarks/core';
import * as path from 'node:path';
import { getRegistryForWorkspace } from './workspace.js';
import { anchorToWire } from './tools/line-basis.js';

// ============================================================================
// ListResources handler
// ============================================================================

export async function handleListResources() {
  return {
    resources: [
      {
        uri: 'bookmarks://mode',
        name: 'Bookmark Search Mode Preference',
        description: 'User preference for how proactive to be when searching bookmarks',
        mimeType: 'application/json'
      },
      {
        uri: 'bookmarks://files',
        name: 'Bookmarks Files and Groups',
        description: 'Lightweight summary of bookmark files and their groups',
        mimeType: 'application/json'
      }
    ]
  };
}

// ============================================================================
// ReadResource handler
// ============================================================================

export async function handleReadResource(ctx: ServerContext, uri: string) {
  if (uri === 'bookmarks://mode') {
    // Read guidance mode from registry
    const reg = await readRegistry(ctx.workspaceRoot);
    const mode = (reg.settings?.mcp as any)?.llmGuidanceMode || 'balanced';

    const modeDescriptions: Record<string, string> = {
      proactive: 'Use bookmark_search proactively when solving problems, debugging, or exploring code',
      balanced: 'Use bookmark_search when it feels contextually useful or relevant to the task',
      reactive: 'Prefer to only search bookmarks when the user explicitly asks'
    };

    const payload = {
      resource: 'bookmarks://mode',
      mode: mode,
      description: modeDescriptions[mode] || modeDescriptions.balanced
    };

    return {
      contents: [
        { uri, mimeType: 'application/json', text: JSON.stringify(payload, null, 2) }
      ]
    };
  }

  if (uri === 'bookmarks://files') {
    const allFiles: Array<{
      workspace: string;
      filename: string;
      id: string;
      path: string;
      groups: Array<{ name: string; id: string }>;
    }> = [];

    for (const workspace of ctx.workspaces) {
      const registry = await getRegistryForWorkspace(workspace);

      for (const fileEntry of registry.files) {
        if (fileEntry.enabled === false) continue;

        try {
          const absolutePath = resolveWorkspacePath(fileEntry.path, workspace.workspaceRoot);
          const data = await readFileAt(absolutePath);

          allFiles.push({
            workspace: workspace.workspaceRoot,
            filename: path.basename(fileEntry.path),
            id: fileEntry.fileId,
            path: fileEntry.path,  // Relative path
            groups: data.groups.map(g => ({ name: g.name, id: g.id })),
          });
        } catch {
          // File not readable
        }
      }
    }

    return {
      contents: [{
        uri: 'bookmarks://files',
        mimeType: 'application/json',
        text: JSON.stringify({ files: allFiles }),
      }],
    };
  }

  // Back-compat: allow reading a single bookmark if explicitly addressed
  if (uri.startsWith('bookmark://')) {
    const id = uri.replace('bookmark://', '');
    const p = pathsForRoot(ctx.workspaceRoot);
    const f = await readFileV2(p);
    const bookmark = f.bookmarks.find(x => x.id === id);
    if (!bookmark) throw new Error(`Bookmark ${id} not found`);
    const wireBookmark = { ...bookmark, anchor: anchorToWire(bookmark.anchor) };
    return {
      contents: [
        { uri, mimeType: 'application/json', text: JSON.stringify(wireBookmark, null, 2) }
      ]
    };
  }

  throw new Error('Invalid resource URI');
}
