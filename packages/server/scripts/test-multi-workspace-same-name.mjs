#!/usr/bin/env node

/**
 * Test that same group name in different workspaces creates separate groups.
 *
 * This validates the v3 design requirement:
 * "Group names are unique within a workspace (enforced by registry nameIndex)"
 * "Same group name CAN exist in different workspaces"
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'dist', 'index.cjs');

async function createTestWorkspace(name) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `bookmarks-samename-${name}-`));

  await fs.mkdir(path.join(tempDir, '.bookmarks', 'local'), { recursive: true });
  await fs.mkdir(path.join(tempDir, '.vscode'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, 'src', 'index.ts'),
    `// Workspace ${name}\nexport function hello() {\n  return "Hello from ${name}";\n}\n`
  );

  return tempDir;
}

async function runTest() {
  console.log('=== Test: Same Group Name in Different Workspaces ===\n');
  console.log('Creating test workspaces...');

  const workspace1 = await createTestWorkspace('A');
  const workspace2 = await createTestWorkspace('B');

  console.log(`Workspace A: ${workspace1}`);
  console.log(`Workspace B: ${workspace2}`);

  const workspaceConfig = [
    {
      workspaceRoot: workspace1,
      registryPath: '.vscode/bookmarks.registry.json',
      bookmarksDataRoot: '.bookmarks',
    },
    {
      workspaceRoot: workspace2,
      registryPath: '.vscode/bookmarks.registry.json',
      bookmarksDataRoot: '.bookmarks',
    },
  ];

  const server = spawn('node', [serverPath], {
    env: {
      ...process.env,
      MCP_BOOKMARKS_WORKSPACES: JSON.stringify(workspaceConfig),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let responseBuffer = '';
  const responses = [];

  server.stderr.on('data', (data) => console.log('Server:', data.toString().trim()));

  server.stdout.on('data', (data) => {
    responseBuffer += data.toString();
    const lines = responseBuffer.split('\n');
    responseBuffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          responses.push(JSON.parse(line));
        } catch {
          // Ignore non-JSON lines
        }
      }
    }
  });

  await new Promise(r => setTimeout(r, 1000));

  // Initialize
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    },
  }) + '\n');

  await new Promise(r => setTimeout(r, 500));

  // Add bookmark to workspace A with group name "Important"
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'bookmark_add',
      arguments: {
        uri: `file://${workspace1}/src/index.ts`,
        label: 'Important in WS-A',
        anchor: { kind: 'point', line: 1 },
        groupName: 'Important',  // Same name!
      },
    },
  }) + '\n');

  await new Promise(r => setTimeout(r, 500));

  // Add bookmark to workspace B with SAME group name "Important"
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'bookmark_add',
      arguments: {
        uri: `file://${workspace2}/src/index.ts`,
        label: 'Important in WS-B',
        anchor: { kind: 'point', line: 1 },
        groupName: 'Important',  // Same name!
      },
    },
  }) + '\n');

  await new Promise(r => setTimeout(r, 500));

  // Add second bookmark to workspace A's "Important" group (should use existing)
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'bookmark_add',
      arguments: {
        uri: `file://${workspace1}/src/index.ts`,
        label: 'Another important in WS-A',
        anchor: { kind: 'point', line: 2 },
        groupName: 'Important',
      },
    },
  }) + '\n');

  await new Promise(r => setTimeout(r, 1000));

  server.kill();

  // Verification
  console.log('\n--- Verification ---\n');

  let allPassed = true;

  // Check workspace A
  const registryA = JSON.parse(
    await fs.readFile(path.join(workspace1, '.vscode', 'bookmarks.registry.json'), 'utf8')
  );
  const bookmarksA = JSON.parse(
    await fs.readFile(path.join(workspace1, '.bookmarks', 'local', 'bookmarks.json'), 'utf8')
  );

  console.log('Workspace A:');
  console.log(`  - Groups: ${bookmarksA.groups.map(g => g.name).join(', ')}`);
  console.log(`  - Bookmarks: ${bookmarksA.bookmarks.length}`);
  console.log(`  - nameIndex: ${JSON.stringify(registryA.nameIndex)}`);

  // Check workspace B
  const registryB = JSON.parse(
    await fs.readFile(path.join(workspace2, '.vscode', 'bookmarks.registry.json'), 'utf8')
  );
  const bookmarksB = JSON.parse(
    await fs.readFile(path.join(workspace2, '.bookmarks', 'local', 'bookmarks.json'), 'utf8')
  );

  console.log('Workspace B:');
  console.log(`  - Groups: ${bookmarksB.groups.map(g => g.name).join(', ')}`);
  console.log(`  - Bookmarks: ${bookmarksB.bookmarks.length}`);
  console.log(`  - nameIndex: ${JSON.stringify(registryB.nameIndex)}`);

  // Assertions
  console.log('\n--- Assertions ---\n');

  // 1. Both workspaces should have a group named "Important"
  const hasImportantA = bookmarksA.groups.some(g => g.name === 'Important');
  const hasImportantB = bookmarksB.groups.some(g => g.name === 'Important');
  console.log(`Both workspaces have "Important" group: ${hasImportantA && hasImportantB ? 'PASS' : 'FAIL'}`);
  if (!(hasImportantA && hasImportantB)) allPassed = false;

  // 2. The group IDs should be DIFFERENT (separate groups)
  const groupIdA = bookmarksA.groups.find(g => g.name === 'Important')?.id;
  const groupIdB = bookmarksB.groups.find(g => g.name === 'Important')?.id;
  console.log(`Group IDs are different: ${groupIdA !== groupIdB ? 'PASS' : 'FAIL'}`);
  console.log(`  WS-A groupId: ${groupIdA}`);
  console.log(`  WS-B groupId: ${groupIdB}`);
  if (groupIdA === groupIdB) allPassed = false;

  // 3. Workspace A should have 2 bookmarks in "Important"
  const bookmarksInGroupA = bookmarksA.bookmarks.filter(b => b.groupId === groupIdA);
  console.log(`Workspace A has 2 bookmarks in "Important": ${bookmarksInGroupA.length === 2 ? 'PASS' : 'FAIL'}`);
  if (bookmarksInGroupA.length !== 2) allPassed = false;

  // 4. Workspace B should have 1 bookmark in "Important"
  const bookmarksInGroupB = bookmarksB.bookmarks.filter(b => b.groupId === groupIdB);
  console.log(`Workspace B has 1 bookmark in "Important": ${bookmarksInGroupB.length === 1 ? 'PASS' : 'FAIL'}`);
  if (bookmarksInGroupB.length !== 1) allPassed = false;

  // 5. Each registry's nameIndex should reference its own group
  const nameIndexA = registryA.nameIndex['Important'];
  const nameIndexB = registryB.nameIndex['Important'];
  console.log(`Each registry nameIndex references own group: ${
    nameIndexA?.groupId === groupIdA && nameIndexB?.groupId === groupIdB ? 'PASS' : 'FAIL'
  }`);
  if (nameIndexA?.groupId !== groupIdA || nameIndexB?.groupId !== groupIdB) allPassed = false;

  // Clean up
  await fs.rm(workspace1, { recursive: true, force: true });
  await fs.rm(workspace2, { recursive: true, force: true });

  console.log(`\n${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  process.exit(allPassed ? 0 : 1);
}

runTest().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
