import type { ServerContext } from '../server-context.js';
import type { WorkspaceInfo } from '@agentic-bookmarks/core';
import {
  emptyFileV2,
  addFileToRegistry,
  renameGroupGlobal,
  moveGroupBetweenFiles,
  deleteGroupInFile,
  deregisterFile,
  resolveWorkspacePath,
  isLocalPath,
  isWithinWorkspace,
} from '@agentic-bookmarks/core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  getWorkspaceForUri,
  getRegistryForWorkspace,
  findFileContainingGroup,
} from '../workspace.js';
import {
  log,
  createGroupWithAIStyle,
} from '../helpers.js';
import { toWire } from './line-basis.js';

export async function handleFileCreate(ctx: ServerContext, args: Record<string, any>) {
  const { path: p, title } = args as { path: string; title?: string };
  const abs = path.resolve(p);
  if (!isWithinWorkspace(abs, ctx.workspaceRoot)) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: false, error: 'Path is outside the workspace', path: abs }, null, 2)
      }]
    };
  }
  try {
    await fs.stat(abs);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: false, error: 'File already exists', path: abs }, null, 2)
      }]
    };
  } catch {}
  await fs.mkdir(path.dirname(abs), { recursive: true });
  // Determine if this is a local file based on path (e.g., contains 'local')
  const relativePath = path.relative(ctx.workspaceRoot, abs);
  const isLocal = isLocalPath(relativePath);
  const newFile = emptyFileV2({ isLocal });
  await fs.writeFile(abs, JSON.stringify(newFile, null, 2), 'utf8');
  await addFileToRegistry(ctx.workspaceRoot, abs, title);
  log(`Created bookmarks file: ${abs} (fileId: ${(newFile as any).fileId}, isLocal: ${isLocal})`);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ success: true, fileId: (newFile as any).fileId, path: abs, message: `File created and registered` }, null, 2)
    }]
  };
}

