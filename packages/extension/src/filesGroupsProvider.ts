import * as vscode from 'vscode';
import * as path from 'node:path';
import { readRegistry, readFileV2, pathsForDataFile, resolveIsLocal, isLocalPath, resolveTargetAnchorType, type WorkspaceRegistryV1, type BookmarksFileV2, getBookmarksDataRoot } from '@agentic-bookmarks/core';
import { loadBuiltinCatalog, resolveGroupIconPath, type AppearanceOverrides } from './appearance';
import { buildBookmarkNode } from './treeProvider';
import { computeFileChildrenVisibility, computeGroupVisualHidden } from './filesGroupsProvider-helpers';

export { computeFileChildrenVisibility, computeGroupVisualHidden } from './filesGroupsProvider-helpers';

const HIDDEN_GROUP_THEME_COLOR = new vscode.ThemeColor('disabledForeground');

/** Node representing a workspace folder (shown when multi-root workspace) */
export class WorkspaceFolderNode extends vscode.TreeItem {
  constructor(public readonly folder: vscode.WorkspaceFolder) {
    super(folder.name, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'workspaceFolder';
    this.iconPath = new vscode.ThemeIcon('root-folder');
    this.description = vscode.workspace.asRelativePath(folder.uri, false);
  }
}

export class RegFileNode extends vscode.TreeItem {
  public readonly fileId: string;
  public readonly workspaceRoot: string;
  constructor(public readonly reg: WorkspaceRegistryV1['files'][number], workspaceRoot: string, private isHidden: boolean) {
    const fileName = path.basename(reg.path);
    const label = reg.title || fileName;
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.fileId = (reg as any).fileId;
    this.workspaceRoot = workspaceRoot;
    this.contextValue = isHidden ? 'regFileHidden' : 'regFile';
    this.resourceUri = vscode.Uri.file(reg.path);

    // Determine Local/Shared badge using path heuristic
    const localShared = isLocalPath(path.relative(workspaceRoot, reg.path)) ? 'Local' : 'Shared';

    // Show appropriate description and icon based on hidden state
    if (isHidden) {
      const parts = [localShared];
      if (reg.enabled === false) parts.push('disabled');
      parts.push('hidden');
      this.description = parts.join(' · ');
      this.iconPath = new vscode.ThemeIcon('eye-closed', HIDDEN_GROUP_THEME_COLOR);
    } else {
      this.description = reg.enabled === false ? `${localShared} · disabled` : localShared;
      this.iconPath = reg.enabled === false ? new vscode.ThemeIcon('circle-slash') : new vscode.ThemeIcon('notebook');
    }
  }
}

export class GroupNode extends vscode.TreeItem {
  public readonly groupId: string;
  public readonly workspaceRoot: string;
  public readonly isLocal: boolean;
  public readonly isFileUiHidden: boolean;
  constructor(public readonly group: BookmarksFileV2['groups'][number], public readonly dataFilePath: string, workspaceRoot: string, isLocal: boolean, isFileUiHidden: boolean = false) {
    super(group.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.groupId = (group as any).id;
    this.workspaceRoot = workspaceRoot;
    this.isLocal = isLocal;
    this.isFileUiHidden = isFileUiHidden;
    this.contextValue = 'group';
    this.iconPath = new vscode.ThemeIcon('bookmark');
    if (group.isUnsorted) this.description = 'Unsorted';
  }
}

type UIState = { hidden: string[]; focus: string | null; hiddenFiles?: string[] };

export class FilesGroupsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private workspaceRoot: string,  // Primary workspace (for backward compat)
    private getUIState: () => UIState,
    private defaultIconPath: string,
    private isFileHidden: (fileId: string, reg: WorkspaceRegistryV1) => boolean,
    private extensionContext: vscode.ExtensionContext
  ) {}

  refresh() { this._onDidChangeTreeData.fire(); }

  getTreeItem(e: vscode.TreeItem) { return e; }

