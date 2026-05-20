// ABOUTME: Shared MCP server helpers — logging, group creation, and bookmark file path resolution.
// ABOUTME: createGroupWithStyleSetActive and createGroupWithAIStyle are the two entry points for group init.
import {
  canonicalFileUri,
  type BookmarkAnchor,
  type BookmarksFileV2,
  type WorkspaceInfo,
  readRegistry,
  registryPathForRoot,
  readFileAt,
  writeFileAt,
  pathsForDataFile,
  emptyFileV2,
  isLocalPath,
  createGroupInFile,
  DEFAULT_BOOKMARKS_DATA_ROOT,
  getDefaultLocalFilePath,
  writeRegistry,
} from '@agentic-bookmarks/core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { nanoid } from 'nanoid';

// Logging helper for MCP operations (outputs to stderr, shows in "Agentic Bookmarks" output channel)
export function log(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  if (data !== undefined) {
    console.error(`[${timestamp}] ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.error(`[${timestamp}] ${message}`);
  }
}

export function randomReadableHexColor(): string {
  // Generate a random hex color ensuring R+G+B > 128
  let r = 0, g = 0, b = 0;
  const pick = () => Math.floor(Math.random() * 256);
  for (let i = 0; i < 10; i++) {
    r = pick(); g = pick(); b = pick();
    if (r + g + b > 128) break;
  }
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function canonicalize(input: string, root: string) {
  return canonicalFileUri(input, root);
}

/**
 * Normalize anchor from various input formats.
 */
export function normalizeAnchor(raw: any): BookmarkAnchor {
  // Returns a wire-shape anchor (line fields 1-based). The handler must
  // call anchorToInternal before storing or passing to anchor-creation logic.
  // Clamp lines to >= 1 (wire 1-based minimum); columns stay 0-based per VS Code.
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      const line = parseInt(raw, 10);
      if (!isNaN(line)) {
        return { kind: 'point', line: Math.max(1, line) };
      }
      throw new Error('Invalid anchor format');
    }
  }

  if (typeof raw === 'number') {
    return { kind: 'point', line: Math.max(1, raw) };
  }

  if (raw.kind === 'point') {
    return {
      kind: 'point',
      line: Math.max(1, raw.line ?? 1),
      column: raw.column !== undefined ? Math.max(0, raw.column) : undefined,
      lineCache: raw.lineCache,
    };
  }

  if (raw.kind === 'range') {
    return {
      kind: 'range',
      start: {
        line: Math.max(1, raw.start?.line ?? 1),
        column: raw.start?.column !== undefined ? Math.max(0, raw.start.column) : undefined,
      },
      end: {
        line: Math.max(1, raw.end?.line ?? 1),
        column: raw.end?.column !== undefined ? Math.max(0, raw.end.column) : undefined,
      },
      lineCache: raw.lineCache,
    };
  }

  return { kind: 'point', line: Math.max(1, parseInt(String(raw.line ?? raw), 10) || 1) };
}

export async function resolveDefaultFilePathOrFallback(workspaceRoot: string): Promise<string> {
  try {
    const reg = await readRegistry(workspaceRoot);
    const dt = (reg as any).defaultTarget as { fileId: string; groupId: string } | undefined;
    if (dt) {
      const match = reg.files.find(f => (f as any).fileId === dt.fileId);
      if (match && match.path) {
        return path.isAbsolute(match.path) ? match.path : path.join(workspaceRoot, match.path);
      }
    }
    // If registry has files but no default target, use first file
    if (reg.files.length > 0) {
      const firstPath = reg.files[0].path;
      return path.isAbsolute(firstPath) ? firstPath : path.join(workspaceRoot, firstPath);
    }
  } catch {}
  // Fallback to new default location: .bookmarks/local/bookmarks.json
  const dataRoot = DEFAULT_BOOKMARKS_DATA_ROOT;
  return getDefaultLocalFilePath(workspaceRoot, dataRoot);
}

export async function createGroupWithStyleSetActive(workspaceRoot: string, dataFileAbs: string, name: string | undefined): Promise<{ file: BookmarksFileV2; groupId: string }> {
  const abs = path.resolve(dataFileAbs);
  let f: BookmarksFileV2;
  try {
    f = await readFileAt(abs);
  } catch {
    // Create a fresh v2 file if missing
    // Compute isLocal from the bookmarks file path
    const relativePath = path.relative(workspaceRoot, abs);
    const isLocal = isLocalPath(relativePath);
    f = emptyFileV2({ isLocal });
  }
  const groupId = nanoid(8);
  let gname = (name && String(name).trim()) || `New Group ${groupId}`;
  // Ensure per-file uniqueness of name
  if (f.groups.some(g => g.name === gname)) {
    // Append short suffix if collision
    const suffix = '-' + groupId.substring(0, 3);
    const base = gname.endsWith(suffix) ? gname : gname + suffix;
    if (!f.groups.some(g => g.name === base)) {
      gname = base;
    }
  }
  const icon = { svg_style: 'bookmark', svg_color: randomReadableHexColor() } as any;
  (f.groups as any).push({ id: groupId as any, name: gname, icon, createdAt: Date.now() });

  // Update registry name index best-effort
  try {
    const reg = await readRegistry(workspaceRoot);
    (reg as any).nameIndex = reg.nameIndex || {};
    if (!(reg as any).nameIndex[gname]) {
      (reg as any).nameIndex[gname] = { fileId: (f as any).fileId, groupId };
      await fs.writeFile(registryPathForRoot(workspaceRoot), JSON.stringify(reg, null, 2));
      log(`Updated nameIndex for group: ${gname}`);
    }
  } catch (e: any) {
    log(`WARNING: Failed to update nameIndex for group ${gname}: ${e?.message || String(e)}`);
  }

  // Persist and set active
  const p = pathsForDataFile(abs, workspaceRoot, DEFAULT_BOOKMARKS_DATA_ROOT);
  await writeFileAt(p, f);
  log(`Created group "${gname}" (${groupId}) in file: ${abs}`);

  try {
    const reg = await readRegistry(workspaceRoot);
    (reg as any).defaultTarget = { fileId: (f as any).fileId, groupId } as any;
    await writeRegistry(workspaceRoot, reg);
    log(`Set defaultTarget to group: ${gname} (${groupId})`);
  } catch (e: any) {
    log(`WARNING: Failed to set defaultTarget for group ${gname}: ${e?.message || String(e)}`);
  }
  return { file: f, groupId };
}

/**
 * Create a group in a file with AI bookmark style.
 * Uses the core's createGroupInFile with proper locking.
 * Returns the new group ID.
 */
export async function createGroupWithAIStyle(
  workspace: WorkspaceInfo,
  filePath: string,
  groupName: string
): Promise<string> {
  // Use core's createGroupInFile which has proper global + per-file locking
  return createGroupInFile(
    workspace.workspaceRoot,
    filePath,
    groupName,
    {
      icon: {
        svg_style: 'bookmark',  // Default bookmark style
        svg_color: randomReadableHexColor(),
      },
      setAsDefault: true,  // Set newly created group as default target
    },
    workspace.bookmarksDataRoot
  );
}
