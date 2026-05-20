import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { readRegistry, setWatchersEnabled, setFileWatch, rebuildNameIndex, getBookmarksDataRoot, ensureIconCacheDir } from '@agentic-bookmarks/core';
import { loadBuiltinCatalog, resolveGroupIconPath, tokenToHex } from './appearance';
import { getViewPref } from './commands/views';
import { computeWorkspaceStats } from './settingsStats';
import type { LicensingService } from './licensingService';

export class SettingsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _workspaceRoot: string;
  private _extensionContext: vscode.ExtensionContext;
  private _licensing?: LicensingService;

  constructor(workspaceRoot: string, extensionContext: vscode.ExtensionContext, licensing?: LicensingService) {
    this._workspaceRoot = workspaceRoot;
    this._extensionContext = extensionContext;
    this._licensing = licensing;
    if (licensing) {
      licensing.onDidChange(() => this.refresh());
    }
  }

  get workspaceRoot(): string {
    return this._workspaceRoot;
  }

  setWorkspaceRoot(root: string) {
    this._workspaceRoot = root;
    this.refresh();
  }

  refresh() { this._onDidChangeTreeData.fire(); }
  getTreeItem(e: vscode.TreeItem) { return e; }

  async getChildren(e?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const reg = await readRegistry(this.workspaceRoot);
    if (!e) {
      const nodes: vscode.TreeItem[] = [];
      // const openSettings = this.commandItem('Open VS Code Settings…', 'agenticBookmarks.openExtensionSettings');
      // openSettings.iconPath = new vscode.ThemeIcon('gear');
      // nodes.push(openSettings);
      // General section
      const general = new vscode.TreeItem('General', vscode.TreeItemCollapsibleState.Expanded);
      general.iconPath = new vscode.ThemeIcon('settings-gear');
      (general as any).contextValue = 'section';
      nodes.push(general);
      // Appearance toggles (placeholder commands wired in extension.ts)
      const styles = new vscode.TreeItem('Appearance', vscode.TreeItemCollapsibleState.Expanded);
      styles.iconPath = new vscode.ThemeIcon('paintcan');
      (styles as any).contextValue = 'section';
      nodes.push(styles);

      const views = new vscode.TreeItem('Views', vscode.TreeItemCollapsibleState.Expanded);
      views.iconPath = new vscode.ThemeIcon('list-tree');
      (views as any).contextValue = 'section';
      nodes.push(views);

      const processing = new vscode.TreeItem('Processing', vscode.TreeItemCollapsibleState.Expanded);
      processing.iconPath = new vscode.ThemeIcon('server-process');
      (processing as any).contextValue = 'section';
      nodes.push(processing);

      const stats = new vscode.TreeItem('Stats', vscode.TreeItemCollapsibleState.Expanded);
      stats.iconPath = new vscode.ThemeIcon('graph');
      (stats as any).contextValue = 'section';
      nodes.push(stats);

      const license = new vscode.TreeItem('License', vscode.TreeItemCollapsibleState.Expanded);
      license.iconPath = new vscode.ThemeIcon('verified');
      (license as any).contextValue = 'section';
      nodes.push(license);
      return nodes;
    }
    if ((e as any).label === 'General') {
      const items: vscode.TreeItem[] = [];
      const dotsOn = reg.settings?.general?.showInlineDots === true;
      items.push(this.toggleItem('Show inline dots', dotsOn, 'agenticBookmarks.toggleInlineDots'));
      const notesOn = reg.settings?.general?.showNotesAndLabels !== false;
      items.push(this.toggleItem('Show notes and labels', notesOn, 'agenticBookmarks.toggleNotesAndLabels'));
      // Default anchor type
      const anchorType = reg.settings?.anchors?.defaultAnchorType ?? 'smart';
      const anchorLabel = anchorType === 'tag' ? 'Tag' : 'Smart (recommended)';
      const anchorItem = new vscode.TreeItem(`Default anchor: ${anchorLabel}`, vscode.TreeItemCollapsibleState.None);
      anchorItem.command = { command: 'agenticBookmarks.cycleDefaultAnchorType', title: 'Cycle' };
      anchorItem.iconPath = new vscode.ThemeIcon(anchorType === 'tag' ? 'tag' : 'symbol-method');
      items.push(anchorItem);
      return items;
    }
    if ((e as any).label === 'Appearance') {
      const items: vscode.TreeItem[] = [];
      const s = reg.settings?.appearance;
      items.push(this.toggleItem('Show different styles', !!s?.showDifferentStyles, 'agenticBookmarks.toggleShowStyles'));
      const catalog = await loadBuiltinCatalog(this._extensionContext);
      const dataRoot = getBookmarksDataRoot(reg);
      // Uniform style (shows selected style icon in white, or white X if unset)
      {
        let iconPath: vscode.Uri | string = vscode.Uri.file(this.iconAbs('icons/x-white.svg'));
        if (s?.uniformStyle && catalog) {
          // Use the style's white SVG directly (no color tinting for preview)
          const style = catalog.data.styles.find((st: any) => st.id === s.uniformStyle) || catalog.data.styles?.[0];
          const white = style?.svg?.white;
          if (white) {
            iconPath = vscode.Uri.file(path.isAbsolute(white) ? white : path.join(catalog.baseDir, white));
          }
        }
        const ti = this.commandItem('Uniform style…', 'agenticBookmarks.setUniformStyle');
        (ti as any).iconPath = iconPath;
        items.push(ti);
      }
      items.push(this.toggleItem('Show different colors', !!s?.showDifferentColors, 'agenticBookmarks.toggleShowColors'));
      // Uniform color (shows tinted square or white X if unset)
      {
        const color = s?.uniformColor;
        let iconPath: vscode.Uri | string = vscode.Uri.file(this.iconAbs('icons/x-white.svg'));
        if (color) {
          // Resolve palette tokens and CSS named colors to hex
          const hex = color.startsWith('#') ? color : (catalog ? tokenToHex(catalog, color) : undefined);
          if (hex) {
            try { iconPath = await this.ensureColorPreview(hex); } catch {}
          }
        }
        const ti = this.commandItem('Uniform color…', 'agenticBookmarks.setUniformColor');
        (ti as any).iconPath = iconPath;
        items.push(ti);
      }
      // Style catalog is loaded from extension media (SML-1320). No user-facing
      // catalog override surface exists — see catalog-cache.ts for the pro-mode hook.
      return items;
    }
    if ((e as any).label === 'Views') {
      const items: vscode.TreeItem[] = [];
      const ctx = this._extensionContext;
      items.push(this.toggleItem('Show files in All Bookmarks', getViewPref(ctx, 'showFilesInAllBookmarks'), 'agenticBookmarks.toggleShowFilesInAllBookmarks'));
      items.push(this.toggleItem('Show bookmarks in Files & Groups', getViewPref(ctx, 'showBookmarksInFilesAndGroups'), 'agenticBookmarks.toggleShowBookmarksInFilesAndGroups'));
      const cfg = vscode.workspace.getConfiguration('agenticBookmarks');
      const sortAll = cfg.get<string>('sortMode.allBookmarks', 'user');
      const sortFG  = cfg.get<string>('sortMode.filesAndGroups', 'user');
      items.push(this.commandItem(`Sort: All Bookmarks · ${formatSortMode(sortAll)}`, 'agenticBookmarks.setSortModeAllBookmarks'));
      items.push(this.commandItem(`Sort: Files & Groups · ${formatSortMode(sortFG)}`, 'agenticBookmarks.setSortModeFilesAndGroups'));
      return items;
    }
    if ((e as any).label === 'Processing') {
      const items: vscode.TreeItem[] = [];
      items.push(this.commandItem('Rebuild name index', 'agenticBookmarks.rebuildNameIndex'));
      const enabled = !!reg.settings?.watchersEnabled;
      items.push(this.toggleItem('Enable text content watchers', enabled, 'agenticBookmarks.toggleWatchers'));
      const fileWatchers = new vscode.TreeItem('File watchers', vscode.TreeItemCollapsibleState.Collapsed);
      fileWatchers.iconPath = new vscode.ThemeIcon('files');
      (fileWatchers as any).contextValue = 'subsection';
      items.push(fileWatchers);
      return items;
    }
    if ((e as any).label === 'File watchers') {
      const items: vscode.TreeItem[] = [];
      for (const f of reg.files) {
        const ti = this.toggleItem(`Watch ${vscode.workspace.asRelativePath(f.path)}`, f.watch !== false, 'agenticBookmarks.toggleFileWatch');
        ti.command = { command: 'agenticBookmarks.toggleFileWatch', title: 'Toggle', arguments: [f.path, !(f.watch !== false)] };
        items.push(ti);
      }
      return items;
    }
    if ((e as any).label === 'Stats') {
      const stats = await computeWorkspaceStats(reg, this.workspaceRoot);
      const nodes: vscode.TreeItem[] = [];
      nodes.push(new vscode.TreeItem(`${stats.files} enabled file(s)`, vscode.TreeItemCollapsibleState.None));
      nodes.push(new vscode.TreeItem(`${stats.groups} group(s)`, vscode.TreeItemCollapsibleState.None));
      nodes.push(new vscode.TreeItem(`${stats.bookmarks} bookmark(s)`, vscode.TreeItemCollapsibleState.None));
      return nodes;
    }
    if ((e as any).label === 'License') {
      const items: vscode.TreeItem[] = [];
      if (this._licensing) {
        const status = this._licensing.status();
        const vis = this._licensing.visibility();
        let tierLabel: string;
        if (status.tier === 'pro') {
          tierLabel = '[Pro]';
        } else if (status.tier === 'trial' && status.expiresAt) {
          const ms = Date.parse(status.expiresAt) - Date.now();
          const days = Math.max(1, Math.ceil(ms / 86_400_000));
          tierLabel = `[Trial — ${days} day${days === 1 ? '' : 's'} left]`;
        } else if (status.tier === 'trial') {
          tierLabel = '[Trial]';
        } else {
          tierLabel = '[Free]';
        }
        const row = new vscode.TreeItem(`Status: ${tierLabel}`, vscode.TreeItemCollapsibleState.None);
        row.description = `repo: ${vis}`;
        row.iconPath = new vscode.ThemeIcon(status.tier === 'free' ? 'circle-large-outline' : 'verified-filled');
        (row as any).contextValue = 'licenseStatusRow';
        row.tooltip = 'Right-click to re-run the license check and dump a diagnostic report to the Agentic Bookmarks output channel.';
        items.push(row);
      } else {
        items.push(new vscode.TreeItem('Status: (licensing unavailable)', vscode.TreeItemCollapsibleState.None));
      }
      return items;
    }
    return [];
  }

  private toggleItem(label: string, on: boolean, commandId: string): vscode.TreeItem {
    const ti = new vscode.TreeItem(`${label}: ${on ? 'On' : 'Off'}`, vscode.TreeItemCollapsibleState.None);
    ti.command = { command: commandId, title: 'Toggle' };
    ti.iconPath = new vscode.ThemeIcon(on ? 'check' : 'circle-large-outline');
    return ti;
  }

  private commandItem(label: string, commandId: string): vscode.TreeItem {
    const ti = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    ti.command = { command: commandId, title: label };
    ti.iconPath = new vscode.ThemeIcon('gear');
    return ti;
  }

  private iconAbs(rel: string): string {
    const ext = vscode.extensions.getExtension('supermegalab.agentic-bookmarks');
    const base = ext?.extensionPath || __dirname;
    return path.join(base, 'media', rel);
  }

  private async ensureColorPreview(colorHex: string): Promise<vscode.Uri> {
    const safe = colorHex.replace(/[^a-fA-F0-9#]/g, '').replace('#', '').toLowerCase();
    const dir = await ensureIconCacheDir(this.workspaceRoot);
    const file = path.join(dir, `square-${safe}.svg`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="2" ry="2" fill="#${safe}"/></svg>`;
    await fs.writeFile(file, svg, 'utf8');
    return vscode.Uri.file(file);
  }
}

function formatSortMode(m: string): string {
  if (m === 'user') return 'User sorting';
  if (m === 'recent') return 'Recently updated';
  return 'Default';
}