  async resolveTreeItem(item: vscode.TreeItem): Promise<vscode.TreeItem> {
    if (item instanceof RegFileNode) {
      try {
        const wsRoot = item.workspaceRoot;
        const reg = await readRegistry(wsRoot);
        const dataRoot = getBookmarksDataRoot(reg);
        const p = pathsForDataFile(item.reg.path, wsRoot, dataRoot);
        const file = await readFileV2(p);
        const fileIsLocal = resolveIsLocal(file, p.data, wsRoot);

        const lines: string[] = [];

        // Line 1: shared/local description
        if (fileIsLocal) {
          lines.push('This local file is a place for your bookmarks that are not checked in.');
          // If no shared file exists, suggest creating one
          const hasSharedFile = reg.files.some(f => !isLocalPath(path.relative(wsRoot, f.path)));
          if (!hasSharedFile) {
            lines.push('To share bookmarks with your team, click the New File button to create a shared file.');
          }
        } else {
          lines.push('This shared file contains bookmarks for the team to use.');
        }

        // Line 2: file path
        lines.push(vscode.workspace.asRelativePath(item.reg.path, false));

        // Line 3: anchor type
        const effectiveType = resolveTargetAnchorType(file, reg);
        const typeLabel = effectiveType.charAt(0).toUpperCase() + effectiveType.slice(1);
        let source: string;
        if (file.defaultAnchorType) {
          source = '(set by file)';
        } else if (reg.settings?.anchors?.defaultAnchorType) {
          source = '(inherited from settings)';
        } else {
          source = '(default)';
        }
        lines.push(`Anchor type: ${typeLabel} ${source}`);

        item.tooltip = lines.join('\n');
      } catch {
        // Leave default tooltip on error
      }
    }

    if (item instanceof GroupNode) {
      try {
        const lines: string[] = [];
        lines.push(item.group.name);

        if (item.isLocal) {
          const reg = await readRegistry(item.workspaceRoot);
          const hasSharedFile = reg.files.some(f => !isLocalPath(path.relative(item.workspaceRoot, f.path)));
          if (hasSharedFile) {
            lines.push('Saved in a local file. You can move it to a shared file to share it with your team.');
          } else {
            lines.push('Saved in a local file. Create a shared file first, then move this group to share it with your team.');
          }
        } else {
          lines.push('Saved in a shared file.');
        }

        item.tooltip = lines.join('\n');
      } catch {
        // Leave default tooltip on error
      }
    }

    return item;
  }

  /** Get files for a specific workspace folder */
  private async getFilesForWorkspace(wsRoot: string): Promise<RegFileNode[]> {
    try {
      const reg = await readRegistry(wsRoot);
      return reg.files.map(f => {
        const fileId = (f as any).fileId as string;
        const isHidden = this.isFileHidden(fileId, reg);
        return new RegFileNode(f, wsRoot, isHidden);
      });
    } catch {
      return [];
    }
  }

