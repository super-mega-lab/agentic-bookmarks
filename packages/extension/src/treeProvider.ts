import * as vscode from 'vscode';
import * as path from 'node:path';
import { readFileV2, readRegistry, pathsForDataFile, type Paths, type BookmarksFileV2, matchesTextQuery, COMMON_SEARCH_SCOPE, getBookmarksDataRoot, workspaceRelativeToUri } from '@agentic-bookmarks/core';
import type { OrderingService } from './ordering/service';
import { applySort } from './ordering/applySort';
import type { SortMode } from './ordering/types';
import { makeDnDController, type RankedSibling } from './ordering/dnd-controller';
import type { DragSpec } from './ordering/dnd-validation';

const ALL_BOOKMARKS_DND_MIME = 'application/vnd.agenticBookmarks.allBookmarks+json';

/** Earliest line referenced by a bookmark anchor, for default ordering. */
function startLineOf(b: BookmarksFileV2['bookmarks'][number]): number {
  if (b.anchor.kind === 'point') return b.anchor.line;
  if (b.anchor.kind === 'range') return b.anchor.start.line;
  return b.anchor.lastUpdatedLine;
}
import { loadBuiltinCatalog, resolveGroupIconPath, resolveEffectiveStyleAndColor, ensureOverlayIconWithFallback, tokenToHex, type AppearanceOverrides, type EffectiveCatalog } from './appearance';
import { getStatus, getErrorDetails, getScore, getResolvedLine, type AnchorStatus } from './anchorState';
import { getViewPref } from './commands/views';
import { scanRowDescriptor, repairRowDescriptor, type ScanPhase } from './views/action-rows';

/** Dynamic counts the action rows display that the provider can't derive alone. */
export interface ActionRowState {
  /** Current scan phase; 'idle' uses coverage counts, otherwise live progress. */
  scanPhase: ScanPhase;
  /** Files validated so far in the running scan (used when phase !== 'idle'). */
  scanRunningScanned: number;
  /** Total files in the running scan (used when phase !== 'idle'). */
  scanRunningTotal: number;
  /** Genuinely-broken anchors; frozen by the caller while auto-repair is busy. */
  brokenCount: number;
}

export class FileNode extends vscode.TreeItem {
  public readonly workspaceRoot: string;

  constructor(
    public readonly uri: vscode.Uri,
    public readonly entries: Array<{ bookmark: BookmarksFileV2['bookmarks'][number]; dataFilePath: string; group?: BookmarksFileV2['groups'][number] }>,
    workspaceRoot: string
  ) {
    super(
      vscode.workspace.asRelativePath(uri),
      vscode.TreeItemCollapsibleState.Expanded
    );

    this.workspaceRoot = workspaceRoot;
    this.resourceUri = uri;
    this.description = `${entries.length} bookmark${entries.length === 1 ? '' : 's'}`;
    this.contextValue = 'fileNode';
    this.iconPath = vscode.ThemeIcon.File;
  }
}

export class BookmarkNode extends vscode.TreeItem {
  public readonly workspaceRoot: string;
  public readonly status?: AnchorStatus;
  public readonly score?: number;
  public readonly errorDetails?: string;
  // Set by the producing provider when this node is returned as a child of
  // another node — needed so TreeView.reveal() and the drag/drop sibling
  // resolver can walk up via getParent(). May be a FileNode (BookmarksProvider)
  // or a GroupNode (FilesGroupsProvider).
  public parent?: vscode.TreeItem;

