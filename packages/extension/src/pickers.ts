import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { getIconCacheDir } from '@agentic-bookmarks/core';

// ── Named color constants ──────────────────────────────────────────────

export const NAMED_COLORS: Record<string, string> = {
  red: '#e74c3c',
  orange: '#f39c12',
  yellow: '#f1c40f',
  green: '#2ecc71',
  blue: '#3498db',
  purple: '#9b59b6',
  pink: '#e91e63',
  teal: '#1abc9c',
  cyan: '#00bcd4',
  amber: '#ffc107',
  lime: '#cddc39',
  indigo: '#3f51b5',
  black: '#000000',
  white: '#ffffff',
  gray: '#9e9e9e',
  grey: '#9e9e9e',
};

// ── Hex normalization ──────────────────────────────────────────────────

export function normalizeHex(input: string): string | null {
  const v = input.trim();
  const m3 = /^#?[0-9a-fA-F]{3}$/.exec(v);
  const m6 = /^#?[0-9a-fA-F]{6}$/.exec(v);
  if (m3) {
    const hex = v.replace('#', '').toLowerCase();
    const full = hex.split('').map(c => c + c).join('');
    return `#${full}`;
  }
  if (m6) return `#${v.replace('#', '').toLowerCase()}`;
  return null;
}

// ── Color square SVG generation ────────────────────────────────────────

export type ColorPick = { label: string; description?: string; detail?: string; token: string; hex?: string } & vscode.QuickPickItem;

