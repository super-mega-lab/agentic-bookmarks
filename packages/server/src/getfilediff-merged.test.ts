import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  createWorkspaceInfo,
  emptyFileV2,
  addFileToRegistry,
  type Bookmark,
} from '@agentic-bookmarks/core';
import { handleGetFileDiff } from './anchor-git-tools';
import { handleAnchorGetFileDiffTool } from './tools/anchor-git';

// ---------------------------------------------------------------------------
// SML-1466 end-to-end: a `promptOutput$` setter (and its sibling `output$`) are
// merged into a single `emitData(type, data)` method in the next commit. The
// setter declaration has no exact/fuzzy match (-> core `no_match`) and its body
// is multi-statement (so it is NOT `inlined`), but its key expressions survive
// inside emitData. anchor_getFileDiff should diagnose `merged`, pointing at the
// emitData declaration.
// ---------------------------------------------------------------------------

const REL_PATH = 'src/task.ts';
const SETTER_DECL = '  set promptOutput$(data: string) {';
const SETTER_DECL_LINE = 10; // 0-based line of the setter declaration at commit 1

const COMMIT_1 = [
  'export class TaskWrapper {',                                          // 0
  '  private listr: any = { events: { emit(_x: string) {} } };',        // 1
  "  private task = { output$: '', promptOutput$: '' };",               // 2
  '',                                                                   // 3
  '  set output$(data: string) {',                                      // 4
  '    this.task.output$ = data;',                                      // 5
  '    this.emit(ListrTaskEventType.OUTPUT, data);',                    // 6
  '    this.listr.events.emit(ListrEventType.SHOULD_REFRESH_RENDER);',  // 7
  '  }',                                                                // 8
  '',                                                                   // 9
  '  set promptOutput$(data: string) {',                                // 10  <- bookmarked
  '    this.emit(ListrTaskEventType.PROMPT, data);',                    // 11
  '    if (cleanseAnsi(data)) {',                                       // 12
  '      this.listr.events.emit(ListrEventType.SHOULD_REFRESH_RENDER);',// 13
  '    }',                                                              // 14
  '  }',                                                                // 15
  '',                                                                   // 16
  '  emit(type: string, data: string): void {}',                       // 17
  '}',                                                                  // 18
  '',
].join('\n');

// Both setters merged into one emitData(); call-shaped lines reindented so git
// records them as additions (they still *contain* the deleted body fragments).
const COMMIT_2 = [
  'export class TaskWrapper {',                                          // 0
  '  private listr: any = { events: { emit(_x: string) {} } };',        // 1
  "  private task = { output$: '', promptOutput$: '' };",               // 2
  '',                                                                   // 3
  '  public emitData(type: "output" | "prompt", data: string): void {', // 4  <- merge target
  '    if (type === "output") {',                                       // 5
  '      this.task.output$ = data;',                                    // 6
  '      this.emit(ListrTaskEventType.OUTPUT, data);',                  // 7
  '    } else {',                                                       // 8
  '      this.emit(ListrTaskEventType.PROMPT, data);',                  // 9
  '    }',                                                              // 10
  '    if (type === "output" || cleanseAnsi(data)) {',                  // 11
  '      this.listr.events.emit(ListrEventType.SHOULD_REFRESH_RENDER);',// 12
  '    }',                                                              // 13
  '  }',                                                                // 14
  '',                                                                   // 15
  '  emit(type: string, data: string): void {}',                       // 16
  '}',                                                                  // 17
  '',
].join('\n');

const MERGED_DECL_LINE_0BASED = 4; // emitData declaration in COMMIT_2

function git(repo: string, cmd: string): void {
  execSync(cmd, { cwd: repo, stdio: 'pipe' });
}

describe('anchor_getFileDiff merged detection (SML-1466)', () => {
  let repoPath: string;

  beforeAll(async () => {
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'getfilediff-merged-'));
    git(repoPath, 'git init');
    git(repoPath, 'git config user.email "test@test.com"');
    git(repoPath, 'git config user.name "Test User"');

    await fs.mkdir(path.join(repoPath, 'src'), { recursive: true });
    await fs.writeFile(path.join(repoPath, REL_PATH), COMMIT_1);
    git(repoPath, 'git add src/task.ts');
    git(repoPath, 'git commit -m "add TaskWrapper with output$/promptOutput$ setters"');

    await fs.writeFile(path.join(repoPath, REL_PATH), COMMIT_2);
    git(repoPath, 'git add src/task.ts');
    git(repoPath, 'git commit -m "merge output$/promptOutput$ setters into emitData()"');
  });

  afterAll(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  function makeBookmark(): Bookmark {
    return {
      id: '01MERGED0000000000000000001',
      fileId: '01MERGED0000000000000000002',
      groupId: '01MERGED0000000000000000003',
      target: { uri: REL_PATH },
      anchor: {
        kind: 'smart',
        lineCache: SETTER_DECL,
        lastUpdatedLine: SETTER_DECL_LINE,
        contextBefore: [],
        contextAfter: [],
        nonce: 0,
      },
      label: 'promptOutput$ setter',
      createdAt: 0,
    } as Bookmark;
  }

  it('diagnoses the merged setter via handleGetFileDiff (0-based internal)', async () => {
    const currentLines = COMMIT_2.split('\n');
    const dataFilePath = path.join(repoPath, '.vscode', 'bookmarks.json');

    const result = await handleGetFileDiff(makeBookmark(), repoPath, REL_PATH, currentLines, dataFilePath);

    expect(result.success).toBe(true);
    expect(result.diagnosis).toBe('merged');
    const detail = result.detail as any;
    expect(detail.deletedSymbol).toBe('promptOutput$');
    expect(detail.mergedInto.symbol).toBe('emitData');
    expect(detail.mergedInto.line).toBe(MERGED_DECL_LINE_0BASED);
    expect(detail.mergedInto.content).toContain('emitData');
    expect(detail.mergedInto.confidence).toBe('medium');
    expect(detail.candidates).toHaveLength(1);
    expect(detail.candidates[0].matchedFragments.length).toBeGreaterThanOrEqual(2);
  });

  it('reports the merge target 1-based through the tool wrapper', async () => {
    const fileData: any = emptyFileV2({ isLocal: true });
    const absFilePath = path.join(repoPath, '.bookmarks', 'shared', 'shared.json');
    await fs.mkdir(path.dirname(absFilePath), { recursive: true });
    const bm = makeBookmark();
    fileData.bookmarks.push({
      id: bm.id,
      fileId: fileData.fileId,
      groupId: fileData.groups[0].id,
      target: { uri: REL_PATH },
      anchor: bm.anchor,
      label: bm.label,
      createdAt: Date.now(),
    });
    await fs.writeFile(absFilePath, JSON.stringify(fileData, null, 2), 'utf8');
    await addFileToRegistry(repoPath, absFilePath);

    const ctx: any = {
      workspaceRoot: repoPath,
      workspaces: [createWorkspaceInfo(repoPath)],
      lastInitMeta: null,
      lastInitRootUris: undefined,
      hasServedRepairSkillGuide: false,
    };

    const response = await handleAnchorGetFileDiffTool(ctx, { bookmarkId: bm.id });
    const parsed = JSON.parse(response.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.diagnosis).toBe('merged');
    // 0-based internal line 4 -> 1-based wire line 5.
    expect(parsed.detail.mergedInto.line).toBe(MERGED_DECL_LINE_0BASED + 1);
    expect(parsed.detail.mergedInto.symbol).toBe('emitData');
  });
});
