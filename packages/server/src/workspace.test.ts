import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { findWorkspaceRootUpward } from './workspace';

describe('findWorkspaceRootUpward', () => {
  let tmp: string;
  let realTmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-discovery-'));
    realTmp = await fs.realpath(tmp);
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('finds the new-location registry sentinel', async () => {
    const dir = path.join(realTmp, '.bookmarks', 'local');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'bookmarks.registry.json'), '{}');
    const deep = path.join(realTmp, 'src', 'deep');
    await fs.mkdir(deep, { recursive: true });

    const found = await findWorkspaceRootUpward(deep);
    expect(found).toBe(realTmp);
  });

  it('falls back to the legacy .vscode location for unmigrated workspaces', async () => {
    const dir = path.join(realTmp, '.vscode');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'bookmarks.registry.json'), '{}');
    const sub = path.join(realTmp, 'src');
    await fs.mkdir(sub, { recursive: true });

    const found = await findWorkspaceRootUpward(sub);
    expect(found).toBe(realTmp);
  });

  it('returns null when neither sentinel exists', async () => {
    const found = await findWorkspaceRootUpward(realTmp);
    expect(found).toBeNull();
  });

  it('terminates the walk at the workspace root rather than continuing past it', async () => {
    // Both sentinels live at realTmp; starting from realTmp itself must find realTmp
    // (not climb upward and find some unrelated parent registry).
    await fs.mkdir(path.join(realTmp, '.bookmarks', 'local'), { recursive: true });
    await fs.writeFile(
      path.join(realTmp, '.bookmarks', 'local', 'bookmarks.registry.json'),
      '{}',
    );
    expect(await findWorkspaceRootUpward(realTmp)).toBe(realTmp);
  });
});
