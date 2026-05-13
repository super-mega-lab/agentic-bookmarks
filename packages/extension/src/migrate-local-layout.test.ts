import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { migrateLocalLayout } from './migrate-local-layout';

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

describe('migrateLocalLayout', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mig-')));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('moves legacy registry into .bookmarks/local/', async () => {
    await fs.mkdir(path.join(root, '.vscode'), { recursive: true });
    await fs.writeFile(path.join(root, '.vscode/bookmarks.registry.json'), '{"v":1}');

    await migrateLocalLayout(root);

    expect(
      await fs.readFile(path.join(root, '.bookmarks/local/bookmarks.registry.json'), 'utf8'),
    ).toBe('{"v":1}');
    expect(await exists(path.join(root, '.vscode/bookmarks.registry.json'))).toBe(false);
  });

  it('moves the registry .bak alongside the registry', async () => {
    await fs.mkdir(path.join(root, '.vscode'), { recursive: true });
    await fs.writeFile(path.join(root, '.vscode/bookmarks.registry.json'), '{"v":1}');
    await fs.writeFile(path.join(root, '.vscode/bookmarks.registry.json.bak'), '{"v":0}');

    await migrateLocalLayout(root);

    expect(
      await fs.readFile(path.join(root, '.bookmarks/local/bookmarks.registry.json.bak'), 'utf8'),
    ).toBe('{"v":0}');
  });

  it('is a no-op when nothing to migrate', async () => {
    await migrateLocalLayout(root);
    // No throw, no side effects beyond what the workspace already had.
    expect(await exists(path.join(root, '.bookmarks/local'))).toBe(false);
  });

  it('does not overwrite an existing destination', async () => {
    await fs.mkdir(path.join(root, '.vscode'), { recursive: true });
    await fs.mkdir(path.join(root, '.bookmarks/local'), { recursive: true });
    await fs.writeFile(path.join(root, '.vscode/bookmarks.registry.json'), '{"old":true}');
    await fs.writeFile(
      path.join(root, '.bookmarks/local/bookmarks.registry.json'),
      '{"new":true}',
    );

    await migrateLocalLayout(root);

    // Both files still exist; destination unchanged.
    expect(
      await fs.readFile(path.join(root, '.bookmarks/local/bookmarks.registry.json'), 'utf8'),
    ).toBe('{"new":true}');
    expect(
      await fs.readFile(path.join(root, '.vscode/bookmarks.registry.json'), 'utf8'),
    ).toBe('{"old":true}');
  });

  it('migrates icon cache and removes empty source dir', async () => {
    const src = path.join(root, '.vscode/bookmark-icon-cache');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'square-ff0000.svg'), '<svg/>');
    await fs.writeFile(path.join(src, 'square-00ff00.svg'), '<svg/>');

    await migrateLocalLayout(root);

    expect(
      await fs.readFile(
        path.join(root, '.bookmarks/local/.cache/icons/square-ff0000.svg'),
        'utf8',
      ),
    ).toBe('<svg/>');
    expect(
      await fs.readFile(
        path.join(root, '.bookmarks/local/.cache/icons/square-00ff00.svg'),
        'utf8',
      ),
    ).toBe('<svg/>');
    expect(await exists(src)).toBe(false);
  });

  it('migrates legacy .bookmarks/.cache contents into local/', async () => {
    await fs.mkdir(path.join(root, '.bookmarks/.cache'), { recursive: true });
    await fs.writeFile(path.join(root, '.bookmarks/.cache/groupRename.lock'), '');
    await fs.writeFile(path.join(root, '.bookmarks/.cache/.x.json.lock'), '');

    await migrateLocalLayout(root);

    expect(
      await exists(path.join(root, '.bookmarks/local/.cache/groupRename.lock')),
    ).toBe(true);
    expect(
      await exists(path.join(root, '.bookmarks/local/.cache/.x.json.lock')),
    ).toBe(true);
    expect(await exists(path.join(root, '.bookmarks/.cache'))).toBe(false);
  });

  it('migrates legacy .bookmarks/logs contents into local/', async () => {
    await fs.mkdir(path.join(root, '.bookmarks/logs'), { recursive: true });
    await fs.writeFile(path.join(root, '.bookmarks/logs/x.log'), 'hi');

    await migrateLocalLayout(root);

    expect(
      await fs.readFile(path.join(root, '.bookmarks/local/logs/x.log'), 'utf8'),
    ).toBe('hi');
    expect(await exists(path.join(root, '.bookmarks/logs'))).toBe(false);
  });

  it('does not touch .vscode files that legitimately stay there', async () => {
    await fs.mkdir(path.join(root, '.vscode'), { recursive: true });
    await fs.writeFile(path.join(root, '.vscode/launch.json'), '{}');
    await fs.writeFile(path.join(root, '.vscode/tasks.json'), '{}');
    await fs.writeFile(path.join(root, '.vscode/mcp.json'), '{}');

    await migrateLocalLayout(root);

    expect(await exists(path.join(root, '.vscode/launch.json'))).toBe(true);
    expect(await exists(path.join(root, '.vscode/tasks.json'))).toBe(true);
    expect(await exists(path.join(root, '.vscode/mcp.json'))).toBe(true);
  });

  it('is idempotent — second run after a successful migration is a no-op', async () => {
    await fs.mkdir(path.join(root, '.vscode'), { recursive: true });
    await fs.writeFile(path.join(root, '.vscode/bookmarks.registry.json'), '{"v":1}');

    await migrateLocalLayout(root);
    await migrateLocalLayout(root); // must not throw or duplicate

    expect(
      await fs.readFile(path.join(root, '.bookmarks/local/bookmarks.registry.json'), 'utf8'),
    ).toBe('{"v":1}');
  });
});
