/**
 * Appearance commands extracted from extension.ts.
 *
 * Commands:
 *   agenticBookmarks.groupSetAppearance
 *   agenticBookmarks.groupSetStyle
 *   agenticBookmarks.groupSetColor
 *   agenticBookmarks.setUniformStyle
 *   agenticBookmarks.setUniformColor
 *   agenticBookmarks.clearUniformStyle
 *   agenticBookmarks.clearUniformColor
 *   agenticBookmarks.toggleShowStyles
 *   agenticBookmarks.toggleShowColors
 *   agenticBookmarks.rebuildNameIndex
 */

import * as vscode from 'vscode';
import {
  pathsForDataFile,
  editFileV2,
  readRegistry,
  registryPathForRoot,
  rebuildNameIndex,
} from '@agentic-bookmarks/core';
import type { Logger } from '../logger';
import type { BookmarksProvider } from '../treeProvider';
import type { FilesGroupsProvider } from '../filesGroupsProvider';
import type { SettingsProvider } from '../settingsProvider';
import { pickColorQuick, pickStyleQuick } from '../pickers';
import {
  getWorkspaceForGroupNode,
  getConfiguredDataRoot,
} from '../workspace-helpers';

export interface AppearanceDeps {
  workspaceRoot: string;
  log: Logger;
  context: vscode.ExtensionContext;
  provider: BookmarksProvider;
  filesGroups: FilesGroupsProvider;
  settingsProvider: SettingsProvider;
  updateDecorations: () => Promise<void>;
  refreshDecorationAppearance: () => Promise<void>;
  getCatalog: () => Promise<{ data: any; baseDir: string } | null>;
  clearCatalogCache: () => void;
}

