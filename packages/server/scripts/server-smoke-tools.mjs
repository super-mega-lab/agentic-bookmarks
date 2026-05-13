import path from 'node:path';
import fs from 'node:fs/promises';
import process from 'node:process';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function fileExists(p) { try { await fs.access(p); return true; } catch { return false; } }

async function main() {
  const repoRoot = path.resolve(path.join(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname), '../../..'));
  const bundle = path.resolve(repoRoot, 'packages/extension/server-bundle/index.js');
  if (!(await fileExists(bundle))) {
    console.error(`Smoke (server/sdk) failed: bundle not found at ${bundle}. Run "pnpm build" first.`);
    process.exit(1);
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bundle],
    env: process.env
  });
  const client = new Client({ name: 'smoke', version: '0.0.0' }, { capabilities: { tools: {}, resources: {} } });
  await client.connect(transport);

  const { tools } = await client.listTools();
  const add = tools.find(t => t.name === 'bookmark_add');
  if (!add) throw new Error('bookmark_add not found');
  if (!add.inputSchema?.required?.includes('anchor')) {
    throw new Error('bookmark_add.inputSchema.required does not include "anchor"');
  }

  const tmpRoot = path.resolve(repoRoot, 'scripts', '.tmp-smoke');
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });
  const dummy = path.join(tmpRoot, 'foo.txt');
  await fs.writeFile(dummy, 'hello\nworld\n');
  const fileUri = 'file://' + dummy;
  const rootUri = 'file://' + tmpRoot;

  // Test 1: bookmark_add with newGroup and point anchor
  console.log('[smoke] calling tools/call bookmark_add with newGroup');
  const res = await client.callTool({
    name: 'bookmark_add',
    arguments: { uri: fileUri, label: 'smoke-add', anchor: { kind: 'point', line: 0 }, newGroup: true },
    _meta: { rootUris: [rootUri] }
  });
  if (!res || !Array.isArray(res.content)) throw new Error('callTool returned no content');
  console.log('  ✓ bookmark_add response:', JSON.stringify(res.content));

  // Verify files created and contain the expected shape.
  // Default local data file + registry both live under .bookmarks/local/ now.
  const dataFile = path.join(tmpRoot, '.bookmarks', 'local', 'bookmarks.json');
  const regFile = path.join(tmpRoot, '.bookmarks', 'local', 'bookmarks.registry.json');
  if (!(await fileExists(dataFile))) throw new Error('bookmarks.json not created');
  if (!(await fileExists(regFile))) throw new Error('bookmarks.registry.json not created');

  const data = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  const reg = JSON.parse(await fs.readFile(regFile, 'utf8'));
  const bm = data.bookmarks?.[0];
  const g = data.groups?.find(x => x.id === bm?.groupId);
  if (!bm || bm.anchor?.kind !== 'point' || bm.anchor.line !== 0) throw new Error('bookmark anchor invalid');
  if (!g || g.icon?.svg_style !== 'aiBookmark3' || typeof g.icon?.svg_color !== 'string') throw new Error('group icon invalid');
  if (!reg.defaultTarget?.groupId || !reg.defaultTarget?.fileId) throw new Error('defaultTarget not set');
  console.log('  ✓ bookmarks.json created with correct anchor and group icon');
  console.log('  ✓ defaultTarget set in registry');

  // Test 2: bookmark_list
  console.log('[smoke] calling bookmark_list');
  const listRes = await client.callTool({
    name: 'bookmark_list',
    arguments: {},
    _meta: { rootUris: [rootUri] }
  });
  if (!listRes || !Array.isArray(listRes.content)) throw new Error('bookmark_list returned no content');
  const listData = JSON.parse(listRes.content[0].text);
  if (!listData.bookmarks || listData.bookmarks.length !== 1) throw new Error('bookmark_list did not return exactly 1 bookmark');
  console.log('  ✓ bookmark_list returned 1 bookmark');

  // Test 3: bookmark_add without newGroup (should use existing group)
  console.log('[smoke] calling bookmark_add without newGroup');
  const res2 = await client.callTool({
    name: 'bookmark_add',
    arguments: { uri: fileUri, label: 'smoke-add-2', anchor: { kind: 'point', line: 1 }, newGroup: false },
    _meta: { rootUris: [rootUri] }
  });
  if (!res2 || !Array.isArray(res2.content)) throw new Error('second bookmark_add returned no content');
  console.log('  ✓ second bookmark added');

  // Test 4: verify bookmark_list now returns 2 bookmarks
  const listRes2 = await client.callTool({
    name: 'bookmark_list',
    arguments: {},
    _meta: { rootUris: [rootUri] }
  });
  const listData2 = JSON.parse(listRes2.content[0].text);
  if (!listData2.bookmarks || listData2.bookmarks.length !== 2) throw new Error('bookmark_list did not return 2 bookmarks after second add');
  console.log('  ✓ bookmark_list now returns 2 bookmarks');

  // Test 5: bookmark_delete
  console.log('[smoke] calling bookmark_delete');
  const bmIdToDelete = listData2.bookmarks[0].id;
  const delRes = await client.callTool({
    name: 'bookmark_delete',
    arguments: { id: bmIdToDelete },
    _meta: { rootUris: [rootUri] }
  });
  if (!delRes || !Array.isArray(delRes.content)) throw new Error('bookmark_delete returned no content');
  console.log('  ✓ bookmark deleted');

  // Test 6: verify bookmark_list now returns 1 bookmark
  const listRes3 = await client.callTool({
    name: 'bookmark_list',
    arguments: {},
    _meta: { rootUris: [rootUri] }
  });
  const listData3 = JSON.parse(listRes3.content[0].text);
  if (!listData3.bookmarks || listData3.bookmarks.length !== 1) throw new Error('bookmark_list did not return 1 bookmark after delete');
  console.log('  ✓ bookmark_list returns 1 bookmark after deletion');

  // Test 7: verify data on disk matches
  const dataAfterDelete = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  if (dataAfterDelete.bookmarks.length !== 1) throw new Error('bookmarks.json does not contain exactly 1 bookmark after delete');
  console.log('  ✓ bookmarks.json on disk reflects deletion');

  console.log('\n✅ Smoke (server/sdk) passed: all tests succeeded.');
  await client.close();
}

main().catch((e) => {
  console.error('Smoke (server/sdk) failed:', e);
  process.exit(1);
});
