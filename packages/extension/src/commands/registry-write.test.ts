// ABOUTME: Verifies appearance/settings toggle commands persist the registry through core's
// ABOUTME: writeRegistry (validation + .bak + cache refresh), not a raw fs.writeFile (SML-1538).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  readRegistry,
  registryPathForRoot,
} from '@agentic-bookmarks/core';

// Shared handle for registered command handlers (assigned inside the vscode factory).
const registeredCommands = new Map<string, any>();

vi.mock('vscode', () => {
  return {
    commands: {
      registerCommand: (id: string, fn: any) => {
        registeredCommands.set(id, fn);
        return { dispose() {} };
      },
    },
    window: {
      showWarningMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
    },
    workspace: {
      get workspaceFolders() {
        return [];
      },
    },
  };
});

import { registerAppearanceCommands } from './appearance';
import { registerSettingsAndFilterCommands } from './settings-and-filters';

let workspaceRoot: string;

function seedRegistry(root: string): void {
  const regPath = registryPathForRoot(root);
  fs.mkdirSync(path.dirname(regPath), { recursive: true });
  const minimal = {
    version: 1,
    files: [],
    nameIndex: {},
    settings: {
      watchersEnabled: true,
      sortByFile: true,
      sortByGroup: false,
      appearance: { showDifferentColors: true, showDifferentStyles: true },
    },
  };
  fs.writeFileSync(regPath, JSON.stringify(minimal, null, 2));
}

function buildAppearanceDeps() {
  const log = { debug() {}, info() {}, warn() {}, error() {}, trace() {} } as any;
  return {
    workspaceRoot,
    log,
    context: {} as any,
    provider: { refresh() {} } as any,
    filesGroups: { refresh() {} } as any,
    settingsProvider: { refresh() {} } as any,
    updateDecorations: async () => {},
    refreshDecorationAppearance: async () => {},
    getCatalog: async () => null,
    clearCatalogCache: () => {},
  } as any;
}

function buildSettingsDeps() {
  const log = { debug() {}, info() {}, warn() {}, error() {}, trace() {} } as any;
  return {
    workspaceRoot,
    log,
    provider: { refresh() {} } as any,
    filesGroups: { refresh() {} } as any,
    settingsProvider: { refresh() {}, workspaceRoot } as any,
    settingsView: { title: '' } as any,
    codeLensProvider: { refresh: vi.fn() } as any,
    updateDecorations: async () => {},
    getUIState: () => ({ hidden: [], focus: null }),
    setUIState: async () => {},
    updateFilterContext: async () => {},
    isNoteVisible: () => false,
    setNoteVisibility: async () => {},
  } as any;
}

function appearanceHandlers() {
  registeredCommands.clear();
  registerAppearanceCommands(buildAppearanceDeps());
  return registeredCommands;
}

function settingsHandlers() {
  registeredCommands.clear();
  registerSettingsAndFilterCommands(buildSettingsDeps());
  return registeredCommands;
}

beforeEach(() => {
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sml-1538-'));
  seedRegistry(workspaceRoot);
  vi.clearAllMocks();
});

describe('toggleShowColors — flips appearance.showDifferentColors via writeRegistry (SML-1538)', () => {
  it('flips the setting; a fresh readRegistry returns the flipped value and on-disk JSON parses', async () => {
    const before = (await readRegistry(workspaceRoot)).settings?.appearance?.showDifferentColors;
    expect(before).toBe(true);

    const handlers = appearanceHandlers();
    await handlers.get('agenticBookmarks.toggleShowColors')();

    const after = (await readRegistry(workspaceRoot)).settings?.appearance?.showDifferentColors;
    expect(after).toBe(false);

    const onDisk = JSON.parse(fs.readFileSync(registryPathForRoot(workspaceRoot), 'utf8'));
    expect(onDisk.settings.appearance.showDifferentColors).toBe(false);
  });
});

describe('toggleNotesAndLabels — registry with no settings.general (SML-1538)', () => {
  it('does not throw, validates via readRegistry, and seeds general.showInlineDots false', async () => {
    const handlers = settingsHandlers();
    await expect(
      handlers.get('agenticBookmarks.toggleNotesAndLabels')()
    ).resolves.toBeUndefined();

    // readRegistry succeeding means the persisted registry passes schema validation.
    const reg = await readRegistry(workspaceRoot);
    expect(reg.settings?.general?.showInlineDots).toBe(false);
    expect(reg.settings?.general?.showNotesAndLabels).toBeDefined();
  });
});

describe('toggleInlineDots — flips settings.general.showInlineDots via writeRegistry (SML-1538)', () => {
  it('flips the value, persists schema-valid, and a fresh readRegistry reflects it (cache-coherent)', async () => {
    // Seed has no settings.general, so the first toggle turns inline dots ON.
    const handlers = settingsHandlers();
    await handlers.get('agenticBookmarks.toggleInlineDots')();

    // A fresh read returns the flipped value — only true if writeRegistry refreshed the
    // read cache that the handler's own readRegistry warmed (a raw fs.writeFile would not).
    const afterOn = await readRegistry(workspaceRoot);
    expect(afterOn.settings?.general?.showInlineDots).toBe(true);

    // Persisted on disk; readRegistry succeeding above already proves it is schema-valid.
    const onDisk = JSON.parse(fs.readFileSync(registryPathForRoot(workspaceRoot), 'utf8'));
    expect(onDisk.settings.general.showInlineDots).toBe(true);

    // The atomic write path backed up the prior registry — a raw fs.writeFile would not.
    // (mtime-aware read cache means the value assertions above also pass on a raw write,
    // so this .bak check is the assertion that actually pins the SML-1538 fix.)
    expect(fs.existsSync(registryPathForRoot(workspaceRoot) + '.bak')).toBe(true);

    // A second toggle flips it back off.
    await handlers.get('agenticBookmarks.toggleInlineDots')();
    const afterOff = await readRegistry(workspaceRoot);
    expect(afterOff.settings?.general?.showInlineDots).toBe(false);
  });
});

describe('clearUniformColor — removes appearance.uniformColor via writeRegistry (SML-1538)', () => {
  it('removes the field and the persisted registry still validates via readRegistry', async () => {
    // Seed a uniformColor first.
    const regPath = registryPathForRoot(workspaceRoot);
    const seeded = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    seeded.settings.appearance.uniformColor = 'red';
    fs.writeFileSync(regPath, JSON.stringify(seeded, null, 2));

    const handlers = appearanceHandlers();
    await handlers.get('agenticBookmarks.clearUniformColor')();

    const reg = await readRegistry(workspaceRoot);
    expect(reg.settings?.appearance?.uniformColor).toBeUndefined();
  });
});

describe('writeRegistry backup behavior (SML-1538)', () => {
  it('creates a .bak next to the registry after two consecutive registry-writing invocations', async () => {
    const handlers = appearanceHandlers();
    await handlers.get('agenticBookmarks.toggleShowColors')();
    await handlers.get('agenticBookmarks.toggleShowColors')();

    expect(fs.existsSync(registryPathForRoot(workspaceRoot) + '.bak')).toBe(true);
  });
});
