import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { svg } from '@agentic-bookmarks/core';

export type OverlayId = 'exclamation' | 'question';

// In-memory cache of parsed overlay SVGs
const overlayCache = new Map<OverlayId, svg.SvgDocument>();

/**
 * Get the absolute path to an overlay SVG file.
 */
export function getOverlayPath(overlayId: OverlayId): string {
  const ext = vscode.extensions.getExtension('supermegalab.agentic-bookmarks');
  const base = ext?.extensionPath || path.join(__dirname, '..');
  return path.join(base, 'media', 'overlays', `${overlayId}.svg`);
}

/**
 * Load and parse an overlay SVG, caching the result.
 */
export async function getOverlaySvg(overlayId: OverlayId): Promise<svg.SvgDocument> {
  const cached = overlayCache.get(overlayId);
  if (cached) return cached;

  const filePath = getOverlayPath(overlayId);
  const content = await fs.readFile(filePath, 'utf8');
  const doc = svg.parseSvg(content);
  overlayCache.set(overlayId, doc);
  return doc;
}
