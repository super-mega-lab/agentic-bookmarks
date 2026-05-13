#!/usr/bin/env node
import './shim.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  InitializeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  readRegistry,
  createWorkspaceInfo,
} from '@agentic-bookmarks/core';
import * as path from 'node:path';
import { toolDefinitions } from './tools/definitions.js';
import {
  pickRoot,
  parseWorkspaceConfig,
} from './workspace';
import {
  handleBookmarkAdd,
  handleBookmarkList,
  handleBookmarkDelete,
  handleBookmarkOpen,
} from './tools/bookmark.js';
import { handleBookmarkSearch } from './tools/bookmark-search.js';
import {
  handleFileCreate,
  handleFileRegister,
  handleFileDeregister,
  handleGroupCreate,
  handleGroupRename,
  handleGroupMoveFile,
  handleGroupDelete,
} from './tools/file-group.js';
import {
  handleAnchorValidate,
  handleAnchorGetRepairPackage,
  handleAnchorRepair,
} from './tools/anchor-repair.js';
import {
  handleAnchorGetRepairSkillGuide,
  handleAnchorGetHistoricalContextTool,
  handleAnchorGetFileDiffTool,
  handleAnchorSearchMovedCodeTool,
  handleAnchorTraceLineHistoryTool,
  handleAnchorReadFileAtRevisionTool,
  handleAnchorGetCommitDiffTool,
  handleAnchorGetLineLogTool,
  handleAnchorListBroken,
} from './tools/anchor-git.js';
import {
  handleSettingsSetAppearance,
  handleSelfTest,
  handleMcpDebug,
} from './tools/settings.js';
import { handleListResources, handleReadResource } from './resource-handlers.js';
import { createServerContext } from './server-context.js';

// Server setup
const server = new Server(
  {
    name: 'agentic_bookmarks',
    version: '0.5.0',
    description: 'MCP server for managing VS Code bookmarks. Check resource "bookmarks://mode" for user preference on bookmark search proactivity. Fetch "bookmarks://files" for workspace structure (files and groups).'
  },
  {
    capabilities: {
      tools: {},
      resources: {}
    }
  }
);

const ctx = createServerContext();

// ============================================================
// MCP Server Handlers
// ============================================================

