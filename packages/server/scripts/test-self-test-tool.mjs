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
    console.error(`Test failed: bundle not found at ${bundle}. Run "pnpm build" first.`);
    process.exit(1);
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bundle],
    env: process.env
  });
  const client = new Client({ name: 'self-test', version: '0.0.0' }, { capabilities: { tools: {}, resources: {} } });
  await client.connect(transport);

  console.log('[self-test] Listing tools to verify self_test exists...');
  const tools = await client.listTools();
  const selfTestTool = tools.tools.find(t => t.name === 'self_test');

  if (!selfTestTool) {
    throw new Error('self_test tool not found in tools list');
  }

  console.log('  ✓ self_test tool found');
  console.log('    Description:', selfTestTool.description);
  console.log('    Required params:', selfTestTool.inputSchema.required);

  // Test 1: Call with proactive mode
  console.log('\n[self-test] Test 1: Calling self_test with bookmark_mode="proactive"...');
  const result1 = await client.callTool({
    name: 'self_test',
    arguments: { bookmark_mode: 'proactive' }
  });

  const data1 = JSON.parse(result1.content[0].text);
  console.log('Response:', JSON.stringify(data1, null, 2));

  if (data1.echo.bookmark_mode !== 'proactive') {
    throw new Error('Expected echo.bookmark_mode to be "proactive", got: ' + data1.echo.bookmark_mode);
  }
  console.log('  ✓ Echo correct: proactive');

  // Test 2: Call with balanced mode
  console.log('\n[self-test] Test 2: Calling self_test with bookmark_mode="balanced"...');
  const result2 = await client.callTool({
    name: 'self_test',
    arguments: { bookmark_mode: 'balanced' }
  });

  const data2 = JSON.parse(result2.content[0].text);
  if (data2.echo.bookmark_mode !== 'balanced') {
    throw new Error('Expected echo.bookmark_mode to be "balanced", got: ' + data2.echo.bookmark_mode);
  }
  console.log('  ✓ Echo correct: balanced');

  // Test 3: Call with reactive mode
  console.log('\n[self-test] Test 3: Calling self_test with bookmark_mode="reactive"...');
  const result3 = await client.callTool({
    name: 'self_test',
    arguments: { bookmark_mode: 'reactive' }
  });

  const data3 = JSON.parse(result3.content[0].text);
  if (data3.echo.bookmark_mode !== 'reactive') {
    throw new Error('Expected echo.bookmark_mode to be "reactive", got: ' + data3.echo.bookmark_mode);
  }
  console.log('  ✓ Echo correct: reactive');

  // Verify server info is included
  console.log('\n[self-test] Verifying server info...');
  if (!data3.server_info || !data3.server_info.name || !data3.server_info.version) {
    throw new Error('Server info missing or incomplete');
  }
  console.log('  ✓ Server name:', data3.server_info.name);
  console.log('  ✓ Server version:', data3.server_info.version);
  console.log('  ✓ Workspace root:', data3.server_info.workspaceRoot);

  // Verify timestamp is included
  if (!data3.timestamp) {
    throw new Error('Timestamp missing');
  }
  console.log('  ✓ Timestamp:', data3.timestamp);

  console.log('\n✅ self_test tool passed: All tests succeeded.');
  await client.close();
}

main().catch((e) => {
  console.error('self_test tool test failed:', e);
  process.exit(1);
});
