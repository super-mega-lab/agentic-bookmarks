import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { getIconCacheDir, svg } from '@agentic-bookmarks/core';
import { getOverlaySvg, type OverlayId } from './overlays';
import { getBuiltinCatalog } from './catalog-cache';

export interface EffectiveCatalog { data: any; baseDir: string }
export type OverlayRenderMode = 'composite' | 'overlayOnly' | 'base';
export type OverlayLogger = (message: string) => void;
export interface OverlayRenderOptions {
  logger?: OverlayLogger;
  context?: string;
}
export interface OverlayRenderResult {
  iconPath: string;
  mode: OverlayRenderMode;
  reason?: string;
}

/**
 * Load the built-in style catalog. Replaces the prior registry-driven loader
 * (`loadCatalogFromRegistry`) which read `settings.appearance.styleCatalogPath`.
 * SML-1320 locked the catalog source down to the extension's bundled media.
 *
 * NOTE for pro-mode: this function is intentionally retained as the single
 * "load whichever catalog applies" entry point so future user-catalog support
 * has one place to add the alternative branch.
 */
export async function loadBuiltinCatalog(context: vscode.ExtensionContext): Promise<EffectiveCatalog | null> {
  return getBuiltinCatalog(context);
}

export interface AppearanceOverrides {
  uniformStyle?: string;
  uniformColor?: string;
  showDifferentStyles?: boolean;
  showDifferentColors?: boolean;
}

export async function resolveGroupIconPath(group: any, workspaceRoot: string, catalog: EffectiveCatalog | null, defaultIconPath: string, bookmarksDataRoot?: string, appearance?: AppearanceOverrides): Promise<string> {
  if (!group) return defaultIconPath;
  try {
    const showStyles = appearance?.showDifferentStyles !== false; // default true
    const showColors = appearance?.showDifferentColors !== false; // default true

    // Custom SVG takes precedence only when per-group styles are enabled
    if (showStyles && group?.icon?.custom_svg) {
      const pth = group.icon.custom_svg as string;
      return path.isAbsolute(pth) ? pth : path.join(workspaceRoot, pth);
    }
    if (catalog) {
      // Resolve style: use group's own when showDifferentStyles, otherwise uniform fallback
      let styleId: string | undefined;
      if (showStyles && group?.icon?.svg_style) {
        styleId = group.icon.svg_style;
      } else {
        styleId = appearance?.uniformStyle || group?.icon?.svg_style;
      }
      const style = (styleId && catalog.data.styles.find((s: any) => s.id === styleId)) || catalog.data.styles?.[0];
      if (style) {
        // Resolve color: use group's own when showDifferentColors, otherwise uniform fallback
        let token: string | undefined;
        if (showColors && group?.icon?.svg_color) {
          token = group.icon.svg_color;
        } else {
          token = appearance?.uniformColor || group?.icon?.svg_color;
        }
        // Fall back to style's default color if no token resolved
        if (!token && style.defaultColor) token = style.defaultColor;
        // Prefer existing variant when token is a variant key
        const variant = token && style.svg?.variants && style.svg.variants[token];
        if (variant) return path.isAbsolute(variant) ? variant : path.join(catalog.baseDir, variant);
        // Otherwise, tint the white asset when available and a color can be resolved
        const white = style.svg?.white;
        const hex = tokenToHex(catalog, token);
        if (white && hex) {
          const whitePath = path.isAbsolute(white) ? white : path.join(catalog.baseDir, white);
          const tinted = await ensureTintedSvg(whitePath, hex, workspaceRoot, styleId || style?.id || 'style', bookmarksDataRoot);
          if (tinted) return tinted;
        }
        // Fallback to white if nothing else
        if (white) return path.isAbsolute(white) ? white : path.join(catalog.baseDir, white);
      }
    }
  } catch {}
  return defaultIconPath;
}

/**
 * Resolve the effective styleId and color token for a group, applying uniform overrides.
 * Used by overlay composition callers that need these values separately from the icon path.
 */