export async function ensureColorSquareSvg(workspaceRoot: string, hex: string): Promise<string | null> {
  try {
    const safe = hex.replace(/[^a-fA-F0-9#]/g, '').replace('#', '').toLowerCase();
    if (!safe) return null;
    const dir = path.join(getIconCacheDir(workspaceRoot), 'colorSquares');
    await fsp.mkdir(dir, { recursive: true });
    const out = path.join(dir, `color-${safe}.svg`);
    try { await fsp.access(out); return out; } catch {}
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">\n  <rect x="1" y="1" width="14" height="14" rx="2" ry="2" fill="#${safe}" stroke="#333" stroke-width="0.5"/>\n</svg>`;
    await fsp.writeFile(out, svg, 'utf8');
    return out;
  } catch { return null; }
}

// ── Color picker QuickPick ─────────────────────────────────────────────

export async function pickColorQuick(opts: {
  context: vscode.ExtensionContext;
  workspaceRoot: string;
  catalog: { data: any; baseDir: string } | null;
  title?: string;
  resolveToHex?: boolean;
  allowClear?: boolean;
}): Promise<{ token: string; hex?: string } | null | undefined> {
  const resolveToHex = !!opts.resolveToHex;
  const cat = opts.catalog;
  const recents = opts.context.workspaceState.get<string[]>('agenticBookmarks.recentColors', []);

  const palette: Array<{ id: string; hex: string }> = Array.isArray(cat?.data?.palette) ? cat!.data.palette : [];
  const clearItem: ColorPick | null = opts.allowClear ? { label: '$(close) Clear uniform color', description: 'Remove the uniform color override', token: '__clear__' } as any : null;
  const paletteItems: ColorPick[] = [];
  for (const c of palette) {
    const btnIcon = await ensureColorSquareSvg(opts.workspaceRoot, c.hex);
    const buttons = btnIcon ? [{ iconPath: vscode.Uri.file(btnIcon), tooltip: c.hex } as vscode.QuickInputButton] : [];
    paletteItems.push({ label: `${c.id}`, description: c.hex, token: c.id, hex: c.hex, buttons } as any);
  }
  const recentItems: ColorPick[] = [];
  for (const t of recents) {
    const hex = normalizeHex(t) || NAMED_COLORS[t.toLowerCase()] || palette.find(p => p.id === t)?.hex;
    const btnIcon = hex ? await ensureColorSquareSvg(opts.workspaceRoot, hex) : null;
    const buttons = btnIcon ? [{ iconPath: vscode.Uri.file(btnIcon), tooltip: hex } as vscode.QuickInputButton] : [];
    recentItems.push({ label: `$(history) ${t}`, description: hex || undefined, token: t, hex: hex || undefined, buttons } as any);
  }
  const commonItems: ColorPick[] = [];
  for (const n of ['blue', 'red', 'yellow', 'green', 'orange', 'purple']) {
    const hex = NAMED_COLORS[n];
    const btnIcon = await ensureColorSquareSvg(opts.workspaceRoot, hex);
    const buttons = btnIcon ? [{ iconPath: vscode.Uri.file(btnIcon), tooltip: hex } as vscode.QuickInputButton] : [];
    commonItems.push({ label: `${n}`, description: hex, token: n, hex, buttons } as any);
  }

  const qp = vscode.window.createQuickPick<ColorPick>();
  qp.title = opts.title || 'Select color';
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;
  qp.items = [
    ...(clearItem ? [clearItem] : []),
    { label: 'Palette', kind: vscode.QuickPickItemKind.Separator } as any,
    ...paletteItems,
    { label: 'Recent', kind: vscode.QuickPickItemKind.Separator } as any,
    ...recentItems,
    { label: 'Common', kind: vscode.QuickPickItemKind.Separator } as any,
    ...commonItems,
  ];

  let typedItem: ColorPick | null = null;
  const updateTyped = async (value: string) => {
    const v = value.trim();
    if (!v) {
      if (typedItem) {
        qp.items = qp.items.filter(i => i !== typedItem);
        typedItem = null;
      }
      return;
    }
    // Resolve to hex by catalog id, named, or direct hex
    let hex: string | null | undefined = palette.find(p => p.id.toLowerCase() === v.toLowerCase())?.hex;
    if (!hex) hex = NAMED_COLORS[v.toLowerCase()] || normalizeHex(v);
    const btnIcon = hex ? await ensureColorSquareSvg(opts.workspaceRoot, hex) : null;
    const buttons = btnIcon ? [{ iconPath: vscode.Uri.file(btnIcon), tooltip: hex! } as vscode.QuickInputButton] : [];
    const item: ColorPick = { label: `${v}`, description: hex || 'type a color name or #hex', token: v, hex: hex || undefined, buttons } as any;
    if (typedItem) {
      qp.items = qp.items.map(i => (i === typedItem ? item : i));
    } else {
      qp.items = [item, ...qp.items];
    }
    typedItem = item;
  };

  // Returns: { token, hex } for a color pick, null for clear (allowClear), undefined for cancel
  const result = await new Promise<{ token: string; hex?: string } | null | undefined>((resolve) => {
    qp.onDidChangeValue((v) => { updateTyped(v); });
    qp.onDidTriggerItemButton((e) => {
      const sel = e.item as ColorPick | undefined;
      if (!sel) return;
      // Mirror accept behavior with this selection
      let token = sel.token;
      const pal = palette.find(p => p.id.toLowerCase() === token.toLowerCase());
      if (pal) token = pal.id;
      else if (sel.hex) token = resolveToHex ? sel.hex : token;
      const next = [token, ...recents.filter(r => r.toLowerCase() !== token.toLowerCase())].slice(0, 10);
      opts.context.workspaceState.update('agenticBookmarks.recentColors', next);
      qp.hide();
      resolve({ token, hex: sel.hex });
    });
    qp.onDidAccept(() => {
      const sel = qp.selectedItems[0] as ColorPick | undefined;
      if (!sel) { qp.hide(); resolve(undefined); return; }
      // Handle clear selection
      if (sel.token === '__clear__') { qp.hide(); resolve(null); return; }
      // Decide final token
      let token = sel.token;
      // If selection is typed and matches palette, prefer palette id
      const pal = palette.find(p => p.id.toLowerCase() === token.toLowerCase());
      if (pal) token = pal.id;
      else if (sel.hex) {
        // If not a palette id but we know hex, optionally force to hex
        token = resolveToHex ? sel.hex : token;
      }
      // Update recents (store token)
      const next = [token, ...recents.filter(r => r.toLowerCase() !== token.toLowerCase())].slice(0, 10);
      opts.context.workspaceState.update('agenticBookmarks.recentColors', next);
      qp.hide();
      resolve({ token, hex: sel.hex });
    });
    qp.onDidHide(() => resolve(undefined));
    qp.show();
  });

  return result;
}

// ── Style picker QuickPick ─────────────────────────────────────────────

export async function pickStyleQuick(opts: {
  catalog: { data: any; baseDir: string };
  placeholder?: string;
  allowClear?: boolean;
}): Promise<string | null | undefined> {
  type StylePick = vscode.QuickPickItem & { styleId: string };
  const items: StylePick[] = [];
  if (opts.allowClear) {
    items.push({ label: '$(close) Clear uniform style', description: 'Remove the uniform style override', styleId: '__clear__' } as StylePick);
  }
  for (const s of opts.catalog.data.styles) {
    const tags: string[] = Array.isArray(s.tags) ? s.tags : [];
    const label = s.displayName || s.id;
    const description = tags.length ? `(${tags.join(', ')})` : undefined;
    const detail = s.description || undefined;
    const iconRelPath: string | undefined = s.svg?.white;
    const buttons: vscode.QuickInputButton[] = [];
    if (iconRelPath) {
      const absIcon = path.join(opts.catalog.baseDir, iconRelPath);
      try { await fsp.access(absIcon); buttons.push({ iconPath: vscode.Uri.file(absIcon), tooltip: label }); } catch {}
    }
    items.push({ label, description, detail, styleId: s.id, buttons } as any);
  }

  // Returns: styleId string, null for clear, undefined for cancel
  return new Promise<string | null | undefined>((resolve) => {
    const qp = vscode.window.createQuickPick<StylePick>();
    qp.placeholder = opts.placeholder || 'Select icon style';
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    qp.items = items;
    qp.onDidAccept(() => {
      const sel = qp.selectedItems[0] as StylePick | undefined;
      qp.hide();
      if (!sel) { resolve(undefined); return; }
      if (sel.styleId === '__clear__') { resolve(null); return; }
      resolve(sel.styleId);
    });
    qp.onDidHide(() => resolve(undefined));
    qp.show();
  });
}
