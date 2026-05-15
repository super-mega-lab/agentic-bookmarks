import type * as vscode from 'vscode';
import type { Paths } from '@agentic-bookmarks/core';
import type { Logger } from './logger';
import type { BookmarksProvider } from './treeProvider';
import type { FilesGroupsProvider } from './filesGroupsProvider';
import type { SettingsProvider } from './settingsProvider';
import type { BookmarkCodeLensProvider } from './bookmarkCodeLensProvider';
import type { AnchorRepairQueue } from './repairQueue';

// ---------------------------------------------------------------------------
// Shared value types used by multiple modules
// ---------------------------------------------------------------------------

export type UIState = {
  hidden: string[];
  focus: string | null;
  filterEnabled?: boolean;
  hiddenFiles?: string[];
};

export type SearchFilter = {
  id: string;
  text: string;
  regex: boolean;
  op: 'AND' | 'OR';
};

export type DefaultTarget = {
  paths: { dir: string; data: string; bak: string; lock: string; pulse: string };
  groupId: string;
};

export type CatalogResult = {
  data: any;
  baseDir: string;
};

// ---------------------------------------------------------------------------
// ExtCtx — the shared context bag passed to every extracted module
// ---------------------------------------------------------------------------

export interface ExtCtx {
  // Layer 1: VS Code framework — needed by everything
  vsc: {
    context: vscode.ExtensionContext;
    log: Logger;
    outputChannel: vscode.OutputChannel;
  };

  // Layer 2: Workspace — needed by anything touching bookmarks data
  workspace: {
    root: string;
    paths: Paths;
    getConfiguredDataRoot: (folder: vscode.WorkspaceFolder) => string;
  };

  // Layer 3: UI — needed by anything that refreshes the UI
  ui: {
    provider: BookmarksProvider;
    filesGroups: FilesGroupsProvider;
    settingsProvider: SettingsProvider;
    codeLensProvider: BookmarkCodeLensProvider | null;
    treeView: vscode.TreeView<any>;
    filesGroupsView: vscode.TreeView<any>;
    settingsView: vscode.TreeView<any>;
    getUIState: () => UIState & { searches?: SearchFilter[] };
    setUIState: (next: UIState & { searches?: SearchFilter[] }) => Promise<void>;
    updateFilterContext: () => Promise<void>;
    isNoteVisible: (id: string) => boolean;
    setNoteVisibility: (id: string, visible: boolean) => Promise<void>;
    refreshAll: () => void;
    refreshTrees: () => void;
  };

  // Layer 4: Operations — shared behaviors used across subsystems
  ops: {
    updateDecorations: () => Promise<void>;
    refreshDecorationAppearance: () => Promise<void>;
    debouncedCacheSync: () => void;
    revalidateOpenDocuments: () => Promise<void>;
    getDefaultTargetForWorkspace: (root: string, folder: vscode.WorkspaceFolder) => Promise<DefaultTarget>;
    getLineCacheLength: () => number;
    getLineCacheFor: (editor: vscode.TextEditor, line: number) => string | undefined;
    restartWatchers: () => Promise<void>;
    onFileOpened: (document: vscode.TextDocument) => Promise<void>;
    getCatalog: () => Promise<CatalogResult | null>;
    repairQueue: AnchorRepairQueue | null;
  };
}

// ---------------------------------------------------------------------------
// Factory — assembles pre-built layers into a single ExtCtx
// ---------------------------------------------------------------------------

export function createExtCtx(parts: {
  vsc: ExtCtx['vsc'];
  workspace: ExtCtx['workspace'];
  ui: ExtCtx['ui'];
  ops: ExtCtx['ops'];
}): ExtCtx {
  return { ...parts };
}