export async function handleFileRegister(ctx: ServerContext, args: Record<string, any>) {
  const { path: p, title } = args as { path: string; title?: string };
  const abs = path.resolve(p);
  if (!isWithinWorkspace(abs, ctx.workspaceRoot)) {
    return { content: [{ type: 'text', text: `Error: path is outside the workspace: ${abs}` }] };
  }
  try { await fs.stat(abs); } catch { return { content: [{ type: 'text', text: `Error: file not found: ${abs}` }] } }
  try {
    const raw = await fs.readFile(abs, 'utf8');
    const json = JSON.parse(raw);
    if (json?.version !== 2) {
      return { content: [{ type: 'text', text: `Error: only v2 files are supported (found version=${json?.version})` }] };
    }
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: invalid JSON file: ${abs}` }] };
  }
  await addFileToRegistry(ctx.workspaceRoot, abs, title);
  return { content: [{ type: 'text', text: `File registered: ${p}` }] };
}

export async function handleFileDeregister(ctx: ServerContext, args: Record<string, any>) {
  const { path: p } = args as { path: string };
  await deregisterFile(ctx.workspaceRoot, path.resolve(p));
  return { content: [{ type: 'text', text: `File deregistered: ${p} — Note: only perform this on explicit user request.` }] };
}

export async function handleGroupCreate(ctx: ServerContext, args: Record<string, any>) {
  const { fileId, filePath, name: gname } = args;
  const nameTrim = String(gname || '').trim();
  if (!nameTrim) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: false, error: 'Group name is required' }),
      }],
    };
  }

  // Determine workspace - if filePath is provided, use it to find workspace
  let workspace: WorkspaceInfo | null = null;
  let targetFilePath: string | null = null;

  if (filePath) {
    workspace = getWorkspaceForUri(filePath, ctx.workspaces);
    if (workspace) {
      targetFilePath = resolveWorkspacePath(filePath, workspace.workspaceRoot);
    }
  } else if (fileId) {
    // Find workspace containing this fileId
    for (const ws of ctx.workspaces) {
      const registry = await getRegistryForWorkspace(ws);
      const entry = registry.files.find(f => f.fileId === fileId);
      if (entry) {
        workspace = ws;
        targetFilePath = resolveWorkspacePath(entry.path, ws.workspaceRoot);
        break;
      }
    }
  }

  if (!workspace || !targetFilePath) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: false, error: 'Could not determine target file' }),
      }],
    };
  }

  // Check global name uniqueness within this workspace
  const registry = await getRegistryForWorkspace(workspace);
  if (registry.nameIndex[nameTrim]) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: false, error: `Group "${nameTrim}" already exists in workspace` }),
      }],
    };
  }

  // Create group
  const groupId = await createGroupWithAIStyle(workspace, targetFilePath, nameTrim);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ success: true, groupId }),
    }],
  };
}

export async function handleGroupRename(ctx: ServerContext, args: Record<string, any>) {
  const { groupId, newName } = args as { groupId: string; newName: string };
  const nn = String(newName || '').trim();
  if (!nn) return { content: [{ type: 'text', text: `Error: newName is required` }] };

  // Find the OWNING workspace by searching across all workspaces. Reads the
  // actual files (robust against a stale nameIndex) rather than trusting the
  // primary registry's nameIndex.
  let owner: { ws: WorkspaceInfo; filePath: string } | null = null;
  for (const ws of ctx.workspaces) {
    const found = await findFileContainingGroup(ws, groupId);
    if (found) {
      owner = { ws, filePath: found.filePath };
      break;
    }
  }
  if (!owner) {
    return { content: [{ type: 'text', text: `Error: group ${groupId} not found in registry` }] };
  }

  await renameGroupGlobal(owner.ws.workspaceRoot, owner.filePath, groupId, nn, owner.ws.bookmarksDataRoot);
  log(`Renamed group ${groupId} to: ${nn}`);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ success: true, groupId, newName: nn, message: `Group renamed` }, null, 2)
    }]
  };
}

/**
 * Find the registered workspace that owns `uri`, preferring the MOST specific
 * (deepest-rooted) match. getWorkspaceForUri returns the first array match, which
 * for a file inside a workspace nested under another would resolve to the ancestor;
 * here we need the innermost owner so a move into a nested workspace is detected
 * rather than silently attributed to the ancestor. Relative URIs match no root
 * (consistent with findWorkspaceForUri) and return null.
 */
function ownerWorkspace(uri: string, workspaces: WorkspaceInfo[]): WorkspaceInfo | null {
  let best: WorkspaceInfo | null = null;
  for (const ws of workspaces) {
    if (
      isWithinWorkspace(uri, ws.workspaceRoot) &&
      (!best || ws.workspaceRoot.length > best.workspaceRoot.length)
    ) {
      best = ws;
    }
  }
  return best;
}

export async function handleGroupMoveFile(ctx: ServerContext, args: Record<string, any>) {
  const { sourceFile, destFile, groupId } = args as { sourceFile: string; destFile: string; groupId: string };
  // moveGroupBetweenFiles is single-workspace by construction — one registry, one
  // nameIndex, one lock domain — so source and destination must belong to the SAME
  // registered workspace. Reject a cross-workspace move explicitly: without this a
  // sibling-workspace dest false-rejects as "outside the workspace", and a dest in a
  // workspace NESTED under the source root passes the source-root containment check
  // and corrupts the source registry's nameIndex (SML-1559).
  const srcWs = ownerWorkspace(sourceFile, ctx.workspaces);
  const dstWs = ownerWorkspace(destFile, ctx.workspaces);
  if (srcWs && dstWs && srcWs.workspaceRoot !== dstWs.workspaceRoot) {
    return { content: [{ type: 'text', text: `Error: cross-workspace group moves are not supported — source and destination must be in the same workspace` }] };
  }
  const root = srcWs?.workspaceRoot ?? ctx.workspaceRoot;
  const s = resolveWorkspacePath(sourceFile, root);
  const d = resolveWorkspacePath(destFile, root);
  if (!isWithinWorkspace(s, root) || !isWithinWorkspace(d, root)) {
    return { content: [{ type: 'text', text: `Error: source or destination is outside the workspace` }] };
  }
  if (s === d) return { content: [{ type: 'text', text: `Error: source and destination must differ` }] };

  const moveResult = await moveGroupBetweenFiles(root, s, d, groupId, srcWs?.bookmarksDataRoot);

  // Build message with clear agent action instructions
  let message = '';
  if (moveResult.conversionIssues.length > 0) {
    message = `Moved ${moveResult.movedCount} bookmarks. ${moveResult.conversionIssues.length} had conversion issues.`;
  } else {
    message = `Moved ${moveResult.movedCount} bookmarks successfully.`;
  }

  // Add explicit agent action requirements
  const agentActions: string[] = [];
  if (moveResult.tagInsertions.length > 0) {
    agentActions.push(`Agent must insert ${moveResult.tagInsertions.length} tags into source files (see tagInsertions field)`);
  }
  if (moveResult.tagRemovals.length > 0) {
    agentActions.push(`Agent must remove ${moveResult.tagRemovals.length} tags from source files (see tagRemovals field)`);
  }
  if (agentActions.length > 0) {
    message += ' ' + agentActions.join('. ') + '.';
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: moveResult.success,
        moved: moveResult.movedCount,
        conversionIssues: moveResult.conversionIssues,
        // Core emits 0-based `line` (from resolveAnchors); the MCP wire convention
        // is 1-based, like bookmark_add / bookmark_delete / anchor_repair.
        tagInsertions: moveResult.tagInsertions.map(t => ({ ...t, line: toWire(t.line) })),
        tagRemovals: moveResult.tagRemovals.map(t => ({ ...t, line: toWire(t.line) })),
        agentActionRequired: agentActions.length > 0,
        message,
      }),
    }],
  };
}

export async function handleGroupDelete(ctx: ServerContext, args: Record<string, any>) {
  const { filePath, groupId } = args as { filePath: string; groupId: string };
  const workspace = getWorkspaceForUri(filePath, ctx.workspaces);
  const root = workspace?.workspaceRoot ?? ctx.workspaceRoot;
  const resolved = resolveWorkspacePath(filePath, root);
  if (!isWithinWorkspace(resolved, root)) {
    return { content: [{ type: 'text', text: `Error: filePath is outside the workspace` }] };
  }
  await deleteGroupInFile(root, filePath, groupId, workspace?.bookmarksDataRoot);
  return { content: [{ type: 'text', text: `Group deleted/cleared` }] };
}
