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
    console.error(`Filter test failed: bundle not found at ${bundle}. Run "pnpm build" first.`);
    process.exit(1);
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bundle],
    env: process.env
  });
  const client = new Client({ name: 'filter-test', version: '0.0.0' }, { capabilities: { tools: {}, resources: {} } });
  await client.connect(transport);

  const tmpRoot = path.resolve(repoRoot, 'scripts', '.tmp-smoke');
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });
  const dummy = path.join(tmpRoot, 'test.js');
  await fs.writeFile(dummy, 'function hello() {\n  console.log("world");\n}\n');
  const fileUri = 'file://' + dummy;
  const rootUri = 'file://' + tmpRoot;

  console.log('[filter-test] Creating test bookmarks with different content...');

  // Create bookmarks with various content to test filtering
  const testBookmarks = [
    { label: 'API endpoint', note: 'Important server logic', anchor: { kind: 'point', line: 0, lineCache: 'function hello() {' } },
    { label: 'Database query', note: 'Needs optimization', anchor: { kind: 'point', line: 1, lineCache: '  console.log("world");' } },
    { label: 'Cache implementation', note: 'Redis integration here', anchor: { kind: 'point', line: 2, lineCache: '}' } },
  ];

  for (const bm of testBookmarks) {
    const res = await client.callTool({
      name: 'bookmark_add',
      arguments: { uri: fileUri, label: bm.label, note: bm.note, anchor: bm.anchor, newGroup: false },
      _meta: { rootUris: [rootUri] }
    });
    if (!res || !Array.isArray(res.content)) throw new Error('bookmark_add failed');
  }

  console.log('  ✓ Created 3 test bookmarks');

  // Test 1: Search by label
  console.log('[filter-test] Test 1: Search by label "endpoint"');
  const res1 = await client.callTool({
    name: 'bookmark_list',
    arguments: { query: 'endpoint' },
    _meta: { rootUris: [rootUri] }
  });
  const data1 = JSON.parse(res1.content[0].text);
  if (data1.bookmarks.length !== 1 || !data1.bookmarks[0].label.includes('endpoint')) {
    throw new Error('Label search failed');
  }
  console.log('  ✓ Found bookmark by label');

  // Test 2: Search by note
  console.log('[filter-test] Test 2: Search by note "optimization"');
  const res2 = await client.callTool({
    name: 'bookmark_list',
    arguments: { query: 'optimization' },
    _meta: { rootUris: [rootUri] }
  });
  const data2 = JSON.parse(res2.content[0].text);
  if (data2.bookmarks.length !== 1 || !data2.bookmarks[0].note.includes('optimization')) {
    throw new Error('Note search failed');
  }
  console.log('  ✓ Found bookmark by note');

  // Test 3: Search by lineCache
  console.log('[filter-test] Test 3: Search by lineCache "console.log"');
  const res3 = await client.callTool({
    name: 'bookmark_list',
    arguments: { query: 'console.log' },
    _meta: { rootUris: [rootUri] }
  });
  const data3 = JSON.parse(res3.content[0].text);
  if (data3.bookmarks.length !== 1 || !data3.bookmarks[0].anchor.lineCache.includes('console.log')) {
    throw new Error('LineCache search failed');
  }
  console.log('  ✓ Found bookmark by lineCache');

  // Test 4: Search term appearing in multiple fields
  console.log('[filter-test] Test 4: Search "server" (appears in note)');
  const res4 = await client.callTool({
    name: 'bookmark_list',
    arguments: { query: 'server' },
    _meta: { rootUris: [rootUri] }
  });
  const data4 = JSON.parse(res4.content[0].text);
  if (data4.bookmarks.length !== 1) {
    throw new Error('Multi-field search failed');
  }
  console.log('  ✓ Found bookmark across multiple fields');

  // Test 5: Search with bookmark_search tool (default "full" mode)
  console.log('[filter-test] Test 5: bookmark_search with text "Redis" (full mode)');
  const res5 = await client.callTool({
    name: 'bookmark_search',
    arguments: { text: 'Redis' },
    _meta: { rootUris: [rootUri] }
  });
  const data5 = JSON.parse(res5.content[0].text);
  if (data5.results.length !== 1 || !data5.results[0].note.includes('Redis')) {
    throw new Error('bookmark_search full mode failed');
  }
  console.log('  ✓ bookmark_search full mode works correctly');

  // Test 5b: bookmark_search with "textual" mode
  console.log('[filter-test] Test 5b: bookmark_search with "textual" mode');
  const res5b = await client.callTool({
    name: 'bookmark_search',
    arguments: { text: 'console.log', resultsMode: 'textual' },
    _meta: { rootUris: [rootUri] }
  });
  const data5b = JSON.parse(res5b.content[0].text);
  if (data5b.results.length !== 1) {
    throw new Error('bookmark_search textual mode returned wrong count');
  }
  const textualResult = data5b.results[0];
  if (!textualResult.uri || !textualResult.label || !textualResult.lineCache) {
    throw new Error('bookmark_search textual mode missing required fields');
  }
  if (!textualResult.lineCache.includes('console.log')) {
    throw new Error('bookmark_search textual mode lineCache incorrect');
  }
  console.log('  ✓ bookmark_search textual mode works correctly');

  // Test 5c: bookmark_search with "lineNumbers" mode
  console.log('[filter-test] Test 5c: bookmark_search with "lineNumbers" mode');
  const res5c = await client.callTool({
    name: 'bookmark_search',
    arguments: { text: 'endpoint', resultsMode: 'lineNumbers' },
    _meta: { rootUris: [rootUri] }
  });
  const data5c = JSON.parse(res5c.content[0].text);
  if (data5c.results.length !== 1) {
    throw new Error('bookmark_search lineNumbers mode returned wrong count');
  }
  const lineResult = data5c.results[0];
  if (!lineResult.uri || lineResult.line == null) {
    throw new Error('bookmark_search lineNumbers mode missing required fields');
  }
  if (lineResult.line !== 0) {
    throw new Error('bookmark_search lineNumbers mode line number incorrect');
  }
  console.log('  ✓ bookmark_search lineNumbers mode works correctly');

  // Test 6: No match
  console.log('[filter-test] Test 6: Search for non-existent term "foobar"');
  const res6 = await client.callTool({
    name: 'bookmark_list',
    arguments: { query: 'foobar' },
    _meta: { rootUris: [rootUri] }
  });
  const data6 = JSON.parse(res6.content[0].text);
  if (data6.bookmarks.length !== 0) {
    throw new Error('Empty search should return no results');
  }
  console.log('  ✓ No matches returned correctly');

  console.log('\n✅ Filter test passed: all search scopes (label, note, lineCache) and all result modes (textual, lineNumbers, full) work correctly.');
  await client.close();
}

main().catch((e) => {
  console.error('Filter test failed:', e);
  process.exit(1);
});
