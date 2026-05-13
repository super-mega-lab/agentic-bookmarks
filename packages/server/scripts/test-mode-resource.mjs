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

  // Helper to create a fresh client connection
  async function createClient() {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [bundle],
      env: process.env
    });
    const client = new Client({ name: 'mode-test', version: '0.0.0' }, { capabilities: { tools: {}, resources: {} } });
    await client.connect(transport);
    return client;
  }

  // Use the actual workspace root (repoRoot) since resources don't have _meta
  const localDir = path.join(repoRoot, '.bookmarks', 'local');
  await fs.mkdir(localDir, { recursive: true });

  // Backup existing registry if it exists
  const regPath = path.join(localDir, 'bookmarks.registry.json');
  let backupReg = null;
  try {
    const existing = await fs.readFile(regPath, 'utf8');
    backupReg = existing;
  } catch {}

  console.log('[mode-test] Testing with default mode (balanced)...');
  const regDefault = {
    version: 1,
    files: [],
    nameIndex: {},
    settings: {
      watchersEnabled: true,
      sortByFile: true,
      sortByGroup: false,
      appearance: {
        showDifferentColors: true,
        showDifferentStyles: true
      }
    }
  };
  await fs.writeFile(regPath, JSON.stringify(regDefault, null, 2));

  // Fetch bookmarks://mode resource with fresh client
  let client = await createClient();
  const modeDefault = await client.readResource({ uri: 'bookmarks://mode' });
  console.log('Default mode response:', JSON.stringify(JSON.parse(modeDefault.contents[0].text), null, 2));
  await client.close();

  // Test proactive mode
  console.log('\n[mode-test] Testing with proactive mode...');
  const regProactive = {
    version: 1,
    files: [],
    nameIndex: {},
    settings: {
      watchersEnabled: true,
      sortByFile: true,
      sortByGroup: false,
      appearance: {
        showDifferentColors: true,
        showDifferentStyles: true
      },
      mcp: {
        llmGuidanceMode: 'proactive'
      }
    }
  };
  await fs.writeFile(regPath, JSON.stringify(regProactive, null, 2));
  await new Promise(r => setTimeout(r, 100)); // Small delay for file flush

  client = await createClient();
  const modeProactive = await client.readResource({ uri: 'bookmarks://mode' });
  const proactiveData = JSON.parse(modeProactive.contents[0].text);
  console.log('Proactive mode response:', JSON.stringify(proactiveData, null, 2));

  if (proactiveData.mode !== 'proactive') {
    throw new Error('Expected proactive mode, got: ' + proactiveData.mode);
  }
  await client.close();

  // Test reactive mode
  console.log('\n[mode-test] Testing with reactive mode...');
  const regReactive = {
    version: 1,
    files: [],
    nameIndex: {},
    settings: {
      watchersEnabled: true,
      sortByFile: true,
      sortByGroup: false,
      appearance: {
        showDifferentColors: true,
        showDifferentStyles: true
      },
      mcp: {
        llmGuidanceMode: 'reactive'
      }
    }
  };
  await fs.writeFile(regPath, JSON.stringify(regReactive, null, 2));
  await new Promise(r => setTimeout(r, 100)); // Small delay for file flush

  client = await createClient();
  const modeReactive = await client.readResource({ uri: 'bookmarks://mode' });
  const reactiveData = JSON.parse(modeReactive.contents[0].text);
  console.log('Reactive mode response:', JSON.stringify(reactiveData, null, 2));

  if (reactiveData.mode !== 'reactive') {
    throw new Error('Expected reactive mode, got: ' + reactiveData.mode);
  }

  // List all resources
  console.log('\n[mode-test] Listing all resources...');
  const resources = await client.listResources();
  console.log('Available resources:');
  for (const res of resources.resources) {
    console.log(`  - ${res.uri}: ${res.name}`);
    console.log(`    ${res.description}`);
  }

  // Verify both resources exist
  const hasMode = resources.resources.some(r => r.uri === 'bookmarks://mode');
  const hasFiles = resources.resources.some(r => r.uri === 'bookmarks://files');

  if (!hasMode) throw new Error('bookmarks://mode resource not found');
  if (!hasFiles) throw new Error('bookmarks://files resource not found');

  console.log('\n✅ Mode resource test passed: All modes work correctly and resources are listed.');
  await client.close();

  // Restore backup registry if it existed
  if (backupReg) {
    await fs.writeFile(regPath, backupReg);
    console.log('[mode-test] Restored original registry');
  }
}

main().catch((e) => {
  console.error('Mode resource test failed:', e);
  process.exit(1);
});
