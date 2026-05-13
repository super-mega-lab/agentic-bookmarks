import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import {
  readRegistry,
  readFileV2 as readFileV2Paths,
  pathsForDataFile,
  getBookmarksDataRoot,
  workspaceRelativeToUri,
  dispatchByAnchorType,
  type BookmarksFileV2,
} from '@agentic-bookmarks/core';
import {
  resolveGroupIconPath,
  resolveEffectiveStyleAndColor,
  ensureOverlayIconWithFallback,
} from './appearance';
import { getResolvedLine, getStatus } from './anchorState';
import type { Logger } from './logger';
import {
  mapOverviewRulerLane,
  type OverviewRulerLaneSetting,
} from './overview-ruler-lane';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SearchFilter = { id: string; text: string; regex: boolean; op: 'AND' | 'OR' };
type UIState = { hidden: string[]; focus: string | null; filterEnabled?: boolean; hiddenFiles?: string[]; searches?: SearchFilter[] };

export interface DecorationDeps {
  extensionContext: vscode.ExtensionContext;
  log: Logger;
  workspaceRoot: string;
  getUIState: () => UIState;
  isNoteVisible: (id: string) => boolean;
  getCatalog: () => Promise<{ data: any; baseDir: string } | null>;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let bookmarkDecoration: vscode.TextEditorDecorationType;
const decorationCache = new Map<string, vscode.TextEditorDecorationType>();
const dotDecorationCache = new Map<string, vscode.TextEditorDecorationType>();
const noteDecorationCache = new Map<string, vscode.TextEditorDecorationType>();
const overlayLogDedup = new Set<string>();

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha = 0.8): string {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Calculate how many lines the text will wrap to
 */
function calculateWrappedLineCount(text: string, maxLength: number): number {
  const limit = Math.max(4, Math.floor(maxLength));
  if (text.length <= limit) {
    return 1;
  }

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return 1;
  }

  let lineCount = 0;
  let currentLineLength = 0;

  for (const word of words) {
    const wordLength = word.length;
    if (currentLineLength === 0) {
      // Starting a new line
      currentLineLength = wordLength + 4; // +4 for "📝 " prefix
      lineCount++;
    } else if (currentLineLength + 1 + wordLength > limit) {
      // Word doesn't fit, start new line
      currentLineLength = wordLength + 4; // +4 for "📝 " prefix
      lineCount++;
    } else {
      // Word fits on current line
      currentLineLength += 1 + wordLength;
    }
  }

  return Math.max(1, lineCount);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDecorationManager(deps: DecorationDeps) {
  const { extensionContext: context, log, workspaceRoot, getUIState, isNoteVisible, getCatalog } = deps;

  // -- Decoration factory helpers (capture context + caches) ---------------

  function getDecoration(
    iconPath: string,
    colorHex: string,
    key: string,
    lane: number,
  ): vscode.TextEditorDecorationType {
    const cacheKey = `${key}|lane=${lane}`;
    let deco = decorationCache.get(cacheKey);
    if (!deco) {
      deco = vscode.window.createTextEditorDecorationType({
        gutterIconPath: vscode.Uri.file(iconPath),
        gutterIconSize: 'contain',
        overviewRulerColor: hexToRgba(colorHex, 0.8),
        overviewRulerLane: lane as vscode.OverviewRulerLane,
      });
      decorationCache.set(cacheKey, deco);
      context.subscriptions.push(deco);
    }
    return deco;
  }

  function getDotDecoration(colorHex: string): vscode.TextEditorDecorationType {
    const rgba = hexToRgba(colorHex, 0.9);
    const key = `dot|${rgba}`;
    let deco = dotDecorationCache.get(key);
    if (!deco) {
      deco = vscode.window.createTextEditorDecorationType({
        isWholeLine: false,
        before: {
          contentText: '●',
          color: rgba,
          margin: '0.1em 0.4em 0 0'
        }
      });
      dotDecorationCache.set(key, deco);
      context.subscriptions.push(deco);
    }
    return deco;
  }

  function getNoteDecoration(
    key: string,
    note: string,
    opts: { width: number; topOffset: number; startColumn: number }
  ): vscode.TextEditorDecorationType {
    let deco = noteDecorationCache.get(key);
    if (!deco) {
      const widthInCh = `${Math.max(1, opts.width)}ch`;
      const leftInCh = `${Math.max(0, opts.startColumn)}ch`;
      const topInEm = `${opts.topOffset}em`;
      deco = vscode.window.createTextEditorDecorationType({
        isWholeLine: false,
        before: {
          contentText: `📝 ${note}`,
          color: 'rgba(150, 150, 150, 0.8)',
          fontStyle: 'italic',

          // Set width to force wrapping
          width: widthInCh,

          // Let height expand as needed
          height: 'auto',

          // Add border for visual clarity
          border: '1px solid rgba(100, 100, 100, 0.3)',

          // CSS for absolute positioning with dynamic top offset
          textDecoration: `none;
            position: absolute;
            left: ${leftInCh};
            top: ${topInEm};
            display: block;
            white-space: pre-wrap;
            word-wrap: break-word;
            overflow-wrap: break-word;
            padding: 4px 8px;
            background-color: rgba(40, 40, 40, 0.95);
            box-sizing: border-box;
            border-radius: 3px;
            z-index: 10;`
        }
      });
      noteDecorationCache.set(key, deco);
      context.subscriptions.push(deco);
    }
    return deco;
  }

  const logOverlay = (message: string) => {
    if (overlayLogDedup.has(message)) return;
    overlayLogDedup.add(message);
    log.debug(message);
  };

  // -- Public API ----------------------------------------------------------

  async function refreshDecorationAppearance(): Promise<void> {
    try {
      const reg = await readRegistry(workspaceRoot);
      const appearance = reg.settings?.appearance;
      const uniform = appearance?.uniformColor;
      const color = uniform && /^#/.test(uniform) ? hexToRgba(uniform, 0.8) : 'rgba(255, 200, 0, 0.8)';

      // Try to resolve icon from style catalog if configured
      let iconPath = context.asAbsolutePath('media/styles/icons/marker-white.svg');
      try {
        const cat = await getCatalog();
        if (cat) {
          const styleId = appearance?.uniformStyle || cat.data.styles[0]?.id;
          const style = cat.data.styles.find((s: { id: string }) => s.id === styleId) || cat.data.styles[0];
          const token = appearance?.uniformColor || style?.defaultColor;
          const variant = token && style?.svg?.variants && style.svg.variants[token];
          const chosen = variant || style?.svg?.white;
          if (chosen) iconPath = path.isAbsolute(chosen) ? chosen : path.join(cat.baseDir, chosen);
        }
      } catch {
        // ignore catalog errors, fallback to default icon
      }

      const rulerLaneSetting = vscode.workspace
        .getConfiguration('agenticBookmarks')
        .get<OverviewRulerLaneSetting>('overviewRulerLane', 'center');
      const rulerLane = mapOverviewRulerLane(rulerLaneSetting) as vscode.OverviewRulerLane;

      if (bookmarkDecoration) bookmarkDecoration.dispose();
      bookmarkDecoration = vscode.window.createTextEditorDecorationType({
        gutterIconPath: iconPath,
        gutterIconSize: 'contain',
        overviewRulerColor: color,
        overviewRulerLane: rulerLane
      });
      context.subscriptions.push(bookmarkDecoration);
    } catch {
      // fallback decoration
      let rulerLane: vscode.OverviewRulerLane;
      try {
        const rulerLaneSetting = vscode.workspace
          .getConfiguration('agenticBookmarks')
          .get<OverviewRulerLaneSetting>('overviewRulerLane', 'center');
        rulerLane = mapOverviewRulerLane(rulerLaneSetting) as vscode.OverviewRulerLane;
      } catch {
        rulerLane = mapOverviewRulerLane(undefined) as vscode.OverviewRulerLane;
      }
      if (bookmarkDecoration) bookmarkDecoration.dispose();
      bookmarkDecoration = vscode.window.createTextEditorDecorationType({
        gutterIconPath: context.asAbsolutePath('media/styles/icons/marker-white.svg'),
        gutterIconSize: 'contain',
        overviewRulerColor: 'rgba(255, 200, 0, 0.8)',
        overviewRulerLane: rulerLane
      });
      context.subscriptions.push(bookmarkDecoration);
    }
  }

  async function updateDecorations(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      log.debug('No active editor, clearing context');
      try {
        const glyph = vscode.workspace.getConfiguration('editor').get('glyphMargin');
        log.debug(`editor.glyphMargin=${glyph}`);
      } catch {}
      await vscode.commands.executeCommand('setContext', 'agenticBookmarks.linesForActiveDoc', []);
      return;
    }

    const currentUri = editor.document.uri.toString();
    const currentFs = vscode.Uri.parse(currentUri).fsPath;
    // Skip non-file editors (e.g., Output, Debug Console)
    if (editor.document.uri.scheme !== 'file') {
      await vscode.commands.executeCommand('setContext', 'agenticBookmarks.linesForActiveDoc', []);
      return;
    }
    log.debug(`Updating decorations for: ${currentUri}`);

    // Determine the workspace for the active editor
    const editorWorkspace = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!editorWorkspace) {
      log.error(`[Bookmarks] No workspace folder for: ${currentFs}`);
      await vscode.commands.executeCommand('setContext', 'agenticBookmarks.linesForActiveDoc', []);
      return;
    }
    const editorWorkspaceRoot = editorWorkspace.uri.fsPath;
    log.debug(`[Bookmarks] Editor workspace: ${editorWorkspaceRoot}`);

    // Aggregate bookmarks across all enabled registered files
    const ui = getUIState();
    const allBookmarks: Array<{ file: BookmarksFileV2; bookmark: BookmarksFileV2['bookmarks'][number] }> = [];
    // Declare outside try block so they're accessible in the decoration logic below
    let regAppearance: any;
    let regGeneral: any;
    let dataRootForFiles: string | undefined;
    try {
      const reg = await readRegistry(editorWorkspaceRoot);
      dataRootForFiles = getBookmarksDataRoot(reg);
      const enabledFiles = reg.files.filter(f => f.enabled !== false);
      // Extract settings from this single registry read (eliminates duplicate read later)
      regAppearance = reg.settings?.appearance;
      regGeneral = reg.settings?.general;
      const files: BookmarksFileV2[] = [];

      // Diagnostic logging for visual rendering issues
      log.debug(`[Bookmarks] updateDecorations: loading ${enabledFiles.length} enabled file(s)`);
      log.debug(`[Bookmarks] Active editor fsPath: ${currentFs}`);

      for (const rf of enabledFiles) {
        try {
          // Use pathsForDataFile to properly resolve relative paths to absolute
          const filePaths = pathsForDataFile(rf.path, editorWorkspaceRoot, dataRootForFiles);
          log.debug(`[Bookmarks] Reading file: ${rf.path} -> ${filePaths.data}`);
          const f = await readFileV2Paths(filePaths);
          log.debug(`[Bookmarks] Loaded ${f.bookmarks.length} bookmark(s) from ${rf.path}`);
          files.push(f);
        } catch (err) {
          log.error(`[Bookmarks] Failed to read ${rf.path}: ${err}`);
        }
      }
      const baseFs = currentFs;
      let totalBookmarks = 0;
      for (const f of files) {
        for (const b of f.bookmarks) {
          totalBookmarks++;
          const bBase = b.target.uri.split('#')[0];
          let bFs = '';

          // Handle both absolute file:// URIs and workspace-relative paths
          if (bBase.startsWith('file://')) {
            // Absolute URI - parse to get fsPath
            try { bFs = vscode.Uri.parse(bBase).fsPath; } catch { bFs = bBase; }
          } else {
            // Workspace-relative path - resolve to absolute fsPath
            try {
              const absoluteUri = workspaceRelativeToUri(bBase, editorWorkspaceRoot);
              bFs = vscode.Uri.parse(absoluteUri).fsPath;
            } catch { bFs = bBase; }
          }

          const isMatch = bFs === baseFs;
          log.trace(`[Bookmarks] URI check: "${bBase}" -> fsPath "${bFs}" ${isMatch ? 'MATCH' : 'no match'}`);

          if (!isMatch) continue;
          const gid = (b as any).groupId as string;
          if (ui.focus) {
            if (gid !== ui.focus) continue;
          } else if (ui.hidden.includes(gid)) {
            continue;
          }
          allBookmarks.push({ file: f, bookmark: b });
        }
      }
      log.debug(`[Bookmarks] Total bookmarks: ${totalBookmarks}, matched for this file: ${allBookmarks.length}`);
    } catch (e) {
      log.error(`[Bookmarks] Decoration aggregation failed: ${e}`);
    }

    log.debug(`Found ${allBookmarks.length} bookmarks for this file`);

    // Extract line numbers and create grouped ranges per icon/color
    const lines: number[] = [];
    const grouped = new Map<string, vscode.Range[]>(); // key: icon|color

    // Use settings extracted from the first registry read (no duplicate read)
    // (regAppearance, regGeneral, dataRootForFiles declared above the try block)
    const appearance: any = regAppearance;
    const general: any = regGeneral;
    const dataRoot: string | undefined = dataRootForFiles;
    let catalog: { data: any; baseDir: string } | null = null;
    try {
      catalog = await getCatalog();
    } catch (err) {
      console.error(`[updateDecorations] Error loading catalog for workspace ${editorWorkspaceRoot}:`, err);
      log.error(`[updateDecorations] ERROR: Failed to load catalog: ${err}`);
    }

    // Memoize resolution per group within this refresh
    const iconMemo = new Map<string, { icon: string; color: string }>();
    async function resolveIconAndColor(groupId: string, parentFile: BookmarksFileV2): Promise<{ icon: string; color: string }> {
      const memo = iconMemo.get(groupId);
      if (memo) return memo;
      const defaultIcon = context.asAbsolutePath('media/styles/icons/marker-white.svg');
      // Defaults
      let color = '#ffc800';
      if (appearance?.uniformColor && /^#/.test(appearance.uniformColor)) color = appearance.uniformColor;

      const group = parentFile.groups.find(g => (g as any).id === groupId) as any;
      const showStyles = appearance?.showDifferentStyles !== false; // default true (styles enabled)
      const showColors = appearance?.showDifferentColors !== false; // default true (colors enabled)

      // Custom color overrides
      if (showColors && group?.icon?.custom_color && /^#/.test(group.icon.custom_color)) {
        color = group.icon.custom_color;
      } else if (showColors && group?.icon?.svg_color && /^#|[a-zA-Z]/.test(group.icon.svg_color)) {
        // svg_color token may not be hex; leave as is for variant selection, but keep color for overview ruler from uniform or default
        if (appearance?.uniformColor && /^#/.test(appearance.uniformColor)) color = appearance.uniformColor;
      }

      // Custom svg takes precedence when styles are on
      if (showStyles && group?.icon?.custom_svg) {
        const pth = group.icon.custom_svg;
        const resolved = path.isAbsolute(pth) ? pth : path.join(editorWorkspaceRoot, pth);
        return { icon: resolved, color };
      }

      // Catalog-based resolution
      if (!catalog) {
        const res = { icon: defaultIcon, color };
        try { await fsp.stat(defaultIcon); log.debug(`Gutter icon (default) OK: ${defaultIcon}`); }
        catch { log.debug(`Gutter icon (default) MISSING: ${defaultIcon}`); }
        iconMemo.set(groupId, res);
        return res;
      }

      // Use shared resolver for icon path (handles uniform style/color overrides)
      const iconPath = await resolveGroupIconPath(group as any, editorWorkspaceRoot, catalog as any, defaultIcon, dataRoot, appearance);

      // Resolve effective color for overview ruler
      const eff = resolveEffectiveStyleAndColor(group, catalog as any, appearance);
      if (eff.colorHex) color = eff.colorHex;

      const res = { icon: iconPath, color };
      log.debug(`Gutter icon (resolved) for group ${groupId}: ${iconPath}`);
      iconMemo.set(groupId, res);
      return res;
    }

    const rulerLaneSetting = vscode.workspace
      .getConfiguration('agenticBookmarks')
      .get<OverviewRulerLaneSetting>('overviewRulerLane', 'center');
    const rulerLane = mapOverviewRulerLane(rulerLaneSetting);

    const usedKeys = new Set<string>();
    for (const { file: parentFile, bookmark: b } of allBookmarks) {
      const gid = (b as any).groupId as string;
      const { icon, color } = await resolveIconAndColor(gid, parentFile);

      // Check if bookmark anchor is broken or warning
      const status = getStatus(currentUri, b.id);
      const isBroken = status === 'broken';
      const isWarning = status === 'warning';
      const showWarnings = vscode.workspace.getConfiguration('agenticBookmarks').get('showWarningIndicators', true);

      // Use overlay icon for broken/warning bookmarks
      let finalIcon = icon;
      if (isBroken) {
        // Resolve effective style/color respecting uniform overrides
        const group = parentFile.groups.find(g => (g as any).id === gid) as any;
        const eff = resolveEffectiveStyleAndColor(group, catalog as any, appearance);
        const overlayCtx = `bookmark=${b.id} group=${gid} status=broken`;
        const overlayResult = await ensureOverlayIconWithFallback(
          icon,
          eff.colorHex,
          'exclamation',
          eff.styleId,
          editorWorkspaceRoot,
          dataRoot,
          { logger: logOverlay, context: overlayCtx }
        );
        finalIcon = overlayResult.iconPath;
        if (overlayResult.mode !== 'composite') {
          logOverlay(`[overlay] ${overlayCtx} fallback mode=${overlayResult.mode} reason=${overlayResult.reason ?? 'n/a'}`);
        }
      } else if (isWarning && showWarnings) {
        // Resolve effective style/color respecting uniform overrides
        const group = parentFile.groups.find(g => (g as any).id === gid) as any;
        const eff = resolveEffectiveStyleAndColor(group, catalog as any, appearance);
        const overlayCtx = `bookmark=${b.id} group=${gid} status=warning`;
        const overlayResult = await ensureOverlayIconWithFallback(
          icon,
          eff.colorHex,
          'question',
          eff.styleId,
          editorWorkspaceRoot,
          dataRoot,
          { logger: logOverlay, context: overlayCtx }
        );
        finalIcon = overlayResult.iconPath;
        if (overlayResult.mode !== 'composite') {
          logOverlay(`[overlay] ${overlayCtx} fallback mode=${overlayResult.mode} reason=${overlayResult.reason ?? 'n/a'}`);
        }
      }

      const key = isBroken ? `${finalIcon}|${color}|broken` : isWarning && showWarnings ? `${finalIcon}|${color}|warning` : `${icon}|${color}`;
      if (!grouped.has(key)) grouped.set(key, []);

      // Try to get line from anchorState first
      let line = getResolvedLine(currentUri, b.id);

      // Fallback to direct anchor access if state not initialized
      if (line === undefined) {
        line = dispatchByAnchorType(b.anchor, {
          point: (a) => a.line,
          range: (a) => a.start.line,
          smart: (a) => a.lastUpdatedLine,
          tag: (a) => a.lastUpdatedLine,
        });
      }

      // Skip decoration if we have no valid line
      if (line === undefined || line < 0) {
        continue;
      }

      lines.push(line + 1);
      grouped.get(key)!.push(new vscode.Range(line, 0, line, 0));
      usedKeys.add(`${key}|lane=${rulerLane}`);
    }

    // Apply grouped decorations (dot first as fallback, then gutter to win ordering)
    const applied: Array<{ icon: string; color: string; ranges: vscode.Range[] }> = [];
    const dotsEnabled = general?.showInlineDots === true;
    for (const [key, ranges] of grouped) {
      const [icon, color] = key.split('|');
      if (dotsEnabled) {
        const dot = getDotDecoration(color);
        editor.setDecorations(dot, ranges);
      }
      const deco = getDecoration(icon, color, key, rulerLane);
      editor.setDecorations(deco, ranges);
      applied.push({ icon, color, ranges });
    }
    // If dots are disabled, clear any previously applied dot decorations
    if (!dotsEnabled) {
      try {
        for (const [, deco] of dotDecorationCache) {
          editor.setDecorations(deco, []);
        }
      } catch (err) {
        console.error(`[updateDecorations] Error clearing dot decorations:`, err);
        log.error(`[updateDecorations] ERROR: Failed to clear dot decorations: ${err}`);
      }
    }
    // Clear any unused decorations
    for (const [key, deco] of decorationCache) {
      if (!usedKeys.has(key)) editor.setDecorations(deco, []);
    }

    // Apply note decorations if enabled
    const notesEnabled = general?.showNotesAndLabels !== false;
    const usedDecoKeys = new Set<string>();
    if (notesEnabled) {
      const config = vscode.workspace.getConfiguration('agenticBookmarks');
      let maxLength = config.get<number>('noteDecorationMaxLength') || 100;
      let noteStartColumn = config.get<number>('noteStartColumn') ?? 0;
      if (!Number.isFinite(noteStartColumn) || noteStartColumn < 0) {
        noteStartColumn = 0;
      } else {
        noteStartColumn = Math.floor(noteStartColumn);
      }
      if (noteStartColumn > maxLength) {
        maxLength = noteStartColumn + 20;
      }
      const rawPlacementValue = config.get<string>('notePlacement') || 'above';
      const placementSetting = typeof rawPlacementValue === 'string' ? rawPlacementValue.toLowerCase() : 'above';
      const placement: 'above' | 'below' | 'centered' =
        placementSetting === 'below' || placementSetting === 'centered'
          ? (placementSetting as 'below' | 'centered')
          : 'above';
      const availableWidth = Math.max(20, Math.floor(maxLength - noteStartColumn));
      const decoMap = new Map<string, { deco: vscode.TextEditorDecorationType; ranges: vscode.Range[] }>();
      for (const { bookmark: b } of allBookmarks) {
        const noteText = b.note ?? '';
        if (noteText.trim() === '') continue;
        if (!isNoteVisible(b.id)) continue;
        const line = b.anchor.kind === 'point' ? b.anchor.line
          : b.anchor.kind === 'range' ? b.anchor.start.line
          : b.anchor.lastUpdatedLine;
        const range = new vscode.Range(line, 0, line, 0);
        const lineCount = calculateWrappedLineCount(noteText, availableWidth);
        const magnitude = lineCount * 1.3 + 0.5 + 2.0;
        let topOffset: number;
        if (placement === 'below') topOffset = magnitude;
        else if (placement === 'centered') topOffset = -(magnitude / 2);
        else topOffset = -magnitude;
        if ((placement === 'above' || placement === 'centered') && line < 3) {
          topOffset = 0;
        }
        const roundedTopOffset = Math.round(topOffset * 1000) / 1000;
        const decoKey = JSON.stringify({
          note: noteText,
          lineCount,
          placement,
          noteStartColumn,
          width: availableWidth,
          topOffset: roundedTopOffset,
        });
        let entry = decoMap.get(decoKey);
        if (!entry) {
          const deco = getNoteDecoration(decoKey, noteText, {
            width: availableWidth,
            topOffset: roundedTopOffset,
            startColumn: noteStartColumn,
          });
          entry = { deco, ranges: [] };
          decoMap.set(decoKey, entry);
        }
        entry.ranges.push(range);
      }
      for (const [key, { deco, ranges }] of decoMap) {
        usedDecoKeys.add(key);
        editor.setDecorations(deco, ranges);
      }
    }
    // Clear note decorations if disabled or not used
    for (const [key, deco] of noteDecorationCache) {
      if (!notesEnabled || !usedDecoKeys.has(key)) {
        editor.setDecorations(deco, []);
      }
    }
    log.debug(`Applied ${lines.length} decorations across ${grouped.size} styles`);
    // Optional delayed extra refresh (user setting) to win ordering against other extensions
    const delayedExtra = !!vscode.workspace.getConfiguration('agenticBookmarks').get('delayedExtraRefresh');
    if (delayedExtra) {
      setTimeout(() => {
        try {
          for (const item of applied) {
            const key = `${item.icon}|${item.color}`;
            const deco = getDecoration(item.icon, item.color, key, rulerLane);
            editor.setDecorations(deco, item.ranges);
          }
          log.debug(`Reapplied gutter icons for ${applied.length} style group(s)`);
        } catch (err) {
          console.error(`[updateDecorations] Error reapplying gutter decorations:`, err);
          log.error(`[updateDecorations] ERROR: Failed to reapply gutter decorations: ${err}`);
        }
      }, 150);
    }

    // Update context for when clauses (1-based line numbers for menu)
    await vscode.commands.executeCommand('setContext', 'agenticBookmarks.linesForActiveDoc', lines);
    log.trace(`Set context with lines: [${lines.join(', ')}]`);
  }

  return { updateDecorations, refreshDecorationAppearance };
}