  constructor(
    public readonly id: string,
    public readonly bookmark: BookmarksFileV2['bookmarks'][number],
    public readonly dataFilePath: string,
    workspaceRoot: string,
    public readonly iconPathResolved?: string,
    public readonly groupName?: string,
    status?: AnchorStatus,
    errorDetails?: string,
    score?: number,
    resolvedLine?: number,
    isVisuallyHidden: boolean = false
  ) {
    const baseLabel = (bookmark.label && bookmark.label.trim().length > 0)
      ? bookmark.label
      : (bookmark.anchor as any).lineCache?.replace(/^\s+/, '') || '';
    let label: string = baseLabel;
    if (bookmark.anchor.kind === 'point') {
      const ln = bookmark.anchor.line + 1;
      label = `Ln ${ln}: ${baseLabel}`;
    } else if (bookmark.anchor.kind === 'range') {
      const a = bookmark.anchor;
      const s = a.start.line + 1;
      const e = a.end.line + 1;
      label = `Ln ${s}–${e}: ${baseLabel}`;
    } else if (bookmark.anchor.kind === 'smart' || bookmark.anchor.kind === 'tag') {
      const ln = (resolvedLine ?? bookmark.anchor.lastUpdatedLine) + 1;
      label = `Ln ${ln}: ${baseLabel}`;
    }

    super(label, vscode.TreeItemCollapsibleState.None);

    this.workspaceRoot = workspaceRoot;
    this.status = status;
    this.score = score;
    this.errorDetails = errorDetails;
    const noteSuffix = (bookmark.note && bookmark.note.trim().length > 0) ? 'WithNote' : '';
    const baseContext = status === 'broken' ? 'bookmarkBroken' : status === 'warning' ? 'bookmarkWarning' : 'bookmark';
    this.contextValue = baseContext + noteSuffix;
    // Build structured tooltip
    const tipLines: string[] = [];
    const lineCache = (bookmark.anchor as any).lineCache as string | undefined;
    if (lineCache) tipLines.push(lineCache);
    if (bookmark.label && bookmark.label.trim().length > 0) tipLines.push(`Label: ${bookmark.label}`);
    if (bookmark.note && bookmark.note.trim().length > 0) tipLines.push(`Note: ${bookmark.note}`);
    if (bookmark.tags && bookmark.tags.length > 0) tipLines.push(`Tags: ${bookmark.tags.join(', ')}`);
    if (this.groupName) tipLines.push(`Group: ${this.groupName}`);
    if (status === 'warning' && score !== undefined) {
      const showWarnings = vscode.workspace.getConfiguration('agenticBookmarks').get('showWarningIndicators', true);
      if (showWarnings) {
        tipLines.push(`Partial context match (score: ${score.toFixed(2)})`);
      }
    }
    if (status === 'broken' && errorDetails) {
      tipLines.push(`Broken: ${errorDetails}`);
    }
    this.tooltip = tipLines.length > 0 ? tipLines.join('\n') : undefined;
    if (iconPathResolved) this.iconPath = iconPathResolved;
    else this.iconPath = new vscode.ThemeIcon('bookmark');

    // Make it clickable to open
    this.command = {
      command: 'agenticBookmarks.open',
      title: 'Open Bookmark',
      arguments: [this]
    };

    if (bookmark.tags && bookmark.tags.length > 0) {
      this.description = bookmark.tags.join(', ');
    }

    // SML-1381: when the owning file is UI-hidden, bookmarks under it render
    // dimmed with the eye-closed icon to mirror the existing hidden-group
    // visual treatment in filesGroupsProvider.
    if (isVisuallyHidden) {
      this.iconPath = new vscode.ThemeIcon('eye-closed', new vscode.ThemeColor('disabledForeground'));
      this.description = this.description ? `${this.description} · hidden` : 'hidden';
    }
  }
}

type SearchFilter = { id: string; text: string; regex: boolean; op: 'AND' | 'OR' };
type UIState = { hidden: string[]; focus: string | null; filterEnabled?: boolean; searches?: SearchFilter[]; hiddenFiles?: string[] };

/**
 * Build a `BookmarkNode` for a single bookmark, including anchor-status
 * lookup and icon resolution (with overlay for warning/broken). Shared by
 * `BookmarksProvider` (All Bookmarks tree) and `FilesGroupsProvider`
 * (Files + Groups tree) so both surfaces produce identical leaves.
 */
