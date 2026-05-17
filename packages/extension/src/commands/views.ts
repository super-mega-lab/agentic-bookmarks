/**
 * View-structure toggle commands.
 *
 * Stored in workspaceState (not the registry) because the registry's zod
 * schema strips unknown keys on read.
 *
 * Commands:
 *   agenticBookmarks.toggleShowFilesInAllBookmarks
 *   agenticBookmarks.toggleShowBookmarksInFilesAndGroups
 */

import * as vscode from 'vscode';
import type { BookmarksProvider } from '../treeProvider';
import type { FilesGroupsProvider } from '../filesGroupsProvider';
import type { SettingsProvider } from '../settingsProvider';
import { SETTINGS_DEFAULTS, withDefault } from '../settings-defaults';

export const VIEW_PREFS_KEY = 'agenticBookmarks.viewPrefs';

export interface ViewPrefs {
  showFilesInAllBookmarks?: boolean;
  showBookmarksInFilesAndGroups?: boolean;
}

export function getViewPrefs(context: vscode.ExtensionContext): ViewPrefs {
  return context.workspaceState.get<ViewPrefs>(VIEW_PREFS_KEY, {});
}

export function getViewPref<K extends keyof ViewPrefs>(
  context: vscode.ExtensionContext,
  key: K,
): NonNullable<ViewPrefs[K]> {
  const stored = getViewPrefs(context)[key];
  return withDefault(stored, SETTINGS_DEFAULTS.viewPrefs[key]) as NonNullable<ViewPrefs[K]>;
}

export interface ViewsDeps {
  context: vscode.ExtensionContext;
  provider: BookmarksProvider;
  filesGroups: FilesGroupsProvider;
  settingsProvider: SettingsProvider;
}

async function flipViewToggle(context: vscode.ExtensionContext, key: keyof ViewPrefs): Promise<void> {
  const prefs = getViewPrefs(context);
  const cur = withDefault(prefs[key], SETTINGS_DEFAULTS.viewPrefs[key]);
  await context.workspaceState.update(VIEW_PREFS_KEY, { ...prefs, [key]: !cur });
}

export function registerViewsCommands(deps: ViewsDeps): vscode.Disposable[] {
  const { context, provider, filesGroups, settingsProvider } = deps;

  return [
    vscode.commands.registerCommand('agenticBookmarks.toggleShowFilesInAllBookmarks', async () => {
      await flipViewToggle(context, 'showFilesInAllBookmarks');
      settingsProvider.refresh();
      provider.refresh();
    }),

    vscode.commands.registerCommand('agenticBookmarks.toggleShowBookmarksInFilesAndGroups', async () => {
      await flipViewToggle(context, 'showBookmarksInFilesAndGroups');
      settingsProvider.refresh();
      filesGroups.refresh();
    }),
  ];
}
