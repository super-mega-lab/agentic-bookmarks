#!/usr/bin/env node

/**
 * Test group name-based bookmark creation with lazy initialization.
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'dist', 'index.cjs');

async function runTest() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmarks-lazy-test-'));

  // Create minimal structure
  await fs.mkdir(path.join(tempDir, '.bookmarks', 'local'), { recursive: true });
  await fs.mkdir(path.join(tempDir, '.vscode'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
  await fs.writeFile(path.join(tempDir, 'src', 'test.ts'), 'const x = 1;\n');

  console.log(`Test directory: ${tempDir}`);

  const server = spawn('node', [serverPath], {
    env: {
      ...process.env,
      MCP_BOOKMARKS_WORKSPACES: JSON.stringify([{
        workspaceRoot: tempDir,
        registryPath: '.vscode/bookmarks.registry.json',
        bookmarksDataRoot: '.bookmarks',
      }]),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let responses = [];
  let responseBuffer = '';

  server.stderr.on('data', (data) => console.log('Server:', data.toString()));

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
      clientInfo: { name: 'test', version: '1.0.0' }
    },
  }) + '\n');

  await new Promise(r => setTimeout(r, 500));

  // Add bookmark with new group name (should create group lazily)
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'bookmark_add',
      arguments: {
        uri: `file://${tempDir}/src/test.ts`,
        label: 'First bookmark',
        anchor: { kind: 'point', line: 0 },
        groupName: 'New Feature Group',
      },
    },
  }) + '\n');

  await new Promise(r => setTimeout(r, 500));

  // Add second bookmark to same group (should use existing)
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'bookmark_add',
      arguments: {
        uri: `file://${tempDir}/src/test.ts`,
        label: 'Second bookmark',
        anchor: { kind: 'point', line: 0, column: 5 },
        groupName: 'New Feature Group',
      },
    },
  }) + '\n');

  await new Promise(r => setTimeout(r, 1000));

  server.kill();

  console.log(`\nReceived ${responses.length} responses from server`);

  // Verify
  console.log('\n--- Verification ---');

  let allPassed = true;

  const registryPath = path.join(tempDir, '.vscode', 'bookmarks.registry.json');
  const registryExists = await fs.access(registryPath).then(() => true).catch(() => false);

  if (registryExists) {
    const registry = JSON.parse(
      await fs.readFile(registryPath, 'utf8')
    );

    console.log('nameIndex:', JSON.stringify(registry.nameIndex, null, 2));
    const groupCreated = !!registry.nameIndex['New Feature Group'];
    console.log('Group created:', groupCreated ? '✅' : '❌');
    if (!groupCreated) allPassed = false;

    // Read bookmark file
    const localFile = path.join(tempDir, '.bookmarks', 'local', 'bookmarks.json');
    const bookmarkFileExists = await fs.access(localFile).then(() => true).catch(() => false);

    if (bookmarkFileExists) {
      const bookmarks = JSON.parse(await fs.readFile(localFile, 'utf8'));

      console.log('Groups in file:', bookmarks.groups.map(g => g.name));
      console.log('Bookmark count:', bookmarks.bookmarks.length);

      const sameGroup = bookmarks.bookmarks.every(b => b.groupId === bookmarks.bookmarks[0].groupId);
      console.log('Both bookmarks in same group:', sameGroup ? '✅' : '❌');
      if (!sameGroup) allPassed = false;

      // Check URI is relative
      const uriRelative = !bookmarks.bookmarks[0].target.uri.startsWith('file://');
      console.log('URI is relative:', uriRelative ? '✅' : '❌');
      if (!uriRelative) allPassed = false;
      console.log('Stored URI:', bookmarks.bookmarks[0].target.uri);
    } else {
      console.log('❌ Bookmark file was not created');
      allPassed = false;
    }
  } else {
    console.log('❌ Registry was not created');
    allPassed = false;
  }

  // Clean up
  await fs.rm(tempDir, { recursive: true, force: true });

  console.log(`\n${allPassed ? '✅ Lazy init test complete' : '❌ Lazy init test failed'}`);
  process.exit(allPassed ? 0 : 1);
}

runTest().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
