// ABOUTME: Tests for file-group MCP handlers — covers handleFileCreate's happy
// ABOUTME: path and the collision-detection branch that prevents silent overwrite.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { handleFileCreate } from './file-group';

describe('handleFileCreate', () => {
  let testDir: string;
  let ctx: any;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `file-group-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(testDir, { recursive: true });
    ctx = { workspaceRoot: testDir };
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('creates a new v2 bookmarks file when path is free', async () => {
    const target = path.join(testDir, 'new.json');

    const result = await handleFileCreate(ctx, { path: target, title: 'Test' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(typeof parsed.fileId).toBe('string');
    expect(parsed.fileId.length).toBeGreaterThan(0);

    // File exists on disk and parses as a v2 bookmarks file
    const raw = await fs.readFile(target, 'utf8');
    const fileJson = JSON.parse(raw);
    expect(fileJson.version).toBe(2);
    expect(typeof fileJson.fileId).toBe('string');
    expect(Array.isArray(fileJson.groups)).toBe(true);
    expect(fileJson.groups.length).toBeGreaterThanOrEqual(1);
    expect(fileJson.groups[0].name).toBe('Unsorted');

    // Registry was updated with the new file
    const registryPath = path.join(testDir, '.bookmarks', 'local', 'bookmarks.registry.json');
    const registryRaw = await fs.readFile(registryPath, 'utf8');
    const registry = JSON.parse(registryRaw);
    expect(Array.isArray(registry.files)).toBe(true);
    expect(registry.files.length).toBe(1);
  });

  it('rejects with structured JSON when file already exists', async () => {
    const target = path.join(testDir, 'existing.json');
    await fs.writeFile(
      target,
      JSON.stringify({ version: 2, fileId: 'sentinel-existing', groups: [], bookmarks: [] }),
      'utf8'
    );

    const result = await handleFileCreate(ctx, { path: target });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({
      success: false,
      error: 'File already exists',
      path: path.resolve(target),
    });
  });

  it('does not modify the on-disk file when rejecting a collision', async () => {
    const target = path.join(testDir, 'existing.json');
    const originalContent = JSON.stringify({
      version: 2,
      fileId: 'sentinel-existing',
      groups: [
        {
          id: 'g-original',
          name: 'Original',
          icon: {},
          isUnsorted: false,
          createdAt: 1234567890,
        },
      ],
      bookmarks: [{ id: 'b1' }],
    });
    await fs.writeFile(target, originalContent, 'utf8');
    const beforeBytes = await fs.readFile(target);

    const result = await handleFileCreate(ctx, { path: target });

    // Sanity: the call rejected
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('File already exists');

    // File on disk must be byte-equal to what we wrote
    const afterBytes = await fs.readFile(target);
    expect(afterBytes.equals(beforeBytes)).toBe(true);

    // The original fileId is still present; no new fileId was written
    const afterText = afterBytes.toString('utf8');
    expect(afterText).toContain('sentinel-existing');
  });
});