// Initialize handler
server.setRequestHandler(InitializeRequestSchema, async (request) => {
  const meta = request.params._meta || {};
  ctx.lastInitMeta = meta;
  const rootUris = (request.params as any)?.meta?.rootUris || (request.params as any)?._meta?.rootUris;
  ctx.lastInitRootUris = Array.isArray(rootUris) ? rootUris : undefined;

  // Parse workspace configuration
  ctx.workspaces = parseWorkspaceConfig(meta);

  // Set legacy workspaceRoot for backward compatibility
  ctx.workspaceRoot = ctx.workspaces[0]?.workspaceRoot || process.cwd();

  // If no init workspaces were provided, derive from registry using BOOKMARKS_DIR or CWD
  if (ctx.workspaces.length === 0) {
    const baseRoot = process.env.BOOKMARKS_DIR ? path.resolve(process.env.BOOKMARKS_DIR) : process.cwd();
    let usedRoot = baseRoot;
    try {
      const reg = await readRegistry(baseRoot);
      const folders: string[] = Array.isArray((reg as any).loadedWorkspaceFolders)
        ? (reg as any).loadedWorkspaceFolders.map((f: string) => path.resolve(f))
        : [];
      if (folders.length > 0) {
        const unique = Array.from(new Set(folders));
        ctx.workspaces = unique.map(wr => createWorkspaceInfo(wr));
        usedRoot = ctx.workspaces[0]?.workspaceRoot || baseRoot;
        console.error(`Agentic Bookmarks server using loadedWorkspaceFolders from registry (${unique.length})`);
      } else {
        ctx.workspaces = [createWorkspaceInfo(baseRoot)];
        usedRoot = baseRoot;
        console.error(`Agentic Bookmarks server using registry root (no loadedWorkspaceFolders): ${usedRoot}`);
      }
    } catch (err: any) {
      // Registry missing or unreadable; fall back to baseRoot
      ctx.workspaces = [createWorkspaceInfo(baseRoot)];
      usedRoot = baseRoot;
      console.error(`Agentic Bookmarks server registry read failed; using base root: ${usedRoot} (${err?.message || String(err)})`);
    }
    ctx.workspaceRoot = usedRoot;
  } else {
    // Merge any loadedWorkspaceFolders from registry into existing workspaces
    try {
      const regRoot = ctx.workspaces[0]?.workspaceRoot || ctx.workspaceRoot;
      const reg = await readRegistry(regRoot);
      const folders: string[] = Array.isArray((reg as any).loadedWorkspaceFolders)
        ? (reg as any).loadedWorkspaceFolders.map((f: string) => path.resolve(f))
        : [];
      if (folders.length > 0) {
        const currentRoots = new Set(ctx.workspaces.map(ws => path.resolve(ws.workspaceRoot)));
        for (const f of folders) currentRoots.add(path.resolve(f));
        ctx.workspaces = Array.from(currentRoots).map(wr => createWorkspaceInfo(wr));
        ctx.workspaceRoot = ctx.workspaces[0]?.workspaceRoot || ctx.workspaceRoot;
        console.error(`Agentic Bookmarks server merged loadedWorkspaceFolders into workspaces (total=${ctx.workspaces.length})`);
      }
    } catch (err: any) {
      console.error(`Agentic Bookmarks server registry merge failed: ${err?.message || String(err)}`);
    }
  }

  // Build marker helps verify which binary is running when debugging stdio launches
  console.error(`Agentic Bookmarks initialized with ${ctx.workspaces.length} workspace(s) [build=stdio-cwd-fallback-check]`);
  for (const ws of ctx.workspaces) {
    console.error(`  - ${ws.workspaceRoot} (dataRoot: ${ws.bookmarksDataRoot})`);
  }

  return {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {}, resources: {} },
    serverInfo: {
      name: 'agentic_bookmarks',
      version: '0.5.0',
    },
  };
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: toolDefinitions };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const safeArgs: Record<string, any> = args ?? {};

  // Set workspace root from meta if available
  const roots = (request.params as any)?.meta?.rootUris || (request.params as any)?._meta?.rootUris;
  if (roots && Array.isArray(roots)) {
    ctx.workspaceRoot = pickRoot(roots as string[], ctx.workspaceRoot);
  }

  try {
  switch (name) {
    // Bookmark CRUD
    case 'bookmark_add': return handleBookmarkAdd(ctx, safeArgs);
    case 'bookmark_list': return handleBookmarkList(ctx, safeArgs);
    case 'bookmark_delete': return handleBookmarkDelete(ctx, safeArgs);
    case 'bookmark_open': return handleBookmarkOpen(ctx, safeArgs);
    case 'bookmark_search': return handleBookmarkSearch(ctx, safeArgs);

    // File & group management
    case 'file_create': return handleFileCreate(ctx, safeArgs);
    case 'file_register': return handleFileRegister(ctx, safeArgs);
    case 'file_deregister': return handleFileDeregister(ctx, safeArgs);
    case 'group_create': return handleGroupCreate(ctx, safeArgs);
    case 'group_rename': return handleGroupRename(ctx, safeArgs);
    case 'group_moveFile': return handleGroupMoveFile(ctx, safeArgs);
    case 'group_delete': return handleGroupDelete(ctx, safeArgs);

    // Anchor repair tools
    case 'anchor_validate': return handleAnchorValidate(ctx, args);
    case 'anchor_getRepairPackage': return handleAnchorGetRepairPackage(ctx, args);
    case 'anchor_repair': return handleAnchorRepair(ctx, args);

    // Anchor git tools
    case 'anchor_getRepairSkillGuide': return handleAnchorGetRepairSkillGuide(ctx, args);
    case 'anchor_getHistoricalContext': return handleAnchorGetHistoricalContextTool(ctx, args);
    case 'anchor_getFileDiff': return handleAnchorGetFileDiffTool(ctx, args);
    case 'anchor_searchMovedCode': return handleAnchorSearchMovedCodeTool(ctx, args);
    case 'anchor_traceLineHistory': return handleAnchorTraceLineHistoryTool(ctx, args);
    case 'anchor_readFileAtRevision': return handleAnchorReadFileAtRevisionTool(ctx, args);
    case 'anchor_getCommitDiff': return handleAnchorGetCommitDiffTool(ctx, args);
    case 'anchor_getLineLog': return handleAnchorGetLineLogTool(ctx, args);
    case 'anchor_listBroken': return handleAnchorListBroken(ctx, args);

    // Settings & debug
    case 'settings_setAppearance': return handleSettingsSetAppearance(ctx, args);
    // 'style_catalog_setPath' was removed in SML-1320 (locked-down catalog surface).
    case 'self_test': return handleSelfTest(ctx, args);
    case 'mcp_debug': return handleMcpDebug(ctx, args);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
  } catch (e: any) {
    return { content: [{ type: 'text', text: `Error: ${e?.message || String(e)}` }] };
  }
});

// Resources
server.setRequestHandler(ListResourcesRequestSchema, handleListResources);
server.setRequestHandler(ReadResourceRequestSchema, (request) =>
  handleReadResource(ctx, request.params.uri)
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Agentic Bookmarks started');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