export async function buildBookmarkNode(
  bookmark: BookmarksFileV2['bookmarks'][number],
  group: BookmarksFileV2['groups'][number] | undefined,
  dataFilePath: string,
  workspaceRoot: string,
  catalog: EffectiveCatalog | null,
  defaultIconPath: string,
  dataRoot: string,
  appearance: AppearanceOverrides | undefined,
  isVisuallyHidden: boolean = false
): Promise<BookmarkNode> {
  // Normalize URI to absolute format (matching anchorState key format)
  let bookmarkUri = bookmark.target.uri;
  const fragmentIndex = bookmarkUri.indexOf('#');
  if (fragmentIndex >= 0) bookmarkUri = bookmarkUri.substring(0, fragmentIndex);
  if (!bookmarkUri.startsWith('file://')) {
    bookmarkUri = workspaceRelativeToUri(bookmarkUri, workspaceRoot);
  }

  const status = getStatus(bookmarkUri, bookmark.id);
  const errorDetails = status === 'broken' ? getErrorDetails(bookmarkUri, bookmark.id) : undefined;

  const showWarnings = vscode.workspace.getConfiguration('agenticBookmarks').get('showWarningIndicators', true);
  let icon: string;
  if (status === 'broken') {
    const eff = resolveEffectiveStyleAndColor(group as any, catalog, appearance);
    const basePath = await resolveGroupIconPath(group as any, workspaceRoot, catalog, defaultIconPath, dataRoot, appearance);
    const overlayResult = await ensureOverlayIconWithFallback(
      basePath,
      eff.colorHex,
      'exclamation',
      eff.styleId,
      workspaceRoot,
      dataRoot
    );
    icon = overlayResult.iconPath;
  } else if (status === 'warning' && showWarnings) {
    const eff = resolveEffectiveStyleAndColor(group as any, catalog, appearance);
    const basePath = await resolveGroupIconPath(group as any, workspaceRoot, catalog, defaultIconPath, dataRoot, appearance);
    const overlayResult = await ensureOverlayIconWithFallback(
      basePath,
      eff.colorHex,
      'question',
      eff.styleId,
      workspaceRoot,
      dataRoot
    );
    icon = overlayResult.iconPath;
  } else {
    icon = await resolveGroupIconPath(group as any, workspaceRoot, catalog, defaultIconPath, dataRoot, appearance);
  }

  const score = (status === 'warning') ? getScore(bookmarkUri, bookmark.id) : undefined;
  const resolvedLine = getResolvedLine(bookmarkUri, bookmark.id);
  return new BookmarkNode(bookmark.id, bookmark, dataFilePath, workspaceRoot, icon, group?.name, status, errorDetails, score, resolvedLine, isVisuallyHidden);
}