export function registerAppearanceCommands(deps: AppearanceDeps): vscode.Disposable[] {
  const {
    workspaceRoot,
    context,
    provider,
    filesGroups,
    settingsProvider,
    updateDecorations,
    refreshDecorationAppearance,
    getCatalog,
    clearCatalogCache,
  } = deps;

  return [
    // Two-phase appearance picker: choose color or style, then delegate
    vscode.commands.registerCommand('agenticBookmarks.groupSetAppearance', async (node: any) => {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(paintcan) Change color', value: 'color' },
          { label: '$(bookmark) Change style', value: 'style' },
        ],
        { placeHolder: 'What would you like to change?' }
      );
      if (!choice) return;
      if ((choice as any).value === 'color') {
        await vscode.commands.executeCommand('agenticBookmarks.groupSetColor', node);
      } else {
        await vscode.commands.executeCommand('agenticBookmarks.groupSetStyle', node);
      }
    }),

    // Change a group's icon style (from catalog)
    vscode.commands.registerCommand('agenticBookmarks.groupSetStyle', async (node: any) => {
      try {
        const dataFilePath: string | undefined = node?.dataFilePath;
        const groupId: string | undefined = node?.group?.id;
        if (!dataFilePath || !groupId) return;

        const nodeWsRoot = node?.workspaceRoot || workspaceRoot;
        const nodeWsFolder = getWorkspaceForGroupNode(node) || vscode.workspace.workspaceFolders![0];

        const catalog = await getCatalog();
        if (!catalog) {
          vscode.window.showWarningMessage('No style catalog configured. Set one in Settings.');
          return;
        }

        const picked = await pickStyleQuick({ catalog, placeholder: 'Select icon style for this group' });
        if (!picked) return;

        const dataRoot = getConfiguredDataRoot(nodeWsFolder);
        await editFileV2(pathsForDataFile(dataFilePath, nodeWsRoot, dataRoot), (f) => {
          const g = f.groups.find(g => (g as any).id === groupId);
          if (!g) return;
          (g as any).icon = (g as any).icon || {};
          (g as any).icon.svg_style = picked;
          (g as any).updatedAt = Date.now();
        });

        filesGroups.refresh();
        provider.refresh();
        await refreshDecorationAppearance();
        await updateDecorations();
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to set group style: ${e}`);
      }
    }),

    // Change a group's color
    vscode.commands.registerCommand('agenticBookmarks.groupSetColor', async (node: any) => {
      try {
        const dataFilePath: string | undefined = node?.dataFilePath;
        const groupId: string | undefined = node?.group?.id;
        if (!dataFilePath || !groupId) return;

        const nodeWsRoot = node?.workspaceRoot || workspaceRoot;
        const nodeWsFolder = getWorkspaceForGroupNode(node) || vscode.workspace.workspaceFolders![0];

        const reg = await readRegistry(nodeWsRoot);
        const cat = await getCatalog();

        const picked = await pickColorQuick({
          context,
          workspaceRoot: nodeWsRoot,
          catalog: cat,
          title: 'Select group color',
          resolveToHex: false,
        });
        if (!picked) return;

        const dataRoot = getConfiguredDataRoot(nodeWsFolder);
        await editFileV2(pathsForDataFile(dataFilePath, nodeWsRoot, dataRoot), (f) => {
          const g = f.groups.find(g => (g as any).id === groupId);
          if (!g) return;
          (g as any).icon = (g as any).icon || {};
          (g as any).icon.svg_color = picked.token;
          (g as any).updatedAt = Date.now();
        });

        filesGroups.refresh();
        provider.refresh();
        await refreshDecorationAppearance();
        await updateDecorations();
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to set group color: ${e}`);
      }
    }),

    // Set uniform style
    vscode.commands.registerCommand('agenticBookmarks.setUniformStyle', async () => {
      const reg = await readRegistry(workspaceRoot);
      const catalog = await getCatalog();
      if (!catalog) {
        vscode.window.showWarningMessage('No style catalog configured. Set one in Settings.');
        return;
      }

      const picked = await pickStyleQuick({ catalog, placeholder: 'Select uniform icon style for all groups', allowClear: true });
      if (picked === undefined) return;

      (reg as any).settings = reg.settings || ({} as any);
      (reg as any).settings.appearance = reg.settings?.appearance || ({} as any);
      (reg as any).settings.appearance.uniformStyle = picked || undefined;
      const fs = require('fs').promises as typeof import('node:fs/promises');
      await fs.writeFile(registryPathForRoot(workspaceRoot), JSON.stringify(reg, null, 2));
      settingsProvider.refresh(); filesGroups.refresh(); provider.refresh();
      await refreshDecorationAppearance(); await updateDecorations();
    }),

    // Set uniform color
    vscode.commands.registerCommand('agenticBookmarks.setUniformColor', async () => {
      const reg = await readRegistry(workspaceRoot);
      const cat = await getCatalog();

      const picked = await pickColorQuick({
        context,
        workspaceRoot,
        catalog: cat,
        title: 'Select uniform color for all groups',
        resolveToHex: false,
        allowClear: true,
      });
      if (picked === undefined) return;

      (reg as any).settings = reg.settings || ({} as any);
      (reg as any).settings.appearance = reg.settings?.appearance || ({} as any);
      (reg as any).settings.appearance.uniformColor = (picked && picked.token) || undefined;
      const fs = require('fs').promises as typeof import('node:fs/promises');
      await fs.writeFile(registryPathForRoot(workspaceRoot), JSON.stringify(reg, null, 2));
      settingsProvider.refresh(); filesGroups.refresh(); provider.refresh();
      await refreshDecorationAppearance(); await updateDecorations();
    }),

    // Clear uniform style
    vscode.commands.registerCommand('agenticBookmarks.clearUniformStyle', async () => {
      const reg = await readRegistry(workspaceRoot);
      (reg as any).settings = reg.settings || ({} as any);
      (reg as any).settings.appearance = reg.settings?.appearance || ({} as any);
      delete (reg as any).settings.appearance.uniformStyle;
      const fs = require('fs').promises as typeof import('node:fs/promises');
      await fs.writeFile(registryPathForRoot(workspaceRoot), JSON.stringify(reg, null, 2));
      settingsProvider.refresh();
      await refreshDecorationAppearance();
      await updateDecorations();
    }),

    // Clear uniform color
    vscode.commands.registerCommand('agenticBookmarks.clearUniformColor', async () => {
      const reg = await readRegistry(workspaceRoot);
      (reg as any).settings = reg.settings || ({} as any);
      (reg as any).settings.appearance = reg.settings?.appearance || ({} as any);
      delete (reg as any).settings.appearance.uniformColor;
      const fs = require('fs').promises as typeof import('node:fs/promises');
      await fs.writeFile(registryPathForRoot(workspaceRoot), JSON.stringify(reg, null, 2));
      settingsProvider.refresh();
      await refreshDecorationAppearance();
      await updateDecorations();
    }),

    // Toggle show different styles
    vscode.commands.registerCommand('agenticBookmarks.toggleShowStyles', async () => {
      const reg = await readRegistry(workspaceRoot);
      const cur = !!reg.settings?.appearance?.showDifferentStyles;
      (reg as any).settings = reg.settings || ({} as any);
      (reg as any).settings.appearance = reg.settings?.appearance || ({} as any);
      (reg as any).settings.appearance.showDifferentStyles = !cur;
      const fs = require('fs').promises as typeof import('node:fs/promises');
      await fs.writeFile(registryPathForRoot(workspaceRoot), JSON.stringify(reg, null, 2));
      settingsProvider.refresh(); filesGroups.refresh(); provider.refresh();
      await refreshDecorationAppearance(); await updateDecorations();
    }),

    // Toggle show different colors
    vscode.commands.registerCommand('agenticBookmarks.toggleShowColors', async () => {
      const reg = await readRegistry(workspaceRoot);
      const cur = !!reg.settings?.appearance?.showDifferentColors;
      (reg as any).settings = reg.settings || ({} as any);
      (reg as any).settings.appearance = reg.settings?.appearance || ({} as any);
      (reg as any).settings.appearance.showDifferentColors = !cur;
      const fs = require('fs').promises as typeof import('node:fs/promises');
      await fs.writeFile(registryPathForRoot(workspaceRoot), JSON.stringify(reg, null, 2));
      settingsProvider.refresh(); filesGroups.refresh(); provider.refresh();
      await refreshDecorationAppearance(); await updateDecorations();
    }),

    // agenticBookmarks.setStyleCatalogPath was removed in SML-1320 (locked-down
    // catalog surface). Pro-mode would re-add a user-facing catalog picker;
    // `settings.appearance.styleCatalogPath` is preserved as optional in the
    // schema so a future re-enable doesn't need a migration.

    // Rebuild name index
    vscode.commands.registerCommand('agenticBookmarks.rebuildNameIndex', async () => {
      try { await rebuildNameIndex(workspaceRoot); settingsProvider.refresh(); filesGroups.refresh(); }
      catch (e) { vscode.window.showErrorMessage(String(e)); }
    }),
  ];
}
