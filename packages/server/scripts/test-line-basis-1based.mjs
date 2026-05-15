/**
 * Smoke test: editor-line-agreement after anchor_repair
 *
 * Regression guard for SML-1334. Verifies that the MCP wire is 1-based:
 * passing newLine: N to anchor_repair yields line: N from anchor_validate,
 * matching what grep -n / the editor UI shows.
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function runGit(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function parseToolText(result) {
  const text = result?.content?.[0]?.text;
  if (!text) throw new Error('Tool returned no text content');
  return JSON.parse(text);
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function main() {
  const repoRoot = path.resolve(path.join(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname), '../../..'));
  const serverEntry = path.resolve(repoRoot, 'packages/server/dist/index.cjs');
  if (!(await fileExists(serverEntry))) {
    throw new Error(`Server build not found at ${serverEntry}. Run "pnpm --filter @agentic-bookmarks/server build" first.`);
  }

  const wsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmarks-line-basis-'));
  const srcDir = path.join(wsRoot, 'src');
  await fs.mkdir(srcDir, { recursive: true });
  const sourceFile = path.join(srcDir, 'sample.txt');

  // Initial file: TARGET is at 1-based line 3 (0-based index 2)
  const initialLines = ['line one', 'line two', 'TARGET_LINE_UNIQUE_MARKER', 'line four', 'line five'];
  await fs.writeFile(sourceFile, initialLines.join('\n') + '\n', 'utf8');

  runGit(['init'], wsRoot);
  runGit(['config', 'user.email', 'test@example.com'], wsRoot);
  runGit(['config', 'user.name', 'Bookmarks Test'], wsRoot);
  runGit(['add', '.'], wsRoot);
  runGit(['commit', '-m', 'initial'], wsRoot);

  const rootUri = `file://${wsRoot}`;
  const fileUri = `file://${sourceFile}`;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { ...process.env, BOOKMARKS_DIR: wsRoot },
  });

  const client = new Client(
    { name: 'line-basis-smoke', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } }
  );
  await client.connect(transport);

  try {
    // Create a smart bookmark targeting TARGET_LINE_UNIQUE_MARKER.
    // bookmark_add still accepts 0-based for anchor.line (out of scope for SML-1334);
    // 0-based index 2 == 1-based line 3, where TARGET sits initially.
    const addRes = await client.callTool({
      name: 'bookmark_add',
      arguments: {
        uri: fileUri,
        label: 'line-basis-target',
        anchor: { kind: 'point', line: 2 },
        anchorType: 'smart',
        groupName: 'LineBasis',
      },
      _meta: { rootUris: [rootUri] },
    });
    const addData = parseToolText(addRes);
    const bookmarkId = addData.bookmarkId;
    if (!bookmarkId) throw new Error(`bookmark_add missing bookmarkId: ${JSON.stringify(addData)}`);

    // Insert 7 blank lines at the top so the smart anchor breaks
    // (FLEX_RESOLUTION_WINDOW = 5, so 7 > 5 forces a broken state).
    // After this, TARGET is at 1-based line 10 (0-based index 9).
    const blanks = ['', '', '', '', '', '', ''];
    const newContent = [...blanks, ...initialLines].join('\n') + '\n';
    await fs.writeFile(sourceFile, newContent, 'utf8');

    // Verify via grep what the editor would show: TARGET is at 1-based line 10.
    const grepOutput = execFileSync('grep', ['-n', 'TARGET_LINE_UNIQUE_MARKER', sourceFile], { encoding: 'utf8' });
    const grepLine = parseInt(grepOutput.split(':', 1)[0], 10);
    assertEqual(grepLine, 10, 'sanity check: grep -n should show TARGET at line 10');

    // Validate that the anchor is now broken
    const validate1 = parseToolText(await client.callTool({
      name: 'anchor_validate',
      arguments: { uri: fileUri },
      _meta: { rootUris: [rootUri] },
    }));
    if (!validate1.results || validate1.results.length === 0) {
      throw new Error('anchor_validate returned no results pre-repair');
    }
    const preRepair = validate1.results.find((r) => r.bookmarkId === bookmarkId);
    if (!preRepair) throw new Error(`anchor_validate missing entry for ${bookmarkId}`);
    if (preRepair.resolved) {
      // If the anchor still resolves, our test setup didn't break it as expected.
      // Continue anyway — the line-basis assertion is independent of broken state.
      console.log(`note: anchor unexpectedly still resolved at line ${preRepair.line} pre-repair`);
    }

    // Repair using 1-based wire convention (match grep -n / editor row).
    const wireLine = 10;
    const repairRes = parseToolText(await client.callTool({
      name: 'anchor_repair',
      arguments: { repairs: [{ bookmarkId, newLine: wireLine }] },
      _meta: { rootUris: [rootUri] },
    }));
    if (!repairRes.success) {
      throw new Error(`anchor_repair failed: ${JSON.stringify(repairRes.failed)}`);
    }
    assertEqual(repairRes.repaired[0].newLine, wireLine, 'anchor_repair should echo newLine as 1-based wire');

    // Validate again — line in response must equal what we passed in.
    const validate2 = parseToolText(await client.callTool({
      name: 'anchor_validate',
      arguments: { uri: fileUri },
      _meta: { rootUris: [rootUri] },
    }));
    const postRepair = validate2.results.find((r) => r.bookmarkId === bookmarkId);
    if (!postRepair) throw new Error(`anchor_validate missing entry for ${bookmarkId} post-repair`);
    assertEqual(postRepair.resolved, true, 'anchor should resolve after repair');
    assertEqual(postRepair.line, wireLine, 'anchor_validate.line must equal wire newLine (1-based agreement with editor)');

    // Bounds-check error message: out-of-bounds wire line should mention 1-based range.
    const oobRes = parseToolText(await client.callTool({
      name: 'anchor_repair',
      arguments: { repairs: [{ bookmarkId, newLine: 9999 }] },
      _meta: { rootUris: [rootUri] },
    }));
    if (oobRes.success || !oobRes.failed?.[0]?.error) {
      throw new Error('expected anchor_repair to fail on out-of-bounds line');
    }
    const errMsg = oobRes.failed[0].error;
    if (!errMsg.includes('valid range 1..')) {
      throw new Error(`bounds error should reference 1-based range, got: ${errMsg}`);
    }

    console.log('OK: line-basis 1-based wire agreement verified');
    console.log(`  - grep -n showed line ${grepLine}`);
    console.log(`  - anchor_repair accepted newLine ${wireLine}`);
    console.log(`  - anchor_validate returned line ${postRepair.line}`);
    console.log(`  - bounds error: ${errMsg}`);
  } finally {
    await client.close();
    await fs.rm(wsRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