export class BookmarksProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  public readonly dnd: vscode.TreeDragAndDropController<vscode.TreeItem>;

  constructor(
    private readonly paths: Paths,
    private readonly workspaceRoot: string,  // Primary workspace (for backward compat)
    private readonly defaultIconPath: string,
    private readonly getUIState: () => UIState,
    private readonly isFileHidden: (fileId: string, reg: any) => boolean,
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly orderingService: OrderingService,
    private readonly getActionRowState: () => ActionRowState = () => ({ scanPhase: 'idle', scanRunningScanned: 0, scanRunningTotal: 0, brokenCount: 0 }),
    private readonly isFileValidated: (fsPath: string) => boolean = () => false
  ) {
    this.dnd = makeDnDController({
      mimeType: ALL_BOOKMARKS_DND_MIME,
      service: orderingService,
      onChanged: () => this._onDidChangeTreeData.fire(),
      specOf: (item) => this.specOf(item),
      resolveSiblings: (target) => this.resolveSiblings(target),
    });
  }

  private specOf(item: vscode.TreeItem): DragSpec | null {
    if (item instanceof BookmarkNode) {
      const parent = item.parent;
      if (parent instanceof FileNode) {
        return { kind: 'bookmark', id: item.id, ctx: 'f', parentId: parent.resourceUri!.toString() };
      }
      // Flat list (showFiles=false)
      return { kind: 'bookmark', id: item.id, ctx: 'a', parentId: null };
    }
    if (item instanceof FileNode) {
      return { kind: 'file', id: item.resourceUri!.toString(), ctx: 'a', parentId: null };
    }
    return null;
  }

  private async resolveSiblings(target: vscode.TreeItem): Promise<{ siblings: RankedSibling[]; insertIdx: number } | null> {
    let parent: vscode.TreeItem | undefined;
    if (target instanceof BookmarkNode) parent = target.parent;     // FileNode or undefined (flat)
    else if (target instanceof FileNode) parent = undefined;        // FileNodes live at root
    else return null;

    const raw = await this.getChildren(parent);
    // Filter the sibling list to items of the same kind as target (excludes
    // root-level filterInfo, plus mixed-kind items in scopes that allow them).
    const siblings: RankedSibling[] = [];
    for (const item of raw) {
      const s = this.specOf(item);
      if (!s) continue;
      // Only items in the same scope as the target are real siblings.
      const t = this.specOf(target);
      if (!t || s.kind !== t.kind || s.ctx !== t.ctx || s.parentId !== t.parentId) continue;
      siblings.push({ spec: s, rank: this.orderingService.get(s.kind, s.id, s.ctx) ?? null });
    }
    const targetId = (target instanceof FileNode) ? target.resourceUri!.toString() : (target as BookmarkNode).id;
    const insertIdx = siblings.findIndex(s => s.spec.id === targetId);
    if (insertIdx < 0) return null;
    return { siblings, insertIdx };
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  // Required for TreeView.reveal() to walk up the tree. BookmarkNodes carry
  // their parent FileNode (set in the FileNode branch of getChildren above).
  // FileNodes and other root-level items return undefined.
  getParent(element: vscode.TreeItem): vscode.TreeItem | undefined {
    if (element instanceof BookmarkNode) return element.parent;
    return undefined;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const sortMode = vscode.workspace.getConfiguration('agenticBookmarks').get<SortMode>('sortMode.allBookmarks', 'user');
    if (!element) {
      // Root level: show all bookmarks across ALL workspace folders, grouped by document URI
      const folders = vscode.workspace.workspaceFolders || [];
      const ui = this.getUIState();
      const filterEnabled = ui.filterEnabled === true;
      // Map: absolute URI string -> entries (with workspaceRoot for each)
      const fileMap = new Map<string, Array<{ bookmark: BookmarksFileV2['bookmarks'][number]; dataFilePath: string; group?: BookmarksFileV2['groups'][number]; wsRoot: string }>>();

      let filteredBookmarks = 0;
      const filteredGroups = new Set<string>();
      let totalBookmarks = 0;
      let visibleBookmarks = 0;
      const totalGroupIds = new Set<string>();
      const visibleGroupIds = new Set<string>();
      // fsPath → bookmark count (unfiltered) — drives Scan coverage in bookmark units.
      const bookmarksPerFsPath = new Map<string, number>();

      // Iterate over all workspace folders
      for (const folder of folders) {
        const wsRoot = folder.uri.fsPath;
        try {
          const reg = await readRegistry(wsRoot);
          const dataRoot = getBookmarksDataRoot(reg);
          // Filter out files that are hidden (either disabled in registry OR
          // hidden in workspace state). Bullseye trumps the UI-hide branch:
          // when filterEnabled && ui.focus is set, file-level UI-hide is
          // bypassed so the focused group's bookmarks remain visible (extends
          // SML-1380's focus-wins precedence to the file boundary).
          // Registry-disable always wins.
          const visibleFiles = reg.files.filter(f => {
            const fileId = (f as any).fileId as string;
            if (!this.isFileHidden(fileId, reg)) return true;
            if ((f as any).enabled === false) return false;
            return filterEnabled && ui.focus !== null;
          });

          for (const f of visibleFiles) {
            try {
              const p = pathsForDataFile(f.path, wsRoot, dataRoot);
              const file = await readFileV2(p);
              for (const g of file.groups) totalGroupIds.add((g as any).id as string);
              for (const bookmark of file.bookmarks) {
                totalBookmarks++;
                let baseUri = bookmark.target.uri;
                const fragmentIndex = baseUri.indexOf('#');
                if (fragmentIndex >= 0) baseUri = baseUri.substring(0, fragmentIndex);

                // Convert to absolute URI for consistent map key
                let absoluteUri: string;
                if (baseUri.startsWith('file://')) {
                  absoluteUri = baseUri;
                } else {
                  absoluteUri = workspaceRelativeToUri(baseUri, wsRoot);
                }

                if (!fileMap.has(absoluteUri)) fileMap.set(absoluteUri, []);
                try {
                  const fp = vscode.Uri.parse(absoluteUri).fsPath;
                  bookmarksPerFsPath.set(fp, (bookmarksPerFsPath.get(fp) ?? 0) + 1);
                } catch { /* ignore unparseable URIs */ }
                const group = file.groups.find(g => (g as any).id === (bookmark as any).groupId);
                const gid = (bookmark as any).groupId as string;
                const isHidden = ui.focus ? ui.focus !== gid : ui.hidden.includes(gid);
                if (filterEnabled && isHidden) {
                  filteredBookmarks++;
                  filteredGroups.add(gid);
                  continue;
                }
                // Apply sub-search filters (searches label, note, and lineCache)
                let matchesSearch = true;
                const searches = Array.isArray(ui.searches) ? ui.searches : [];
                if (filterEnabled && searches.length > 0) {
                  const ands = searches.filter(s => s.op === 'AND');
                  const ors = searches.filter(s => s.op === 'OR');
                  const test = (s: SearchFilter) => {
                    if (s.regex) {
                      try {
                        const rx = new RegExp(s.text, 'i');
                        // Test against label, note, and lineCache
                        if (rx.test((bookmark as any).label)) return true;
                        if ((bookmark as any).note && rx.test((bookmark as any).note)) return true;
                        const anchor = (bookmark as any).anchor;
                        if (anchor?.lineCache && rx.test(anchor.lineCache)) return true;
                        return false;
                      } catch { return false; }
                    }
                    // Use shared filter logic for non-regex searches
                    return matchesTextQuery(bookmark as any, s.text, COMMON_SEARCH_SCOPE);
                  };
                  const andOk = ands.every(test);
                  const orOk = ors.length === 0 || ors.some(test);
                  matchesSearch = andOk && orOk;
                }
                if (!matchesSearch) continue;
                visibleBookmarks++;
                visibleGroupIds.add(gid);
                fileMap.get(absoluteUri)!.push({ bookmark, dataFilePath: f.path, group, wsRoot });
              }
            } catch (err) {
              // Log error but continue with other files - don't let one bad file break entire tree
              console.error(`[BookmarkTreeProvider] Error reading bookmark file ${f.path}:`, err);
            }
          }
        } catch (err) {
          // Log error reading registry for this workspace folder
          console.error(`[BookmarkTreeProvider] Error reading registry for workspace ${wsRoot}:`, err);
        }
      }

      const nodes: vscode.TreeItem[] = [];
      if (filterEnabled) {
        const label = `${visibleBookmarks}/${totalBookmarks} bookmarks · ${visibleGroupIds.size}/${totalGroupIds.size} groups`;
        const hasSearches = Array.isArray(ui.searches) && ui.searches.length > 0;
        const info = new vscode.TreeItem(label, hasSearches ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
        info.iconPath = new vscode.ThemeIcon('filter-filled');
        (info as any).contextValue = 'filterInfo';
        nodes.push(info);
      }

      // Action rows — rendered directly below filterInfo (or at the very top when
      // filtering is off). Independent of filtering; counts cover all bookmarks.
      {
        const st = this.getActionRowState();
        // At rest, show coverage (validated / all bookmarks); during a scan,
        // show the live progress reported by the scan queue. Counts are in
        // bookmark units — each file contributes its bookmark count.
        let scanned: number;
        let total: number;
        if (st.scanPhase === 'idle') {
          total = 0;
          scanned = 0;
          for (const [p, count] of bookmarksPerFsPath) {
            total += count;
            if (this.isFileValidated(p)) scanned += count;
          }
        } else {
          total = st.scanRunningTotal;
          scanned = st.scanRunningScanned;
        }

        const scan = scanRowDescriptor({ scanned, total, phase: st.scanPhase });
        const scanRow = new vscode.TreeItem(scan.label, vscode.TreeItemCollapsibleState.None);
        scanRow.iconPath = new vscode.ThemeIcon(scan.spin ? `${scan.icon}~spin` : scan.icon);
        (scanRow as any).contextValue = scan.contextValue;
        // No row.command — activation is via the inline button / context menu only,
        // so a stray row click can't kick off a scan.
        nodes.push(scanRow);

        const repair = repairRowDescriptor({ broken: st.brokenCount, total: totalBookmarks });
        const repairRow = new vscode.TreeItem(repair.label, vscode.TreeItemCollapsibleState.None);
        repairRow.iconPath = new vscode.ThemeIcon(repair.icon, new vscode.ThemeColor(repair.themeColor));
        (repairRow as any).contextValue = repair.contextValue;
        // No row.command — activation is via the inline button / context menu only.
        nodes.push(repairRow);
      }
      // Determine whether to group bookmarks under file parents. Stored in
      // workspaceState because the registry schema strips unknown keys.
      const showFiles = getViewPref(this.extensionContext, 'showFilesInAllBookmarks');

      if (!showFiles) {
        const catalog = await loadBuiltinCatalog(this.extensionContext);
        const flatEntries: Array<{ uri: string; entry: { bookmark: BookmarksFileV2['bookmarks'][number]; dataFilePath: string; group?: BookmarksFileV2['groups'][number]; wsRoot: string } }> = [];
        for (const [absoluteUri, entries] of fileMap) {
          for (const entry of entries) flatEntries.push({ uri: absoluteUri, entry });
        }
        // Apply per-view sort mode in flat (no-files) All Bookmarks. ctx='a'.
        const flatSortable = flatEntries.map(fe => ({
          id: (fe.entry.bookmark as any).id as string,
          kind: 'bookmark' as const,
          updatedAt: (fe.entry.bookmark as any).updatedAt as number | undefined,
          _orig: fe,
        }));
        const flatDefaultCmp = (a: typeof flatSortable[number], b: typeof flatSortable[number]) => {
          const uriCmp = a._orig.uri.localeCompare(b._orig.uri);
          if (uriCmp !== 0) return uriCmp;
          return startLineOf(a._orig.entry.bookmark) - startLineOf(b._orig.entry.bookmark);
        };
        const sortedFlat = applySort(flatSortable, sortMode, 'a', this.orderingService, flatDefaultCmp);
        flatEntries.length = 0;
        for (const s of sortedFlat) flatEntries.push(s._orig);
        // Cache per-workspace registry lookups to avoid re-reading on every entry.
        const regCache = new Map<string, { dataRoot: string; appearance: AppearanceOverrides | undefined }>();
        for (const { entry } of flatEntries) {
          try {
            let cached = regCache.get(entry.wsRoot);
            if (!cached) {
              const reg = await readRegistry(entry.wsRoot);
              cached = { dataRoot: getBookmarksDataRoot(reg), appearance: reg.settings?.appearance };
              regCache.set(entry.wsRoot, cached);
            }
            const node = await buildBookmarkNode(entry.bookmark, entry.group, entry.dataFilePath, entry.wsRoot, catalog, this.defaultIconPath, cached.dataRoot, cached.appearance);
            nodes.push(node);
          } catch (err) {
            console.error(`[BookmarkTreeProvider] Error building flat bookmark node for ${entry.bookmark.id}:`, err);
          }
        }
        return nodes;
      }

      const fileNodes: FileNode[] = [];
      for (const [absoluteUri, entries] of fileMap) {
        if (entries.length === 0) continue; // hide documents with no visible bookmarks under filtering
        try {
          const uri = vscode.Uri.parse(absoluteUri);
          // Use the first entry's wsRoot for the FileNode (all entries for same file should be same workspace)
          const wsRoot = entries[0]?.wsRoot || this.workspaceRoot;
          fileNodes.push(new FileNode(uri, entries, wsRoot));
        } catch (err) {
          // Log error parsing URI but continue with other files
          console.error(`[BookmarkTreeProvider] Error creating FileNode for URI ${absoluteUri}:`, err);
        }
      }
      // Apply per-view sort mode to file nodes. ctx='a'. updatedAt for a file
      // is derived as the max of its child bookmark updatedAts.
      const fileSortable = fileNodes.map(fn => ({
        id: fn.resourceUri!.toString(),
        kind: 'file' as const,
        updatedAt: fn.entries.reduce((m, e) => Math.max(m, (e.bookmark as any).updatedAt ?? 0), 0),
        _node: fn,
      }));
      const fileDefaultCmp = (a: typeof fileSortable[number], b: typeof fileSortable[number]) =>
        a._node.label!.toString().localeCompare(b._node.label!.toString());
      const sortedFiles = applySort(fileSortable, sortMode, 'a', this.orderingService, fileDefaultCmp)
        .map(s => s._node);
      return nodes.concat(sortedFiles);
    }

    if (element instanceof FileNode) {
      // Show bookmarks for this document URI
      const wsRoot = element.workspaceRoot;
      const catalog = await loadBuiltinCatalog(this.extensionContext);
      const reg = await readRegistry(wsRoot);
      const dataRoot = getBookmarksDataRoot(reg);
      const appearance: AppearanceOverrides | undefined = reg.settings?.appearance;
      // Apply per-view sort mode within the file. ctx='f', parentId=file URI.
      const fileSortable = element.entries.map(e => ({
        id: (e.bookmark as any).id as string,
        kind: 'bookmark' as const,
        updatedAt: (e.bookmark as any).updatedAt as number | undefined,
        _entry: e,
      }));
      const cmp = (a: typeof fileSortable[number], b: typeof fileSortable[number]) =>
        startLineOf(a._entry.bookmark) - startLineOf(b._entry.bookmark);
      const entries = applySort(fileSortable, sortMode, 'f', this.orderingService, cmp)
        .map(s => s._entry);
      const nodes: vscode.TreeItem[] = [];
      for (const entry of entries) {
        // Use entry's wsRoot if available (multi-workspace support)
        const entryWsRoot = (entry as any).wsRoot || wsRoot;
        const node = await buildBookmarkNode(entry.bookmark, entry.group, entry.dataFilePath, entryWsRoot, catalog, this.defaultIconPath, dataRoot, appearance);
        node.parent = element;
        nodes.push(node);
      }
      return nodes;
    }
    
    // Sub-search nodes under filter info
    if ((element as any).contextValue === 'filterInfo') {
      const ui = this.getUIState();
      const searches = Array.isArray(ui.searches) ? ui.searches : [];
      const nodes: vscode.TreeItem[] = [];
      for (const s of searches) {
        const prefix = s.op === 'OR' ? '||' : '&&';
        const label = `${prefix} ${s.text}`;
        const ti = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        (ti as any).contextValue = 'subSearch';
        (ti as any).searchId = s.id;
        if (s.regex) ti.iconPath = new vscode.ThemeIcon('regex');
        nodes.push(ti);
      }
      return nodes;
    }
    
    return [];
  }
}
