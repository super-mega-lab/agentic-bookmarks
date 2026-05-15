#!/usr/bin/env node

/**
 * Smoke test for multi-workspace MCP server functionality.
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'dist', 'index.cjs');

async function createTestWorkspace(name) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `bookmarks-test-${name}-`));

  // Create .bookmarks structure
  await fs.mkdir(path.join(tempDir, '.bookmarks', 'shared'), { recursive: true });
  await fs.mkdir(path.join(tempDir, '.bookmarks', 'local'), { recursive: true });
  await fs.mkdir(path.join(tempDir, '.vscode'), { recursive: true });

  // Create a test source file
  await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, 'src', 'index.ts'),
    'export function hello() {\n  return "Hello";\n}\n'
  );

  return tempDir;
}

async function runTest() {
  console.log('Creating test workspaces...');

  const workspace1 = await createTestWorkspace('ws1');
  const workspace2 = await createTestWorkspace('ws2');

  console.log(`Workspace 1: ${workspace1}`);
  console.log(`Workspace 2: ${workspace2}`);

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

  // Start server with workspace config
  const server = spawn('node', [serverPath], {
    env: {
      ...process.env,
      MCP_BOOKMARKS_WORKSPACES: JSON.stringify(workspaceConfig),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  server.stderr.on('data', (data) => {
    console.log('Server:', data.toString());
  });

  // Wait for server to be ready
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Send initialization
  const initRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    },
  };

  server.stdin.write(JSON.stringify(initRequest) + '\n');

  // Test: Add bookmark to workspace 1
  const addRequest1 = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'bookmark_add',
      arguments: {
        uri: `file://${workspace1}/src/index.ts`,
        label: 'Hello function',
        anchor: { kind: 'point', line: 0 },
        groupName: 'Test Group WS1',
      },
    },
  };

  server.stdin.write(JSON.stringify(addRequest1) + '\n');

  // Test: Add bookmark to workspace 2
  const addRequest2 = {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'bookmark_add',
      arguments: {
        uri: `file://${workspace2}/src/index.ts`,
        label: 'Hello function WS2',
        anchor: { kind: 'point', line: 0 },
        groupName: 'Test Group WS2',
      },
    },
  };

  server.stdin.write(JSON.stringify(addRequest2) + '\n');

  // Test: List all bookmarks
  const listRequest = {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'bookmark_list',
      arguments: {},
    },
  };

  server.stdin.write(JSON.stringify(listRequest) + '\n');

  // Collect responses
  let responseBuffer = '';
  const responses = [];

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

  // Wait for responses
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Kill server
  server.kill();

  // Analyze results
  console.log('\n--- Results ---');
  console.log(`Received ${responses.length} responses`);

  for (const response of responses) {
    if (response.id) {
      console.log(`Response ${response.id}:`, JSON.stringify(response.result || response.error, null, 2));
    }
  }

  // Verify bookmark files were created with relative paths
  console.log('\n--- Verifying stored data ---');

  let allPassed = true;

  const registry1Path = path.join(workspace1, '.vscode', 'bookmarks.registry.json');
  const registry1Exists = await fs.access(registry1Path).then(() => true).catch(() => false);

  if (registry1Exists) {
    const registry1 = JSON.parse(
      await fs.readFile(registry1Path, 'utf8')
    );
    console.log('Registry 1 files:', registry1.files.map(f => f.path));

    // Verify paths are relative
    const allRelative = registry1.files.every(f => !path.isAbsolute(f.path));
    console.log('All paths are relative:', allRelative ? '✅' : '❌');
    if (!allRelative) allPassed = false;
  } else {
    console.log('Registry 1 not created - may indicate initialization issue');
    allPassed = false;
  }

  // Clean up
  await fs.rm(workspace1, { recursive: true, force: true });
  await fs.rm(workspace2, { recursive: true, force: true });

  console.log(`\n${allPassed ? '✅ Test complete' : '❌ Test failed'}`);
  process.exit(allPassed ? 0 : 1);
}

runTest().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
