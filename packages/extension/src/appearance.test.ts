// ABOUTME: Tests for resolveGroupIconPath's tinted-icon cache filename — verifies styleId is
// ABOUTME: sanitized so a malicious style cannot escape the icon cache dir (SML-1543, F-032).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { getIconCacheDir } from '@agentic-bookmarks/core';

// appearance.ts imports `vscode` only as a type (loadBuiltinCatalog); resolveGroupIconPath and
// the tint path never touch it at runtime, so an empty module mock is sufficient.
vi.mock('vscode', () => ({}));

import { resolveGroupIconPath } from './appearance';

const WHITE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><path d="M2 2 H14 V14 H2 Z" fill="#ffffff"/></svg>';

describe('resolveGroupIconPath — tinted-icon cache filename sanitization (SML-1543)', () => {
  let testDir: string;
  let catalogDir: string;
  let workspaceRoot: string;

  beforeEach(async () => {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    testDir = path.join(tmpdir(), `ab-appearance-${stamp}`);
    catalogDir = path.join(testDir, 'catalog');
    workspaceRoot = path.join(testDir, 'workspace');
    await fs.mkdir(catalogDir, { recursive: true });
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.writeFile(path.join(catalogDir, 'white.svg'), WHITE_SVG, 'utf8');
  });

  afterEach(async () => {
    try { await fs.rm(testDir, { recursive: true, force: true }); } catch {}
  });

  // A catalog whose single style exposes a `white` base asset, so resolveGroupIconPath
  // takes the tint branch (-> ensureTintedSvg).
  function catalogWithStyle(styleId: string) {
    return {
      baseDir: catalogDir,
      data: { styles: [{ id: styleId, svg: { white: 'white.svg' } }], palette: [] },
    };
  }

  function groupWith(styleId: string, colorHex: string) {
    return { icon: { svg_style: styleId, svg_color: colorHex } };
  }

  it('keeps a traversing styleId inside the icon cache dir (no path escape)', async () => {
    const malicious = '../../../../evil';
    const defaultIcon = path.join(testDir, 'default.svg');

    const resolved = await resolveGroupIconPath(
      groupWith(malicious, '#ff0000'),
      workspaceRoot,
      catalogWithStyle(malicious),
      defaultIcon,
    );

    const cacheDir = getIconCacheDir(workspaceRoot);

    // The tint branch actually ran (not the swallow-error -> default-icon fallback).
    expect(resolved).not.toBe(defaultIcon);
    // The resolved file lives directly inside the icon cache dir — the traversal is neutralized.
    expect(path.dirname(resolved)).toBe(cacheDir);
    expect(path.basename(resolved)).not.toContain('/');
    expect(path.basename(resolved)).not.toContain('..');
    // The file was actually written, inside the cache dir.
    await expect(fs.access(resolved)).resolves.toBeUndefined();
    // The unsanitized path the bug would have written (above the cache dir) must NOT exist.
    const escaped = path.join(cacheDir, `tint-${malicious}-ff0000.svg`);
    await expect(fs.access(escaped)).rejects.toThrow();
  });

  it('sanitizes a slash in styleId to underscore in the cache filename', async () => {
    const resolved = await resolveGroupIconPath(
      groupWith('foo/bar', '#00ff00'),
      workspaceRoot,
      catalogWithStyle('foo/bar'),
      path.join(testDir, 'default.svg'),
    );
    // Matches the sibling overlay behavior: sanitizeStyleId replaces '/' with '_'.
    expect(path.basename(resolved)).toBe('tint-foo_bar-00ff00.svg');
  });

  it('leaves a valid styleId unchanged in the cache filename (no cache-key regression)', async () => {
    const resolved = await resolveGroupIconPath(
      groupWith('rounded', '#0000ff'),
      workspaceRoot,
      catalogWithStyle('rounded'),
      path.join(testDir, 'default.svg'),
    );
    expect(path.basename(resolved)).toBe('tint-rounded-0000ff.svg');
  });
});
