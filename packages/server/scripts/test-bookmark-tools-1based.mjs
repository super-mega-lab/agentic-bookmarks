/**
 * Smoke test: bookmark_add / bookmark_list / bookmark_search 1-based wire (SML-1337)
 *
 * Verifies:
 * 1. bookmark_add accepts 1-based input (matches grep -n / editor).
 * 2. The persisted .bookmarks JSON stores the 0-based equivalent.
 * 3. bookmark_list returns 1-based on the wire.
 * 4. bookmark_search (full and lineNumbers modes) returns 1-based.
 * 5. anchor_validate and bookmark_list agree on the 1-based line for the same anchor.
 * 6. bookmark_add with line < 1 is clamped to 1 (rejected by VS Code coords as out of bounds, but normalized).
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
  try { await fs.access(p); return true; } catch { return false; }
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

  const wsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmarks-bookmark-1based-'));
  const srcDir = path.join(wsRoot, 'src');
  await fs.mkdir(srcDir, { recursive: true });
  const sourceFile = path.join(srcDir, 'sample.txt');

  // File: TARGET_MARKER_FOR_BOOKMARK is at 1-based line 5 (0-based index 4).
  const lines = ['line one', 'line two', 'line three', 'line four', 'TARGET_MARKER_FOR_BOOKMARK', 'line six'];
  await fs.writeFile(sourceFile, lines.join('\n') + '\n', 'utf8');

  runGit(['init'], wsRoot);
  runGit(['config', 'user.email', 'test@example.com'], wsRoot);
  runGit(['config', 'user.name', 'Bookmarks Test'], wsRoot);
  runGit(['add', '.'], wsRoot);
  runGit(['commit', '-m', 'initial'], wsRoot);

  // Sanity: confirm grep agrees the marker is on line 5
  const grepLine = parseInt(
    execFileSync('grep', ['-n', 'TARGET_MARKER_FOR_BOOKMARK', sourceFile], { encoding: 'utf8' }).split(':', 1)[0],
    10
  );
  assertEqual(grepLine, 5, 'sanity: grep -n should show TARGET on line 5');

  const rootUri = `file://${wsRoot}`;
  const fileUri = `file://${sourceFile}`;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { ...process.env, BOOKMARKS_DIR: wsRoot },
  });
  const client = new Client(
    { name: 'bookmark-tools-1based-smoke', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } }
  );
  await client.connect(transport);

  try {
    // 1. bookmark_add with 1-based wire input
    const wireLine = grepLine; // 5
    const addRes = parseToolText(await client.callTool({
      name: 'bookmark_add',
      arguments: {
        uri: fileUri,
        label: 'target marker',
        anchor: { kind: 'point', line: wireLine },
        anchorType: 'point',
        groupName: 'OneBasedTest',
      },
      _meta: { rootUris: [rootUri] },
    }));
    if (!addRes.success) throw new Error(`bookmark_add failed: ${JSON.stringify(addRes)}`);
    const bookmarkId = addRes.bookmarkId;

    // 2. Read the persisted .bookmarks JSON and confirm 0-based storage
    const bookmarksDir = path.join(wsRoot, '.bookmarks', 'local');
    const persistedFiles = (await fs.readdir(bookmarksDir)).filter(f => f.endsWith('.json') && !f.endsWith('.bak') && !f.includes('registry'));
    let persistedBookmark = null;
    for (const f of persistedFiles) {
      const data = JSON.parse(await fs.readFile(path.join(bookmarksDir, f), 'utf8'));
      const found = (data.bookmarks ?? []).find(b => b.id === bookmarkId);
      if (found) { persistedBookmark = found; break; }
    }
    if (!persistedBookmark) throw new Error('persisted bookmark not found in .bookmarks/local');
    // Storage is 0-based regardless of anchor kind. Check whichever line field this kind uses.
    const persistedLine = persistedBookmark.anchor.kind === 'point'
      ? persistedBookmark.anchor.line
      : persistedBookmark.anchor.kind === 'range'
        ? persistedBookmark.anchor.start.line
        : persistedBookmark.anchor.lastUpdatedLine;
    assertEqual(persistedLine, wireLine - 1,
      `persisted anchor line (kind=${persistedBookmark.anchor.kind}) must be 0-based (wire 5 -> stored 4)`);

    // 3. bookmark_list returns 1-based on the wire
    const listRes = parseToolText(await client.callTool({
      name: 'bookmark_list',
      arguments: { query: bookmarkId },
      _meta: { rootUris: [rootUri] },
    }));
    const listed = listRes.bookmarks?.find(b => b.bookmark.id === bookmarkId);
    if (!listed) throw new Error('bookmark_list missing the new bookmark');
    assertEqual(listed.bookmark.anchor.line, wireLine,
      'bookmark_list anchor.line must equal the 1-based wire input');

    // 4a. bookmark_search full mode
    const searchFullRes = parseToolText(await client.callTool({
      name: 'bookmark_search',
      arguments: { text: 'target marker', resultsMode: 'full' },
      _meta: { rootUris: [rootUri] },
    }));
    const searchFullEntry = searchFullRes.results?.find(r => r.bookmark?.id === bookmarkId);
    if (!searchFullEntry) throw new Error('bookmark_search full mode missing entry');
    assertEqual(searchFullEntry.bookmark.anchor.line, wireLine,
      'bookmark_search full-mode anchor.line must be 1-based');

    // 4b. bookmark_search lineNumbers mode
    const searchLNRes = parseToolText(await client.callTool({
      name: 'bookmark_search',
      arguments: { text: 'target marker', resultsMode: 'lineNumbers' },
      _meta: { rootUris: [rootUri] },
    }));
    const lnEntry = searchLNRes.results?.find(r => r.uri === fileUri);
    if (!lnEntry) throw new Error('bookmark_search lineNumbers mode missing entry');
    assertEqual(lnEntry.line, wireLine,
      'bookmark_search lineNumbers-mode line must be 1-based');

    // 5. Cross-tool agreement: anchor_validate and bookmark_list report the same 1-based line.
    const validateRes = parseToolText(await client.callTool({
      name: 'anchor_validate',
      arguments: { uri: fileUri },
      _meta: { rootUris: [rootUri] },
    }));
    const validateEntry = validateRes.results?.find(r => r.bookmarkId === bookmarkId);
    if (!validateEntry) throw new Error('anchor_validate missing entry');
    assertEqual(validateEntry.line, wireLine,
      'anchor_validate.line must equal the 1-based wire input');
    assertEqual(validateEntry.line, listed.bookmark.anchor.line,
      'anchor_validate and bookmark_list must agree on the 1-based line');

    // 6. Bounds: line < 1 should clamp to 1 (normalize, not crash)
    const lowRes = parseToolText(await client.callTool({
      name: 'bookmark_add',
      arguments: {
        uri: fileUri,
        label: 'low-bounds',
        anchor: { kind: 'point', line: 0 },
        anchorType: 'point',
        groupName: 'OneBasedTest',
      },
      _meta: { rootUris: [rootUri] },
    }));
    if (!lowRes.success) throw new Error(`bookmark_add (line=0) unexpectedly failed: ${JSON.stringify(lowRes)}`);

    // Confirm the clamped bookmark resolves to wire line 1
    const listLow = parseToolText(await client.callTool({
      name: 'bookmark_list',
      arguments: { query: lowRes.bookmarkId },
      _meta: { rootUris: [rootUri] },
    }));
    const lowListed = listLow.bookmarks?.find(b => b.bookmark.id === lowRes.bookmarkId);
    assertEqual(lowListed.bookmark.anchor.line, 1,
      'bookmark_add(line=0) should be clamped to wire line 1 (internal 0)');

    console.log('OK: bookmark-tools 1-based wire agreement verified');
    console.log(`  - grep -n: line ${grepLine}`);
    console.log(`  - bookmark_add accepted line ${wireLine}`);
    console.log(`  - persisted anchor.line: ${persistedBookmark.anchor.line} (0-based)`);
    console.log(`  - bookmark_list anchor.line: ${listed.bookmark.anchor.line} (1-based wire)`);
    console.log(`  - bookmark_search (full): ${searchFullEntry.bookmark.anchor.line}`);
    console.log(`  - bookmark_search (lineNumbers): ${lnEntry.line}`);
    console.log(`  - anchor_validate.line: ${validateEntry.line}`);
    console.log(`  - clamp: line=0 normalized to wire ${lowListed.bookmark.anchor.line}`);
  } finally {
    await client.close();
    await fs.rm(wsRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
