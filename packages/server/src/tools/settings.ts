import type { ServerContext } from '../server-context.js';
import {
  readRegistry,
  registryPathForRoot,
} from '@agentic-bookmarks/core';
import * as fs from 'node:fs/promises';

// ============================================================================
// settings_setAppearance
// ============================================================================

export async function handleSettingsSetAppearance(ctx: ServerContext, args: any) {
  const patch = args;
  const reg = await readRegistry(ctx.workspaceRoot);
  (reg as any).settings = reg.settings || ({} as any);
  (reg as any).settings.appearance = reg.settings?.appearance || ({} as any);
  Object.assign((reg as any).settings.appearance, patch);
  await fs.writeFile(registryPathForRoot(ctx.workspaceRoot), JSON.stringify(reg, null, 2));
  return { content: [{ type: 'text', text: `Appearance updated` }] };
}

// ============================================================================
// style_catalog_setPath was removed in SML-1320 (locked-down catalog
// surface). The catalog now loads from the extension's bundled
// media/styles/. Pro-mode would re-introduce a catalog-management tool
// here; the schema field `settings.appearance.styleCatalogPath` is kept
// optional so a future re-enable doesn't need a migration.
// ============================================================================

// ============================================================================
// self_test
// ============================================================================

export async function handleSelfTest(ctx: ServerContext, args: any) {
  const { bookmark_mode } = args;
  const response = {
    test: 'self_test',
    echo: {
      bookmark_mode: bookmark_mode || 'not provided'
    },
    server_info: {
      name: 'agentic_bookmarks',
      version: '0.4.0',
      workspaceRoot: ctx.workspaceRoot
    },
    timestamp: new Date().toISOString()
  };
  return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
}

// ============================================================================
// mcp_debug
// ============================================================================

export async function handleMcpDebug(ctx: ServerContext, _args: any) {
  const envDump = {
    BOOKMARKS_DIR: process.env.BOOKMARKS_DIR,
    BOOKMARKS_UPWARD_DISCOVERY: process.env.BOOKMARKS_UPWARD_DISCOVERY,
    MCP_BOOKMARKS_WORKSPACES: process.env.MCP_BOOKMARKS_WORKSPACES,
    CWD: process.cwd(),
  };
  const wsInfo = ctx.workspaces.map(ws => ({
    workspaceRoot: ws.workspaceRoot,
    registryPath: ws.registryPath,
    bookmarksDataRoot: ws.bookmarksDataRoot,
  }));
  let loadedFolders: string[] = [];
  try {
    const reg = await readRegistry(ctx.workspaceRoot);
    if (Array.isArray((reg as any).loadedWorkspaceFolders)) {
      loadedFolders = (reg as any).loadedWorkspaceFolders;
    }
  } catch {}
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        version: '0.5.0+debug',
        env: envDump,
        workspaces: wsInfo,
        workspaceRootLegacy: ctx.workspaceRoot,
        init: {
          rootUris: ctx.lastInitRootUris,
          meta: ctx.lastInitMeta,
        },
        registryLoadedWorkspaceFolders: loadedFolders,
      }),
    }],
  };
}