  async getChildren(e?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const folders = vscode.workspace.workspaceFolders || [];

    if (!e) {
      // Root level
      if (folders.length > 1) {
        // Multi-root workspace: show workspace folder nodes
        return folders.map(f => new WorkspaceFolderNode(f));
      } else if (folders.length === 1) {
        // Single workspace: show files directly
        return this.getFilesForWorkspace(folders[0].uri.fsPath);
      }
      return [];
    }

    // Expand workspace folder node to show its files
    if (e instanceof WorkspaceFolderNode) {
      return this.getFilesForWorkspace(e.folder.uri.fsPath);
    }

    if (e instanceof RegFileNode) {
      try {
        const wsRoot = e.workspaceRoot;
        const reg = await readRegistry(wsRoot);
        const fileId = (e.reg as any).fileId as string;
        const ui = this.getUIState();

        // Split the combined isFileHidden predicate (extension.ts:130) into its
        // two components so registry-disable keeps short-circuiting while UI-hide
        // only forces a dimmed visual on children (SML-1381).
        const fileEnabled = (e.reg as any).enabled !== false;
        const fileUiHidden = (ui.hiddenFiles ?? []).includes(fileId);
        const { renderChildren, childrenForcedHidden } = computeFileChildrenVisibility({ fileEnabled, fileUiHidden });
        if (!renderChildren) return [];

        // Use per-file pulse/lock paths to ensure cache freshness aligns with writers (ops)
        const dataRoot = getBookmarksDataRoot(reg);
        const p = pathsForDataFile(e.reg.path, wsRoot, dataRoot);
        const file = await readFileV2(p);
        const defaultTarget = reg.defaultTarget;
        const catalog = await loadBuiltinCatalog(this.extensionContext);
        const appearance: AppearanceOverrides | undefined = reg.settings?.appearance;

        const fileIsLocal = resolveIsLocal(file, p.data, wsRoot);
        const nodes: GroupNode[] = [];
        for (const g of file.groups) {
          const node = new GroupNode(g, e.reg.path, wsRoot, fileIsLocal, childrenForcedHidden);
            const gid = (g as any).id as string;
            // File-forced hidden wins over the canonical focus/hidden precedence
            // (SML-1380): `ui.focus ? ui.focus !== gid : ui.hidden.includes(gid)`.
            const isHidden = computeGroupVisualHidden({ groupId: gid, childrenForcedHidden, uiFocus: ui.focus, uiHidden: ui.hidden });
            const isDefault = !!defaultTarget && (defaultTarget.fileId === (file.fileId as any)) && (defaultTarget.groupId === gid);
            const flags: string[] = [];
            if (!!ui.focus && ui.focus === gid && !childrenForcedHidden) flags.push('focused');
            if (isHidden) flags.push('hidden');
            if (flags.length) node.description = (node.description ? node.description + ' · ' : '') + flags.join(' · ');
            // Set context for menus (allows different toggle icon per state)
            (node as any).contextValue = isHidden ? 'groupHidden' : 'group';
            try {
              if (isHidden) {
                node.iconPath = new vscode.ThemeIcon('eye-closed', HIDDEN_GROUP_THEME_COLOR);
              } else {
                const resolved = await resolveGroupIconPath(g as any, wsRoot, catalog, this.defaultIconPath, dataRoot, appearance);
                node.iconPath = resolved;
              }
            } catch (err) {
              // Log error resolving icon but use fallback icon
              console.error(`[FilesGroupsProvider] Error resolving icon for group ${g.name}:`, err);
              node.iconPath = this.defaultIconPath;
            }
            // Label prefix for default group (keep original icon). Apply even if hidden, to expose default state.
            node.label = isDefault ? `★ ${g.name}` : g.name;
            if (isDefault) node.tooltip = `${g.name} — Default group`;
            nodes.push(node);
        }
        return nodes;
      } catch {
        return [];
      }
    }

    if (e instanceof GroupNode) {
      try {
        const wsRoot = e.workspaceRoot;
        const reg = await readRegistry(wsRoot);
        const dataRoot = getBookmarksDataRoot(reg);
        const p = pathsForDataFile(e.dataFilePath, wsRoot, dataRoot);
        const file = await readFileV2(p);
        const catalog = await loadBuiltinCatalog(this.extensionContext);
        const appearance: AppearanceOverrides | undefined = reg.settings?.appearance;

        const bookmarks = file.bookmarks.filter(b => (b as any).groupId === e.groupId);
        bookmarks.sort((a, b) => {
          const startA = a.anchor.kind === 'point' ? a.anchor.line
            : a.anchor.kind === 'range' ? a.anchor.start.line
            : a.anchor.lastUpdatedLine;
          const startB = b.anchor.kind === 'point' ? b.anchor.line
            : b.anchor.kind === 'range' ? b.anchor.start.line
            : b.anchor.lastUpdatedLine;
          return startA - startB;
        });

        const nodes: vscode.TreeItem[] = [];
        for (const bookmark of bookmarks) {
          try {
            nodes.push(await buildBookmarkNode(bookmark, e.group, e.dataFilePath, wsRoot, catalog, this.defaultIconPath, dataRoot, appearance, e.isFileUiHidden));
          } catch (err) {
            console.error(`[FilesGroupsProvider] Error building bookmark node for ${bookmark.id}:`, err);
          }
        }
        return nodes;
      } catch (err) {
        console.error(`[FilesGroupsProvider] Error reading bookmarks for group ${e.groupId}:`, err);
        return [];
      }
    }

    return [];
  }
}
