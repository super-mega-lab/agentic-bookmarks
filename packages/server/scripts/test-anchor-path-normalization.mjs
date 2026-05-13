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

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
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

async function main() {
  const repoRoot = path.resolve(path.join(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname), '../../..'));
  const serverEntry = path.resolve(repoRoot, 'packages/server/dist/index.cjs');
  if (!(await fileExists(serverEntry))) {
    throw new Error(`Server build not found at ${serverEntry}. Run \"pnpm --filter @agentic-bookmarks/server build\" first.`);
  }

  const wsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmarks-anchor-paths-'));
  const srcDir = path.join(wsRoot, 'src');
  await fs.mkdir(srcDir, { recursive: true });
  const sourceFile = path.join(srcDir, 'sample.ts');
  await fs.writeFile(
    sourceFile,
    [
      'export function hello() {',
      '  const value = 1;',
      '  return value;',
      '}',
      '',
    ].join('\n'),
    'utf8'
  );

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
    env: {
      ...process.env,
      BOOKMARKS_DIR: wsRoot,
    },
  });

  const client = new Client(
    { name: 'anchor-path-smoke', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } }
  );
  await client.connect(transport);

  try {
    const addRes = await client.callTool({
      name: 'bookmark_add',
      arguments: {
        uri: fileUri,
        label: 'anchor-path-test',
        anchor: { kind: 'point', line: 1 },
        groupName: 'Path Norm',
      },
      _meta: { rootUris: [rootUri] },
    });
    const addData = parseToolText(addRes);
    const bookmarkId = addData.bookmarkId;
    if (!bookmarkId) throw new Error(`bookmark_add missing bookmarkId: ${JSON.stringify(addData)}`);

    const diffRes = await client.callTool({
      name: 'anchor_getFileDiff',
      arguments: { bookmarkId },
      _meta: { rootUris: [rootUri] },
    });
    const diffData = parseToolText(diffRes);
    if (!diffData.success) {
      throw new Error(`anchor_getFileDiff failed: ${JSON.stringify(diffData)}`);
    }

    const packageRes = await client.callTool({
      name: 'anchor_getRepairPackage',
      arguments: { uri: 'src/sample.ts', bookmarkIds: [bookmarkId] },
      _meta: { rootUris: [rootUri] },
    });
    const packageData = parseToolText(packageRes);
    if (!packageData.success) {
      throw new Error(`anchor_getRepairPackage failed: ${JSON.stringify(packageData)}`);
    }
    if (typeof packageData.note !== 'string' || !packageData.note.includes('anchor_getRepairSkillGuide')) {
      throw new Error(`Expected guide reminder note before reading guide, got: ${JSON.stringify(packageData.note)}`);
    }
    if (!Array.isArray(packageData.packages) || packageData.packages.length !== 1) {
      throw new Error(`Expected 1 repair package for relative URI, got: ${JSON.stringify(packageData.summary)}`);
    }

    const guideRes = await client.callTool({
      name: 'anchor_getRepairSkillGuide',
      arguments: {},
      _meta: { rootUris: [rootUri] },
    });
    if (!guideRes?.content?.[0]?.text?.includes?.('Anchor Repair Guide')) {
      throw new Error('Expected anchor_getRepairSkillGuide to return guide content');
    }

    const legacyRes = await client.callTool({
      name: 'anchor_getRepairPackage',
      arguments: { uri: 'src/sample.ts', bookmarkIds: [bookmarkId], includeHints: false },
      _meta: { rootUris: [rootUri] },
    });
    const legacyData = parseToolText(legacyRes);
    if (legacyData.note !== undefined) {
      throw new Error(`Expected guide reminder note to be omitted after guide call, got: ${JSON.stringify(legacyData.note)}`);
    }
    if (legacyData.packages[0]?.diagnostics !== undefined) {
      throw new Error('Legacy repair package unexpectedly included diagnostics without includeHints=true');
    }

    // -----------------------------------------------------------------------
    // Hints validation: smart anchor with stale context but matching lineCache
    // -----------------------------------------------------------------------
    const hintsFile = path.join(srcDir, 'hints.ts');
    await fs.writeFile(
      hintsFile,
      [
        'alpha',
        'bridge',
        'omega',
        '',
        'beforeReal',
        'target line',
        'afterReal',
      ].join('\n'),
      'utf8'
    );
    const hintsFileUri = `file://${hintsFile}`;

    const addSmartRes = await client.callTool({
      name: 'bookmark_add',
      arguments: {
        uri: hintsFileUri,
        label: 'hints-smart-anchor',
        anchor: { kind: 'point', line: 5 },
        anchorType: 'smart',
        groupName: 'Path Norm',
      },
      _meta: { rootUris: [rootUri] },
    });
    const addSmartData = parseToolText(addSmartRes);
    const smartBookmarkId = addSmartData.bookmarkId;
    if (!smartBookmarkId) throw new Error(`smart bookmark_add missing bookmarkId: ${JSON.stringify(addSmartData)}`);

    const registryPath = path.join(wsRoot, '.vscode', 'bookmarks.registry.json');
    const registry = await readJson(registryPath);
    let bookmarkDataPath = null;
    for (const fileEntry of registry.files || []) {
      const candidatePath = path.isAbsolute(fileEntry.path)
        ? fileEntry.path
        : path.join(wsRoot, fileEntry.path);
      const data = await readJson(candidatePath);
      if (Array.isArray(data.bookmarks) && data.bookmarks.some(b => b.id === smartBookmarkId)) {
        bookmarkDataPath = candidatePath;
        break;
      }
    }
    if (!bookmarkDataPath) throw new Error(`Could not locate bookmark data file for ${smartBookmarkId}`);

    const bookmarkData = await readJson(bookmarkDataPath);
    const targetBookmark = bookmarkData.bookmarks.find(b => b.id === smartBookmarkId);
    if (!targetBookmark) throw new Error(`Bookmark ${smartBookmarkId} not found in ${bookmarkDataPath}`);
    if (targetBookmark.anchor?.kind !== 'smart') {
      throw new Error(`Expected smart anchor, got ${targetBookmark.anchor?.kind}`);
    }

    // Force a known stale context profile:
    // - lineCache still matches "target line" at line 5
    // - context points to alpha/omega which now match best around line 1
    targetBookmark.anchor.lineCache = 'target line';
    targetBookmark.anchor.contextBefore = ['alpha'];
    targetBookmark.anchor.contextAfter = ['omega'];
    targetBookmark.anchor.lastUpdatedLine = 5;
    targetBookmark.anchor.nonce = (targetBookmark.anchor.nonce ?? 0) + 1;
    await writeJson(bookmarkDataPath, bookmarkData);

    const hintsRes = await client.callTool({
      name: 'anchor_getRepairPackage',
      arguments: {
        uri: 'src/hints.ts',
        bookmarkIds: [smartBookmarkId],
        includeHints: true,
        hintWindowRadius: 4,
      },
      _meta: { rootUris: [rootUri] },
    });
    const hintsData = parseToolText(hintsRes);
    if (!hintsData.success || !Array.isArray(hintsData.packages) || hintsData.packages.length !== 1) {
      throw new Error(`Expected one hints package, got: ${JSON.stringify(hintsData)}`);
    }

    const diagnostics = hintsData.packages[0].diagnostics;
    if (!diagnostics) throw new Error('Expected diagnostics for includeHints=true smart anchor');
    if (!diagnostics.scoring?.bestCandidate) {
      throw new Error(`Expected scoring.bestCandidate in diagnostics: ${JSON.stringify(diagnostics)}`);
    }
    if (!diagnostics.closestByLineCache) {
      throw new Error(`Expected closestByLineCache in diagnostics: ${JSON.stringify(diagnostics)}`);
    }
    if (!diagnostics.closestByContext) {
      throw new Error(`Expected closestByContext in diagnostics: ${JSON.stringify(diagnostics)}`);
    }
    if (!diagnostics.surroundingContentByLineCacheClosest) {
      throw new Error(`Expected surroundingContentByLineCacheClosest: ${JSON.stringify(diagnostics)}`);
    }
    if (!diagnostics.surroundingContentByContextClosest) {
      throw new Error(`Expected surroundingContentByContextClosest: ${JSON.stringify(diagnostics)}`);
    }

    if (diagnostics.scoring.bestCandidate.finalScore >= diagnostics.threshold) {
      throw new Error(`Expected stale-context candidate to be below threshold: ${JSON.stringify(diagnostics.scoring.bestCandidate)}`);
    }

    console.log('✅ Anchor path normalization smoke test passed');
  } finally {
    await client.close();
    await fs.rm(wsRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('❌ Anchor path normalization smoke test failed:', err);
  process.exit(1);
});
