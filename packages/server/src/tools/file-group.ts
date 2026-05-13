import type { ServerContext } from '../server-context.js';
import type { WorkspaceInfo } from '@agentic-bookmarks/core';
import {
  emptyFileV2,
  addFileToRegistry,
  renameGroupGlobal,
  moveGroupBetweenFiles,
  deleteGroupInFile,
  readRegistry,
  deregisterFile,
  resolveWorkspacePath,
  isLocalPath,
} from '@agentic-bookmarks/core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  getWorkspaceForUri,
  getRegistryForWorkspace,
} from '../workspace.js';
import {
  log,
  createGroupWithAIStyle,
} from '../helpers.js';

export async function handleFileCreate(ctx: ServerContext, args: Record<string, any>) {
  const { path: p, title } = args as { path: string; title?: string };
  const abs = path.resolve(p);
  try { await fs.stat(abs); return { content: [{ type: 'text', text: `Error: file already exists: ${abs}` }] }; } catch {}
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

  // Find the file containing this group via registry
  const reg = await readRegistry(ctx.workspaceRoot);
  const groupEntry = Object.entries(reg.nameIndex || {}).find(([_, ref]: any) => ref.groupId === groupId);
  if (!groupEntry) {
    return { content: [{ type: 'text', text: `Error: group ${groupId} not found in registry` }] };
  }

  const fileEntry = reg.files.find(f => (f as any).fileId === groupEntry[1].fileId);
  if (!fileEntry) {
    return { content: [{ type: 'text', text: `Error: file for group ${groupId} not found in registry` }] };
  }

  await renameGroupGlobal(ctx.workspaceRoot, fileEntry.path, groupId, nn);
  log(`Renamed group ${groupId} to: ${nn}`);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ success: true, groupId, newName: nn, message: `Group renamed` }, null, 2)
    }]
  };
}

export async function handleGroupMoveFile(ctx: ServerContext, args: Record<string, any>) {
  const { sourceFile, destFile, groupId } = args as { sourceFile: string; destFile: string; groupId: string };
  const s = resolveWorkspacePath(sourceFile, ctx.workspaceRoot);
  const d = resolveWorkspacePath(destFile, ctx.workspaceRoot);
  if (s === d) return { content: [{ type: 'text', text: `Error: source and destination must differ` }] };

  const moveResult = await moveGroupBetweenFiles(ctx.workspaceRoot, s, d, groupId);

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
        tagInsertions: moveResult.tagInsertions,
        tagRemovals: moveResult.tagRemovals,
        agentActionRequired: agentActions.length > 0,
        message,
      }),
    }],
  };
}

export async function handleGroupDelete(ctx: ServerContext, args: Record<string, any>) {
  const { filePath, groupId } = args as { filePath: string; groupId: string };
  await deleteGroupInFile(ctx.workspaceRoot, filePath, groupId);
  return { content: [{ type: 'text', text: `Group deleted/cleared` }] };
}
