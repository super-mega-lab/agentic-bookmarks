/**
 * MCP configuration, diagnostics, and file management commands extracted from extension.ts.
 *
 * Install commands (one per client; each prompts for scope where applicable):
 *   agenticBookmarks.setupClaude    — Claude Code CLI; quick-pick { Local, User } scope
 *   agenticBookmarks.setupCursor    — Cursor; quick-pick { Project, Global } scope
 *   agenticBookmarks.setupCodex     — Codex; quick-pick { Project, Global } scope
 *
 * VS Code does not need an install command: the extension registers a native
 * `vscode.lm.registerMcpServerDefinitionProvider('agentic_bookmarks', …)` provider
 * in extension.ts. Users who want a hand-editable .vscode/mcp.json can write
 * one themselves; the schema is documented at
 * https://code.visualstudio.com/api/extension-guides/ai/mcp.
 *
 * BOOKMARKS_DIR convention used by these writers:
 *   - Per-project scope:  ${workspaceFolder}/.bookmarks/local (client-side expansion)
 *   - Global / user scope: empty + BOOKMARKS_UPWARD_DISCOVERY=true (the bundled
 *     server walks up from cwd to find .bookmarks/, so one global config works
 *     across every project)
 *
 * Other commands:
 *   agenticBookmarks.diagnostics
 *   agenticBookmarks.showWorkspaceInfo
 *   agenticBookmarks.cleanLegacyFiles
 *   agenticBookmarks.refresh
 *   agenticBookmarks.debugGutterHere
 *   agenticBookmarks.copyFileId
 *   agenticBookmarks.copyGroupId
 *   agenticBookmarks.copyBookmarkId
 *   agenticBookmarks.copyRepairPrompt
 *   agenticBookmarks.initializeRegistry
 *   agenticBookmarks.setFileAnchorType
 *   agenticBookmarks.setFileIsLocal
 *   agenticBookmarks.newFile
 *   agenticBookmarks.fileDeregister
 *   agenticBookmarks.fileToggleEnabled
 *   agenticBookmarks.fileToggleVisibility
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import {
  readRegistry,
  registryPathForRoot,
  getBookmarksDataRoot,
  pathsForDataFile,
  addFileToRegistry,
  emptyFileV2,
  deregisterFile,
  setFileEnabled,
  initializeRegistry,
  isLocalPath,
  toWorkspaceRelativePath,
  readFileAt,
  writeFileAt,
  getLocalDir,
} from '@agentic-bookmarks/core';
import type { BookmarkNode } from '../treeProvider';
import type { GroupNode, RegFileNode, FilesGroupsProvider } from '../filesGroupsProvider';
import type { Logger } from '../logger';
import type { BookmarksProvider } from '../treeProvider';
import type { SettingsProvider } from '../settingsProvider';
import type { BookmarkCodeLensProvider } from '../bookmarkCodeLensProvider';
import { buildAgentRepairPrompt, getConfiguredDataRoot } from '../workspace-helpers';
import { buildClaudeMcpSetupCommand } from './mcp-setup-helpers';
import { recordMcpInstall, getOutdatedMcpInstalls, type McpInstallEntry } from './mcp-install-state';

type UIState = { hidden: string[]; focus: string | null; filterEnabled?: boolean; hiddenFiles?: string[] };
type SearchFilter = { id: string; text: string; regex: boolean; op: 'AND' | 'OR' };

export interface McpConfigAndDiagnosticsDeps {
  workspaceRoot: string;
  log: Logger;
  context: vscode.ExtensionContext;
  outputChannel: vscode.OutputChannel;
  paths: { data: string };
  provider: BookmarksProvider;
  filesGroups: FilesGroupsProvider;
  settingsProvider: SettingsProvider;
  codeLensProvider: BookmarkCodeLensProvider | null;
  updateDecorations: () => Promise<void>;
  revalidateOpenDocuments: () => Promise<void>;
  getUIState: () => UIState & { searches?: SearchFilter[] };
  setUIState: (next: UIState & { searches?: SearchFilter[] }) => Promise<void>;
  getCatalogCache: () => { path: string; baseDir: string } | null;
}

export function registerMcpConfigAndDiagnosticsCommands(deps: McpConfigAndDiagnosticsDeps): vscode.Disposable[] {
  const {
    workspaceRoot,
    log,
    context,
    outputChannel,
    paths,
    provider,
    filesGroups,
    settingsProvider,
    codeLensProvider,
    updateDecorations,
    revalidateOpenDocuments,
    getUIState,
    setUIState,
    getCatalogCache,
  } = deps;

  const currentVersion = ((context as any).extension?.packageJSON?.version as string) ?? '';

  async function applyClaudeSetup(scope: 'local' | 'user'): Promise<void> {
    const serverPath = context.asAbsolutePath('server-bundle/index.js');
    const cmd = buildClaudeMcpSetupCommand(scope, serverPath, getLocalDir(workspaceRoot));
    const terminal = vscode.window.createTerminal('Setup Claude MCP');
    terminal.show();
    terminal.sendText(cmd, true);
    vscode.window.showInformationMessage(
      `Running 'claude mcp add' (${scope} scope). Watch the terminal for output.`,
    );
    await recordMcpInstall(context, 'claude', scope, currentVersion);
  }

  async function applyCursorSetup(scope: 'project' | 'global'): Promise<void> {
    const fs = require('fs').promises as typeof import('node:fs/promises');
    const os = require('os') as typeof import('node:os');
    const cursorDir =
      scope === 'project'
        ? path.join(workspaceRoot, '.cursor')
        : path.join(os.homedir(), '.cursor');
    const configPath = path.join(cursorDir, 'mcp.json');

    await fs.mkdir(cursorDir, { recursive: true });

    try { await fs.access(context.asAbsolutePath('server-bundle/index.js')); }
    catch { vscode.window.showWarningMessage('Agentic Bookmarks: server bundle not found. Run "pnpm build" to generate server-bundle/index.js.'); }

    let existing: any = {};
    try {
      existing = JSON.parse(await fs.readFile(configPath, 'utf8'));
    } catch { existing = {}; }

    // Drop legacy server names if present
    if (existing?.mcpServers && typeof existing.mcpServers === 'object') {
      for (const legacyKey of ['mcp.bookmarks', 'mcp_bookmarks']) {
        if (legacyKey in existing.mcpServers) {
          delete (existing.mcpServers as any)[legacyKey];
        }
      }
    }

    const serverAbs = context.asAbsolutePath('server-bundle/index.js');
    const env: Record<string, string> =
      scope === 'project'
        ? { BOOKMARKS_DIR: '${workspaceFolder}/.bookmarks/local' }
        : { BOOKMARKS_DIR: '', BOOKMARKS_UPWARD_DISCOVERY: 'true' };

    const next = {
      ...existing,
      mcpServers: {
        ...(existing?.mcpServers ?? {}),
        'agentic_bookmarks': { type: 'stdio', command: 'node', args: [serverAbs], env },
      },
    };

    await fs.writeFile(configPath, JSON.stringify(next, null, 2));
    vscode.window.showInformationMessage(`Cursor MCP config updated at ${configPath}`);
    await recordMcpInstall(context, 'cursor', scope, currentVersion);
  }

  async function applyCodexSetup(scope: 'project' | 'global'): Promise<void> {
    const fs = require('fs').promises as typeof import('node:fs/promises');
    const os = require('os') as typeof import('node:os');
    const serverAbs = context.asAbsolutePath('server-bundle/index.js');
    const codexDir =
      scope === 'project'
        ? path.join(workspaceRoot, '.codex')
        : path.join(os.homedir(), '.codex');
    const configPath = path.join(codexDir, 'config.toml');

    await fs.mkdir(codexDir, { recursive: true });

    try { await fs.access(serverAbs); }
    catch { vscode.window.showWarningMessage('Agentic Bookmarks: server bundle not found. Run "pnpm build" to generate server-bundle/index.js.'); }

    let text = '';
    try { text = await fs.readFile(configPath, 'utf8'); } catch { text = ''; }

    const argsPath = serverAbs.replace(/\\/g, '/');
    const blockHeader = '[mcp_servers."agentic_bookmarks"]';
    const newBlock = [
      blockHeader,
      'command = "node"',
      'args = [',
      `  "${argsPath}",`,
      ']',
      'env = { BOOKMARKS_DIR = "", BOOKMARKS_UPWARD_DISCOVERY = "true" }',
      'startup_timeout_sec = 20',
      '',
    ].join('\n');

    // Strip legacy server blocks if present
    for (const legacyKey of ['mcp.bookmarks', 'mcp_bookmarks']) {
      const escapedKey = legacyKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const legacyRe = new RegExp(`^\\[mcp_servers\\."${escapedKey}"\\][\\s\\S]*?(?=^\\[|(?![\\s\\S]))`, 'm');
      text = text.replace(legacyRe, '');
    }

    const re = /^\[mcp_servers\.\"agentic_bookmarks\"\][\s\S]*?(?=^\[|(?![\s\S]))/m;
    if (re.test(text)) {
      text = text.replace(re, newBlock);
    } else {
      if (text.length && !text.endsWith('\n')) text += '\n';
      text += (text.length ? '\n' : '') + newBlock;
    }

    await fs.writeFile(configPath, text);
    vscode.window.showInformationMessage(`Codex MCP config updated at ${configPath}`);
    await recordMcpInstall(context, 'codex', scope, currentVersion);
  }

  return [
    // Debug: place a test gutter icon at the current line
    vscode.commands.registerCommand('agenticBookmarks.debugGutterHere', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }
      try {
        const iconPath = context.asAbsolutePath('media/bookmark.svg');
        const deco = vscode.window.createTextEditorDecorationType({
          gutterIconPath: vscode.Uri.file(iconPath),
          gutterIconSize: 'auto',
        });
        const line = editor.selection.active.line;
        const range = new vscode.Range(line, 0, line, 0);
        editor.setDecorations(deco, [range]);
        log.debug(`Debug gutter decoration applied at line ${line + 1} with ${iconPath}`);
        setTimeout(() => deco.dispose(), 10000);
      } catch (e) {
        vscode.window.showErrorMessage(`Debug gutter failed: ${e}`);
      }
    }),

    // Diagnostics
    vscode.commands.registerCommand('agenticBookmarks.diagnostics', async () => {
      try {
        const serverBundle = context.asAbsolutePath('server-bundle/index.js');
        let serverExists = false;
        try { await fsp.access(serverBundle); serverExists = true; } catch {}

        const reg = await readRegistry(workspaceRoot);
        const regPath = registryPathForRoot(workspaceRoot);
        let dataExists = false; let dataSize = 0;
        try { const st = await fsp.stat(paths.data); dataExists = true; dataSize = st.size; } catch {}

        const catalogCache = getCatalogCache();
        const diag = {
          workspaceRoot,
          dataFile: { path: paths.data, exists: dataExists, size: dataSize },
          registry: {
            path: regPath,
            filesCount: reg.files.length,
            files: reg.files.map(f => ({ path: f.path, enabled: !(f.enabled === false), watch: !(f.watch === false) })),
            defaultTarget: reg.defaultTarget ?? null,
            watchersEnabled: !(reg.settings?.watchersEnabled === false),
            appearance: reg.settings?.appearance ?? {}
          },
          styleCatalog: catalogCache ? { path: catalogCache.path, baseDir: catalogCache.baseDir } : null,
          mcp: { serverBundle, exists: serverExists }
        };
        log.info('--- Bookmarks Diagnostics ---');
        log.info(JSON.stringify(diag, null, 2));
        outputChannel.show(true);
      } catch (e) {
        vscode.window.showErrorMessage(`Diagnostics failed: ${e}`);
      }
    }),

    // Show workspace info
    vscode.commands.registerCommand('agenticBookmarks.showWorkspaceInfo', async () => {
      try {
        const folders = vscode.workspace.workspaceFolders || [];

        if (folders.length === 0) {
          vscode.window.showInformationMessage('No workspace folders open');
          return;
        }

        const info = await Promise.all(folders.map(async (folder) => {
          try {
            const wsRoot = folder.uri.fsPath;
            const reg = await readRegistry(wsRoot);
            const dataRoot = getBookmarksDataRoot(reg);
            const fileCount = reg.files.length;
            const groupCount = Object.keys(reg.nameIndex).length;

            return `${folder.name}:\n  Data root: ${dataRoot}\n  Files: ${fileCount}\n  Groups: ${groupCount}`;
          } catch (e) {
            return `${folder.name}:\n  Error: ${e}`;
          }
        }));

        vscode.window.showInformationMessage(
          'Bookmarks Workspaces:\n\n' + info.join('\n\n'),
          { modal: true }
        );
      } catch (e) {
        vscode.window.showErrorMessage(`Show workspace info failed: ${e}`);
      }
    }),

    // Clean legacy runtime files left over from pre-`.bookmarks/local/` versions.
    // Safety: only deletes a legacy artifact when its migrated counterpart already
    // exists at the new location, so a workspace that hasn't yet been migrated is
    // left untouched. The icon-cache directory is always safe to delete (pure
    // regenerable cache).
    vscode.commands.registerCommand('agenticBookmarks.cleanLegacyFiles', async () => {
      const folders = vscode.workspace.workspaceFolders || [];
      if (folders.length === 0) {
        vscode.window.showInformationMessage('Bookmarks: no workspace folder open.');
        return;
      }

      const pathExists = async (p: string) => {
        try { await fsp.access(p); return true; } catch { return false; }
      };

      type Plan = { folder: string; remove: string[]; skipped: string[] };
      const plans: Plan[] = [];

      for (const folder of folders) {
        const wsRoot = folder.uri.fsPath;
        const remove: string[] = [];
        const skipped: string[] = [];

        const newRegistry = path.join(wsRoot, '.bookmarks', 'local', 'bookmarks.registry.json');
        const newCache = path.join(wsRoot, '.bookmarks', 'local', '.cache');
        const newLogs = path.join(wsRoot, '.bookmarks', 'local', 'logs');
        const hasNewRegistry = await pathExists(newRegistry);
        const hasNewCache = await pathExists(newCache);
        const hasNewLogs = await pathExists(newLogs);

        const considerFile = async (p: string, gate: boolean, gateReason: string) => {
          if (!(await pathExists(p))) return;
          if (gate) remove.push(p);
          else skipped.push(`${p} — ${gateReason}`);
        };

        await considerFile(
          path.join(wsRoot, '.vscode', 'bookmarks.registry.json'),
          hasNewRegistry,
          'no migrated registry at .bookmarks/local/ (would orphan data)',
        );
        await considerFile(
          path.join(wsRoot, '.vscode', 'bookmarks.registry.json.bak'),
          hasNewRegistry,
          'paired with registry above',
        );
        // Icon cache is pure regenerable — always safe to delete
        await considerFile(
          path.join(wsRoot, '.vscode', 'bookmark-icon-cache'),
          true,
          '',
        );
        await considerFile(
          path.join(wsRoot, '.bookmarks', '.cache'),
          hasNewCache,
          'no migrated cache at .bookmarks/local/.cache (would lose locks/pulses)',
        );
        await considerFile(
          path.join(wsRoot, '.bookmarks', 'logs'),
          hasNewLogs,
          'no migrated logs at .bookmarks/local/logs',
        );
        // Always safe — SML-1320 made this directory inert; the catalog
        // now lives in the extension bundle, no per-workspace copy.
        await considerFile(
          path.join(wsRoot, '.bookmarks', 'styles'),
          true,
          '',
        );

        if (remove.length || skipped.length) {
          plans.push({ folder: wsRoot, remove, skipped });
        }
      }

      const totalRemove = plans.reduce((n, p) => n + p.remove.length, 0);
      const totalSkipped = plans.reduce((n, p) => n + p.skipped.length, 0);

      if (totalRemove === 0 && totalSkipped === 0) {
        vscode.window.showInformationMessage('Bookmarks: no legacy files found.');
        return;
      }

      const summary = plans.map(p => {
        const rels = p.remove.map(x => `  • ${path.relative(p.folder, x)}`).join('\n');
        const skips = p.skipped.length
          ? `\n  Guarded (will NOT delete):\n${p.skipped.map(s => `    - ${path.relative(p.folder, s.split(' — ')[0])}\n        reason: ${s.split(' — ')[1] || s}`).join('\n')}`
          : '';
        return `${p.folder}:${rels ? '\n' + rels : '\n  (nothing to remove)'}${skips}`;
      }).join('\n\n');

      const choice = await vscode.window.showWarningMessage(
        `Delete ${totalRemove} legacy file/dir(s)?` +
          (totalSkipped ? ` (${totalSkipped} guarded — see details below)` : '') +
          `\n\n${summary}`,
        { modal: true },
        'Delete',
      );
      if (choice !== 'Delete') {
        log.info('[cleanLegacyFiles] cancelled by user');
        return;
      }

      let removed = 0;
      const failures: string[] = [];
      for (const plan of plans) {
        for (const p of plan.remove) {
          try {
            const stat = await fsp.stat(p);
            if (stat.isDirectory()) {
              await fsp.rm(p, { recursive: true, force: true });
            } else {
              await fsp.unlink(p);
            }
            removed++;
            log.info(`[cleanLegacyFiles] removed ${p}`);
          } catch (err) {
            failures.push(`${p}: ${err}`);
            log.error(`[cleanLegacyFiles] failed to remove ${p}: ${err}`);
          }
        }
      }

      if (failures.length) {
        vscode.window.showWarningMessage(
          `Bookmarks: removed ${removed} of ${totalRemove}. ${failures.length} failure(s) — see Agentic Bookmarks output channel.`,
        );
      } else {
        vscode.window.showInformationMessage(`Bookmarks: removed ${removed} legacy file/dir(s).`);
      }
    }),

    // Refresh all views
    vscode.commands.registerCommand('agenticBookmarks.refresh', async () => {
      log.info('Refresh command triggered');
      provider.refresh();
      if (codeLensProvider) codeLensProvider.refresh();
      await updateDecorations();
      filesGroups.refresh();
      settingsProvider.refresh();
      await revalidateOpenDocuments();
    }),

    // Setup Claude Code MCP via `claude mcp add` (modern CLI syntax)
    vscode.commands.registerCommand('agenticBookmarks.setupClaude', async () => {
      const scopeChoice = await vscode.window.showQuickPick(
        [
          {
            label: 'Local (this project only)',
            description: 'Available in this workspace, your account only',
            scope: 'local' as const,
          },
          {
            label: 'User (all your projects)',
            description: 'Available in every project under your account',
            scope: 'user' as const,
          },
        ],
        { placeHolder: 'Select Claude Code MCP install scope' },
      );
      if (!scopeChoice) return;
      await applyClaudeSetup(scopeChoice.scope);
    }),

    // Setup Cursor MCP — writes mcp.json at project or global scope
    vscode.commands.registerCommand('agenticBookmarks.setupCursor', async () => {
      const scopeChoice = await vscode.window.showQuickPick(
        [
          {
            label: 'Project (.cursor/mcp.json)',
            description: 'Available in this workspace only',
            scope: 'project' as const,
          },
          {
            label: 'Global (~/.cursor/mcp.json)',
            description: 'Available in every Cursor workspace',
            scope: 'global' as const,
          },
        ],
        { placeHolder: 'Select Cursor MCP install scope' },
      );
      if (!scopeChoice) return;
      try {
        await applyCursorSetup(scopeChoice.scope);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to write Cursor MCP config: ${error}`);
      }
    }),

    // Setup Codex MCP — writes config.toml at project or global scope
    vscode.commands.registerCommand('agenticBookmarks.setupCodex', async () => {
      const scopeChoice = await vscode.window.showQuickPick(
        [
          {
            label: 'Project (.codex/config.toml)',
            description: 'Available in this workspace only',
            scope: 'project' as const,
          },
          {
            label: 'Global (~/.codex/config.toml)',
            description: 'Available in every Codex session',
            scope: 'global' as const,
          },
        ],
        { placeHolder: 'Select Codex MCP install scope' },
      );
      if (!scopeChoice) return;
      try {
        await applyCodexSetup(scopeChoice.scope);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to write Codex MCP config: ${error}`);
      }
    }),

    // Create and register a new v2 bookmarks file
    vscode.commands.registerCommand('agenticBookmarks.newFile', async () => {
      const folders = vscode.workspace.workspaceFolders;

      if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      let targetFolder: vscode.WorkspaceFolder;

      if (folders.length === 1) {
        targetFolder = folders[0];
      } else {
        const picked = await vscode.window.showWorkspaceFolderPick({
          placeHolder: 'Select workspace for new bookmark file',
        });
        if (!picked) return;
        targetFolder = picked;
      }

      const selectedWorkspaceRoot = targetFolder.uri.fsPath;
      const dataRoot = getConfiguredDataRoot(targetFolder);

      const locationChoice = await vscode.window.showQuickPick([
        {
          label: 'Shared',
          description: `Create in ${dataRoot}/shared/ (for team collaboration)`,
          dir: 'shared',
        },
        {
          label: 'Local',
          description: `Create in ${dataRoot}/local/ (personal, git-ignored)`,
          dir: 'local',
        },
        {
          label: 'Custom',
          description: 'Choose custom location',
          dir: 'custom',
        },
      ], {
        placeHolder: 'Where should the bookmark file be created?',
      });

      if (!locationChoice) return;

      let targetDir: string;

      if (locationChoice.dir === 'custom') {
        const customPath = await vscode.window.showInputBox({
          prompt: 'Enter path relative to workspace root',
          value: `${dataRoot}/shared/`,
          validateInput: (value) => {
            if (!value) return 'Path is required';
            if (path.isAbsolute(value)) return 'Path must be relative to workspace';
            return null;
          },
        });
        if (!customPath) return;
        targetDir = path.dirname(path.join(selectedWorkspaceRoot, customPath));
      } else {
        targetDir = path.join(selectedWorkspaceRoot, dataRoot, locationChoice.dir);
      }

      const filename = await vscode.window.showInputBox({
        prompt: 'Enter bookmark file name',
        value: 'bookmarks.json',
        validateInput: (value) => {
          if (!value) return 'Filename is required';
          if (!value.endsWith('.json')) return 'Filename must end with .json';
          return null;
        },
      });

      if (!filename) return;

      const fullPath = path.join(targetDir, filename);
      const relativePath = toWorkspaceRelativePath(fullPath, selectedWorkspaceRoot);

      if (!relativePath) {
        vscode.window.showErrorMessage('Invalid path');
        return;
      }

      try {
        await fsp.mkdir(targetDir, { recursive: true });
        const isLocal = isLocalPath(relativePath);
        const empty = emptyFileV2({ isLocal });
        await fsp.writeFile(fullPath, JSON.stringify(empty, null, 2), 'utf8');
        await addFileToRegistry(selectedWorkspaceRoot, fullPath);
        vscode.window.showInformationMessage(`Bookmarks file created: ${relativePath}`);
        filesGroups.refresh();
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to create bookmarks file: ${e}`);
      }
    }),

    // Deregister a file
    vscode.commands.registerCommand('agenticBookmarks.fileDeregister', async (node: RegFileNode) => {
      if (!node) return;
      const nodeWsRoot = node.workspaceRoot || workspaceRoot;
      const confirm = await vscode.window.showWarningMessage(`Deregister ${vscode.workspace.asRelativePath(node.reg.path)} from Bookmarks?`, { modal: true }, 'Deregister');
      if (confirm !== 'Deregister') return;
      try {
        await deregisterFile(nodeWsRoot, node.reg.path);
        filesGroups.refresh();
      } catch (e) {
        vscode.window.showErrorMessage(`Deregister failed: ${e}`);
      }
    }),

    // Toggle file enabled
    vscode.commands.registerCommand('agenticBookmarks.fileToggleEnabled', async (node: RegFileNode) => {
      if (!node) return;
      const nodeWsRoot = node.workspaceRoot || workspaceRoot;
      try {
        const next = !(node.reg.enabled !== false);
        await setFileEnabled(nodeWsRoot, node.reg.path, next);
        filesGroups.refresh();
        provider.refresh();
        await updateDecorations();
      } catch (e) { vscode.window.showErrorMessage(String(e)); }
    }),

    // Toggle file visibility (per-user workspace state)
    vscode.commands.registerCommand('agenticBookmarks.fileToggleVisibility', async (node: RegFileNode) => {
      if (!node) return;
      const ui = getUIState();
      const fileId = (node.reg as any).fileId as string;
      const hiddenFiles = new Set(ui.hiddenFiles || []);
      if (hiddenFiles.has(fileId)) hiddenFiles.delete(fileId); else hiddenFiles.add(fileId);
      await setUIState({ ...ui, hiddenFiles: Array.from(hiddenFiles) });
      filesGroups.refresh();
      provider.refresh();
      await updateDecorations();
    }),

    // Copy fileId
    vscode.commands.registerCommand('agenticBookmarks.copyFileId', async (node: RegFileNode) => {
      if (node && node.fileId) {
        await vscode.env.clipboard.writeText(node.fileId);
        vscode.window.showInformationMessage(`File ID copied: ${node.fileId}`);
      }
    }),

    // Copy groupId
    vscode.commands.registerCommand('agenticBookmarks.copyGroupId', async (node: GroupNode) => {
      if (node && node.groupId) {
        await vscode.env.clipboard.writeText(node.groupId);
        vscode.window.showInformationMessage(`Group ID copied: ${node.groupId}`);
      }
    }),

    // Copy bookmarkId
    vscode.commands.registerCommand('agenticBookmarks.copyBookmarkId', async (node: BookmarkNode) => {
      if (node && node.bookmark?.id) {
        await vscode.env.clipboard.writeText(node.bookmark.id);
        vscode.window.showInformationMessage(`Bookmark ID copied: ${node.bookmark.id}`);
      }
    }),

    // Copy agent repair prompt
    vscode.commands.registerCommand('agenticBookmarks.copyRepairPrompt', async (node: BookmarkNode) => {
      if (node && node.bookmark?.id) {
        const prompt = buildAgentRepairPrompt(node.bookmark.id);
        await vscode.env.clipboard.writeText(prompt);
        vscode.window.showInformationMessage('Agent repair prompt copied to clipboard');
      }
    }),

    // Initialize registry
    vscode.commands.registerCommand('agenticBookmarks.initializeRegistry', async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      let targetFolder: vscode.WorkspaceFolder;

      if (folders.length === 1) {
        targetFolder = folders[0];
      } else {
        const picked = await vscode.window.showWorkspaceFolderPick({
          placeHolder: 'Select workspace folder to initialize bookmarks registry',
        });
        if (!picked) return;
        targetFolder = picked;
      }

      const wsRoot = targetFolder.uri.fsPath;
      const dataRoot = getConfiguredDataRoot(targetFolder);

      try {
        await initializeRegistry(wsRoot, {
          bookmarksDataRoot: dataRoot,
          forceCreate: true,
        });

        const sharedDir = path.join(wsRoot, dataRoot, 'shared');
        const localDir = path.join(wsRoot, dataRoot, 'local');
        const cacheDir = path.join(wsRoot, dataRoot, '.cache');

        await fsp.mkdir(sharedDir, { recursive: true });
        await fsp.mkdir(localDir, { recursive: true });
        await fsp.mkdir(cacheDir, { recursive: true });

        // (Style catalog install removed in SML-1320 — catalog now loads
        // from extension's bundled media/styles/, no per-workspace setup.)

        vscode.window.showInformationMessage(
          `Bookmarks registry initialized in ${targetFolder.name}`
        );

        provider.refresh();
        filesGroups.refresh();
        settingsProvider.refresh();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to initialize registry: ${error}`);
      }
    }),

    // Set default anchor type for file
    vscode.commands.registerCommand('agenticBookmarks.setFileAnchorType', async (node?: RegFileNode) => {
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      let filePath: string | undefined;
      let nodeWsRoot: string;
      if (node && node.reg && node.reg.path) {
        filePath = node.reg.path;
        nodeWsRoot = node.workspaceRoot || workspaceRoot;
      } else {
        nodeWsRoot = workspaceRoot;
        const reg = await readRegistry(nodeWsRoot);
        const files = reg.files.filter((f: any) => f.enabled !== false);
        if (files.length === 0) {
          vscode.window.showWarningMessage('No bookmark files registered');
          return;
        }
        const pick = await vscode.window.showQuickPick(
          files.map((f: any) => ({ label: path.basename(f.path), description: f.path, path: f.path })),
          { placeHolder: 'Select bookmark file' }
        );
        if (!pick) return;
        filePath = pick.path;
      }

      if (!filePath) return;

      const dataRoot = getBookmarksDataRoot(await readRegistry(nodeWsRoot));
      const currentFilePaths = pathsForDataFile(filePath, nodeWsRoot, dataRoot);
      const currentFile = await readFileAt(currentFilePaths.data);
      const currentType: string | undefined = (currentFile as any).defaultAnchorType;

      const tag = ' [current]';
      const options = [
        { label: 'Smart' + (currentType === 'smart' ? tag : ''), description: 'Finds location using surrounding code context', value: 'smart' as const },
        { label: 'Tag' + (currentType === 'tag' ? tag : ''), description: 'Uses inline comment markers in source files', value: 'tag' as const },
        { label: 'Point' + (currentType === 'point' ? tag : ''), description: 'Fixed line number (may drift when code changes)', value: 'point' as const },
        { label: 'None (inherit)' + (currentType === undefined ? tag : ''), description: 'Use user settings', value: undefined },
      ];

      const pick = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select default anchor type for this file',
      });
      if (pick === undefined) return;

      const file = await readFileAt(currentFilePaths.data);

      if (pick.value === undefined) {
        delete (file as any).defaultAnchorType;
      } else {
        (file as any).defaultAnchorType = pick.value;
      }

      await writeFileAt(currentFilePaths.data, file);
      filesGroups.refresh();

      vscode.window.showInformationMessage(
        pick.value
          ? `Set default anchor type to "${pick.value}" for ${path.basename(filePath)}`
          : `Cleared default anchor type for ${path.basename(filePath)}`
      );
    }),

    // Set isLocal for file
    vscode.commands.registerCommand('agenticBookmarks.setFileIsLocal', async (node?: RegFileNode) => {
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      let filePath: string | undefined;
      let nodeWsRoot: string;
      if (node && node.reg && node.reg.path) {
        filePath = node.reg.path;
        nodeWsRoot = node.workspaceRoot || workspaceRoot;
      } else {
        nodeWsRoot = workspaceRoot;
        const reg = await readRegistry(nodeWsRoot);
        const files = reg.files.filter((f: any) => f.enabled !== false);
        if (files.length === 0) {
          vscode.window.showWarningMessage('No bookmark files registered');
          return;
        }
        const pick = await vscode.window.showQuickPick(
          files.map((f: any) => ({ label: path.basename(f.path), description: f.path, path: f.path })),
          { placeHolder: 'Select bookmark file' }
        );
        if (!pick) return;
        filePath = pick.path;
      }
      if (!filePath) return;

      const dataRoot = getBookmarksDataRoot(await readRegistry(nodeWsRoot));
      const filePaths = pathsForDataFile(filePath, nodeWsRoot, dataRoot);
      const file = await readFileAt(filePaths.data);
      const currentIsLocal = (file as any).isLocal;

      const options = [
        {
          label: 'Local',
          description: `Private bookmarks with more context${currentIsLocal === true ? ' (current)' : ''}`,
          detail: 'Uses 4-8 lines of surrounding code for smart anchors',
          value: true
        },
        {
          label: 'Shared',
          description: `Shared bookmarks with less context${currentIsLocal === false ? ' (current)' : ''}`,
          detail: 'Uses 0-4 lines of surrounding code for smart anchors',
          value: false
        },
        {
          label: 'Auto (based on path)',
          description: `Infer from file path${currentIsLocal === undefined ? ' (current)' : ''}`,
          detail: 'Files in "local" directories are local, others are shared',
          value: undefined
        },
      ];

      const pick = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select local/shared mode for this file',
      });
      if (pick === undefined) return;

      if (pick.value === undefined) {
        delete (file as any).isLocal;
      } else {
        (file as any).isLocal = pick.value;
      }

      await writeFileAt(filePaths.data, file);
      filesGroups.refresh();

      const modeLabel = pick.value === true ? 'local' : pick.value === false ? 'shared' : 'auto';
      vscode.window.showInformationMessage(
        `Set mode to "${modeLabel}" for ${path.basename(filePath)}`
      );
    }),
  ];
}