export function resolveEffectiveStyleAndColor(
  group: any,
  catalog: EffectiveCatalog | null,
  appearance?: AppearanceOverrides
): { styleId: string; colorToken: string | undefined; colorHex: string | undefined } {
  const showStyles = appearance?.showDifferentStyles !== false;
  const showColors = appearance?.showDifferentColors !== false;

  let styleId: string;
  if (showStyles && group?.icon?.svg_style) {
    styleId = group.icon.svg_style;
  } else {
    styleId = appearance?.uniformStyle || group?.icon?.svg_style || 'default';
  }

  let colorToken: string | undefined;
  if (showColors && group?.icon?.svg_color) {
    colorToken = group.icon.svg_color;
  } else {
    colorToken = appearance?.uniformColor || group?.icon?.svg_color;
  }

  // Fall back to style's default color if no token resolved
  if (!colorToken && catalog) {
    const style = (styleId !== 'default' && catalog.data.styles.find((s: any) => s.id === styleId)) || catalog.data.styles?.[0];
    if (style?.defaultColor) colorToken = style.defaultColor;
  }

  const colorHex = catalog ? tokenToHex(catalog, colorToken) : (colorToken?.startsWith('#') ? colorToken : undefined);

  return { styleId, colorToken, colorHex };
}

const CSS_NAMED_COLORS: Record<string, string> = {
  cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff',
  lime: '#00ff00', teal: '#008080', maroon: '#800000', navy: '#000080',
  olive: '#808000', silver: '#c0c0c0', gray: '#808080', grey: '#808080',
  black: '#000000', white: '#ffffff', coral: '#ff7f50', salmon: '#fa8072',
  tomato: '#ff6347', gold: '#ffd700', crimson: '#dc143c', indigo: '#4b0082',
  violet: '#ee82ee', pink: '#ffc0cb', turquoise: '#40e0d0', tan: '#d2b48c',
  sienna: '#a0522d', orchid: '#da70d6', plum: '#dda0dd', khaki: '#f0e68c',
  lavender: '#e6e6fa', beige: '#f5f5dc', ivory: '#fffff0', wheat: '#f5deb3',
  peru: '#cd853f', chocolate: '#d2691e', firebrick: '#b22222', hotpink: '#ff69b4',
  deeppink: '#ff1493', skyblue: '#87ceeb', steelblue: '#4682b4', slategray: '#708090',
};

export function tokenToHex(catalog: EffectiveCatalog, token?: string): string | undefined {
  if (!token) return undefined;
  if (token.startsWith('#')) return token;
  const entry = (catalog.data.palette || []).find((c: any) => c.id === token);
  if (entry?.hex) return entry.hex;
  return CSS_NAMED_COLORS[token.toLowerCase()];
}

async function ensureTintedSvg(whitePath: string, colorHex: string, workspaceRoot: string, styleId: string, bookmarksDataRoot?: string): Promise<string | undefined> {
  try {
    const safe = colorHex.replace(/[^a-fA-F0-9#]/g, '').replace('#', '').toLowerCase();
    const dir = getIconCacheDir(workspaceRoot, bookmarksDataRoot);
    await fs.mkdir(dir, { recursive: true });
    const out = path.join(dir, `tint-${styleId}-${safe}.svg`);
    try { await fs.access(out); return out; } catch {}

    const src = await fs.readFile(whitePath, 'utf8');
    const doc = svg.parseSvg(src);
    const tinted = svg.tintSvg(doc, colorHex);
    await fs.writeFile(out, svg.serializeSvg(tinted), 'utf8');
    return out;
  } catch {
    return undefined;
  }
}

function overlayLog(options: OverlayRenderOptions | undefined, message: string): void {
  if (!options?.logger) return;
  const context = options.context ? ` ${options.context}` : '';
  options.logger(`[overlay]${context} ${message}`);
}

function sanitizeStyleId(styleId: string): string {
  return styleId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function validateCachedSvg(filePath: string): Promise<{ valid: boolean; errors: string[] }> {
  try {
    const cached = await fs.readFile(filePath, 'utf8');
    return svg.validateSvgOutput(cached);
  } catch (err) {
    return { valid: false, errors: [`read_error:${err instanceof Error ? err.message : String(err)}`] };
  }
}

async function ensureOverlayOnlySvg(
  overlayId: OverlayId,
  styleId: string,
  workspaceRoot: string,
  bookmarksDataRoot?: string,
  options?: OverlayRenderOptions
): Promise<string> {
  const styleSafe = sanitizeStyleId(styleId || 'style');
  const dir = getIconCacheDir(workspaceRoot, bookmarksDataRoot);
  await fs.mkdir(dir, { recursive: true });
  const outFile = path.join(dir, `overlay-${styleSafe}-${overlayId}.svg`);

  try {
    const validation = await validateCachedSvg(outFile);
    if (validation.valid) {
      overlayLog(options, `overlay-only cache hit: ${outFile}`);
      return outFile;
    }
    overlayLog(options, `overlay-only cache invalid, regenerating (${validation.errors.join(',')}): ${outFile}`);
  } catch {
    // no cached overlay-only artifact
  }

  const overlayDoc = await getOverlaySvg(overlayId);
  const sanitizedOverlayDoc = svg.sanitizeOverlaySvg(overlayDoc);
  const output = svg.serializeSvg(sanitizedOverlayDoc);
  const validation = svg.validateSvgOutput(output);
  if (!validation.valid) {
    throw new Error(`overlay-only-invalid:${validation.errors.join(',')}`);
  }

  await fs.writeFile(outFile, output, 'utf8');
  overlayLog(options, `overlay-only generated: ${outFile}`);
  return outFile;
}

/**
 * Ensure a composited icon exists with base + overlay.
 * Returns the cached file path.
 */
export async function ensureOverlaySvg(
  basePath: string,
  colorHex: string | undefined,
  overlayId: OverlayId,
  styleId: string,
  workspaceRoot: string,
  bookmarksDataRoot?: string,
  options?: OverlayRenderOptions
): Promise<string> {
  const colorSafe = colorHex
    ? colorHex.replace(/[^a-fA-F0-9#]/g, '').replace('#', '').toLowerCase()
    : 'nocolor';

  const styleSafe = sanitizeStyleId(styleId || 'style');
  const dir = getIconCacheDir(workspaceRoot, bookmarksDataRoot);
  await fs.mkdir(dir, { recursive: true });

  const outFile = path.join(dir, `tint-${styleSafe}-${colorSafe}-${overlayId}.svg`);

  // Return cached file if it exists
  try {
    const validation = await validateCachedSvg(outFile);
    if (validation.valid) {
      overlayLog(options, `composite cache hit: ${outFile}`);
      return outFile;
    }
    overlayLog(options, `composite cache invalid, regenerating (${validation.errors.join(',')}): ${outFile}`);
  } catch {
    // File doesn't exist, need to generate
  }

  // Load and parse base SVG
  const baseSrc = await fs.readFile(basePath, 'utf8');
  let baseDoc = svg.parseSvg(baseSrc);

  // Tint if color specified
  if (colorHex) {
    baseDoc = svg.tintSvg(baseDoc, colorHex);
  }

  // Load overlay and compose
  const overlayDoc = svg.sanitizeOverlaySvg(await getOverlaySvg(overlayId));
  const composedDoc = svg.composeSvg(baseDoc, overlayDoc);

  // Write to cache
  const output = svg.serializeSvg(composedDoc);
  const validation = svg.validateSvgOutput(output);
  if (!validation.valid) {
    throw new Error(`composite-invalid:${validation.errors.join(',')}`);
  }
  await fs.writeFile(outFile, output, 'utf8');
  overlayLog(options, `composite generated: ${outFile}`);

  return outFile;
}

/**
 * Build an overlay icon with resilient fallbacks:
 * composite -> overlay-only -> base icon.
 */
export async function ensureOverlayIconWithFallback(
  basePath: string,
  colorHex: string | undefined,
  overlayId: OverlayId,
  styleId: string,
  workspaceRoot: string,
  bookmarksDataRoot?: string,
  options?: OverlayRenderOptions
): Promise<OverlayRenderResult> {
  try {
    const composite = await ensureOverlaySvg(
      basePath,
      colorHex,
      overlayId,
      styleId,
      workspaceRoot,
      bookmarksDataRoot,
      options
    );
    return { iconPath: composite, mode: 'composite' };
  } catch (err) {
    overlayLog(options, `composite failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const overlayOnly = await ensureOverlayOnlySvg(
      overlayId,
      styleId,
      workspaceRoot,
      bookmarksDataRoot,
      options
    );
    return { iconPath: overlayOnly, mode: 'overlayOnly', reason: 'composite_failed' };
  } catch (err) {
    overlayLog(options, `overlay-only failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  overlayLog(options, `falling back to base icon: ${basePath}`);
  return { iconPath: basePath, mode: 'base', reason: 'all_overlay_paths_failed' };
}
