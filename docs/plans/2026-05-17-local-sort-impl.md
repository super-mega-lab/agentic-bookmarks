# Local sorting — implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-view sort modes (`default` / `user` / `recent`) and drag-and-drop reordering to the `All Bookmarks` and `Files & Groups` tree views, persisting user ranks to `.bookmarks/local/.cache/ordering.json` per workspace.

**Architecture:** A small `ordering/` module owns the index scheme (sparse integers behind `rank.ts`), the per-workspace cache (`store.ts` with `.bak` recovery), the in-memory state + debounced writes (`service.ts`), pure sort + validation (`applySort.ts`, `dnd-validation.ts`), and a shared `TreeDragAndDropController` helper (`dnd-controller.ts`). Both providers receive the `OrderingService` and use `applySort` in `getChildren`. A hidden dev setting `agenticBookmarks.dev.enableMultiSelectDrag` gates `canSelectMany`.

**Tech Stack:** TypeScript, VS Code Extension API (`TreeDragAndDropController`, `DataTransfer`), vitest (test runner: `pnpm test` at repo root; typecheck: `pnpm typecheck`).

**Companion design doc:** `docs/plans/2026-05-16-local-sort-design.md`. Read it before starting — it is the source of truth for rationale and risks. This plan is the step-by-step execution.

**Repo conventions to follow:**
- Tests live next to source as `*.test.ts`, use `vitest` (`describe`/`it`/`expect`).
- Imports of core helpers come from `@agentic-bookmarks/core`.
- Run `pnpm typecheck` after every TS change and `pnpm test` after every test add/change.
- Commit after each task with a focused message. Plan filename + branch is `user-sorting`.

---

## Task 0: Re-read the design doc and the drag-and-drop primer

**Files:**
- Read: `docs/plans/2026-05-16-local-sort-design.md`
- Read: `/Users/afoster/Documents/sml/agentic-bookmarks-core/docs/guides/treeview-drag-and-drop-primer.md`

**Step 1:** Read both files end to end. Note any gotcha in the primer that the design doc doesn't already cover (e.g. mime-type registration, async drop ordering, multi-source drag specifics).

**Step 2:** If anything in the primer contradicts the design, **stop and surface it to the user before continuing**. Do not silently deviate.

**No commit for this task.**

---

## Task 1: Scaffold the `ordering/` module with types

**Files:**
- Create: `packages/extension/src/ordering/types.ts`

**Step 1: Write the file**

```ts
// packages/extension/src/ordering/types.ts

/**
 * Sort/ordering data model. See docs/plans/2026-05-16-local-sort-design.md.
 *
 * Context keys identify which "slot" a rank applies to:
 *   'a' — All Bookmarks, flat (showFiles=false): bookmarks sorted relative to all visible bookmarks
 *   'f' — within-file: bookmarks under a file (All Bookmarks showFiles=true), groups under a file (F&G),
 *         bookmark-files under a workspace (F&G)
 *   'g' — within-group: bookmarks under a group (F&G showBookmarks=true)
 */
export type ContextKey = 'a' | 'f' | 'g';

export type EntityKind = 'bookmark' | 'file' | 'group' | 'bookmarkFile';

export type RankRecord = Partial<Record<ContextKey, number>>;

export interface OrderingCache {
  bookmarks:     Record<string, RankRecord>;
  files:         Record<string, RankRecord>;
  groups:        Record<string, RankRecord>;
  bookmarkFiles: Record<string, RankRecord>;
}

export function emptyOrderingCache(): OrderingCache {
  return { bookmarks: {}, files: {}, groups: {}, bookmarkFiles: {} };
}

export type SortMode = 'default' | 'user' | 'recent';

/** On-disk serialized form — arrays sorted by id for stable diffs. */
export interface OrderingFileV1 {
  v: 1;
  bookmarks:     Array<{ id: string; ranks: RankRecord }>;
  files:         Array<{ id: string; ranks: RankRecord }>;
  groups:        Array<{ id: string; ranks: RankRecord }>;
  bookmarkFiles: Array<{ id: string; ranks: RankRecord }>;
}
```

**Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

**Step 3: Commit**

```bash
git add packages/extension/src/ordering/types.ts
git commit -m "ordering: add types module (cache, ranks, sort mode)"
```

---

## Task 2: `rank.ts` — failing test for `assignRankBetween`

**Files:**
- Create: `packages/extension/src/ordering/rank.test.ts`

**Step 1: Write the failing tests**

```ts
// packages/extension/src/ordering/rank.test.ts
import { describe, it, expect } from 'vitest';
import { assignRankBetween, RANK_STEP } from './rank';

describe('assignRankBetween', () => {
  it('returns RANK_STEP when both neighbors are null (empty list)', () => {
    expect(assignRankBetween(null, null)).toBe(RANK_STEP);
  });

  it('returns prev + RANK_STEP when next is null (append)', () => {
    expect(assignRankBetween(500, null)).toBe(500 + RANK_STEP);
  });

  it('returns next - RANK_STEP when prev is null (prepend) when room exists', () => {
    expect(assignRankBetween(null, 1000)).toBe(1000 - RANK_STEP);
  });

  it('returns midpoint between two ranks', () => {
    expect(assignRankBetween(100, 300)).toBe(200);
  });

  it('handles non-even midpoints by flooring', () => {
    // 100..201 → midpoint floor((100+201)/2) = 150
    expect(assignRankBetween(100, 201)).toBe(150);
  });
});
```

**Step 2: Run, expect FAIL (module not present)**

Run: `pnpm test -- packages/extension/src/ordering/rank.test.ts`
Expected: FAIL — cannot find module `./rank`.

**No commit yet — test stays uncommitted until paired with impl in next task.**

---

## Task 3: `rank.ts` — implement `assignRankBetween` to pass

**Files:**
- Create: `packages/extension/src/ordering/rank.ts`

**Step 1: Write the implementation**

```ts
// packages/extension/src/ordering/rank.ts
import type { ContextKey } from './types';
import type { OrderingService } from './service';

export const RANK_STEP = 100;
const MIN_GAP = 2;

/**
 * Return a new rank that sorts between `prev` and `next`. Either may be null
 * (append/prepend/empty). Caller is responsible for ensuring there is room —
 * see `ensureRoomBetween` which routes through rebalance when the gap
 * collapses below MIN_GAP.
 */
export function assignRankBetween(prev: number | null, next: number | null): number {
  if (prev == null && next == null) return RANK_STEP;
  if (next == null) return prev! + RANK_STEP;
  if (prev == null) return next - RANK_STEP;
  return Math.floor((prev + next) / 2);
}
```

**Step 2: Run tests, expect PASS**

Run: `pnpm test -- packages/extension/src/ordering/rank.test.ts`
Expected: all 5 tests pass.

**Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

**Step 4: Commit**

```bash
git add packages/extension/src/ordering/rank.ts packages/extension/src/ordering/rank.test.ts
git commit -m "ordering: add assignRankBetween with sparse-integer scheme"
```

---

## Task 4: `rank.ts` — `ensureRanksAround` failing tests

**Files:**
- Modify: `packages/extension/src/ordering/rank.test.ts`

**Step 1: Add a sibling-shaped test fixture and tests**

Add to the test file:

```ts
import { ensureRanksAround, rebalance } from './rank';

// Minimal "sibling" shape — id + getRank/setRank callbacks let us test rank.ts
// without instantiating OrderingService.
type Sib = { id: string; rank: number | null };

function siblings(...ids: Array<[string, number | null]>): Sib[] {
  return ids.map(([id, rank]) => ({ id, rank }));
}

const getRank = (s: Sib) => s.rank;
const setRank = (s: Sib, r: number) => { s.rank = r; };

describe('ensureRanksAround', () => {
  it('no-op when all siblings already ranked', () => {
    const sibs = siblings(['a', 100], ['b', 200], ['c', 300]);
    ensureRanksAround(sibs, 1, getRank, setRank);
    expect(sibs.map(s => s.rank)).toEqual([100, 200, 300]);
  });

  it('promotes unranked items between two ranked neighbors evenly', () => {
    const sibs = siblings(['a', 100], ['x', null], ['y', null], ['b', 400]);
    ensureRanksAround(sibs, 1, getRank, setRank);
    // a=100, x=200, y=300, b=400 (evenly distributed in the gap)
    expect(sibs.map(s => s.rank)).toEqual([100, 200, 300, 400]);
  });

  it('promotes a leading unranked stretch using RANK_STEP from the right anchor', () => {
    const sibs = siblings(['x', null], ['y', null], ['a', 300]);
    ensureRanksAround(sibs, 0, getRank, setRank);
    // y=200, x=100, a=300  (anchored to a's 300, stepped backward)
    expect(sibs[2].rank).toBe(300);
    expect(sibs[1].rank).toBe(200);
    expect(sibs[0].rank).toBe(100);
  });

  it('promotes a trailing unranked stretch using RANK_STEP from the left anchor', () => {
    const sibs = siblings(['a', 100], ['x', null], ['y', null]);
    ensureRanksAround(sibs, 1, getRank, setRank);
    expect(sibs.map(s => s.rank)).toEqual([100, 200, 300]);
  });

  it('promotes a fully unranked list using fresh RANK_STEP spacing', () => {
    const sibs = siblings(['x', null], ['y', null], ['z', null]);
    ensureRanksAround(sibs, 1, getRank, setRank);
    expect(sibs.map(s => s.rank)).toEqual([100, 200, 300]);
  });

  it('triggers rebalance when there is no room for the unranked items', () => {
    // gap between 100 and 102 is only 2; two unranked items between them can't fit.
    const sibs = siblings(['a', 100], ['x', null], ['y', null], ['b', 102]);
    ensureRanksAround(sibs, 1, getRank, setRank);
    // After rebalance: evenly spaced at RANK_STEP across all 4
    expect(sibs.map(s => s.rank)).toEqual([100, 200, 300, 400]);
  });
});

describe('rebalance', () => {
  it('re-spaces all siblings at RANK_STEP intervals starting from RANK_STEP', () => {
    const sibs = siblings(['a', 1], ['b', 2], ['c', 3]);
    rebalance(sibs, setRank);
    expect(sibs.map(s => s.rank)).toEqual([100, 200, 300]);
  });
});
```

**Step 2: Run, expect FAIL (functions not exported)**

Run: `pnpm test -- packages/extension/src/ordering/rank.test.ts`
Expected: FAIL — `ensureRanksAround` / `rebalance` not exported.

**No commit yet — paired with next task.**

---

## Task 5: `rank.ts` — implement `ensureRanksAround` and `rebalance`

**Files:**
- Modify: `packages/extension/src/ordering/rank.ts`

**Step 1: Add to rank.ts**

```ts
/**
 * Walk a sibling list and assign sparse-integer ranks to any unranked items
 * in the local neighborhood of `insertIdx`. Only the contiguous unranked
 * stretch around the insertion point is touched — distant items are left
 * alone so a drop near the top of a long list doesn't promote the bottom.
 *
 * If the available gap between the bounding ranked siblings is too narrow
 * to fit all the unranked items at MIN_GAP spacing, the *entire* sibling
 * list is rebalanced and the function returns.
 *
 * Generic over sibling shape so callers can pass either provider tree nodes
 * or test fixtures.
 */
export function ensureRanksAround<S>(
  siblings: S[],
  insertIdx: number,
  getRank: (s: S) => number | null,
  setRank: (s: S, rank: number) => void,
): void {
  if (siblings.length === 0) return;

  // Walk left from insertIdx to find left anchor (a ranked sibling, or off-list).
  let leftIdx = Math.max(0, insertIdx - 1);
  while (leftIdx >= 0 && getRank(siblings[leftIdx]) == null) leftIdx--;
  // Walk right from insertIdx to find right anchor.
  let rightIdx = insertIdx;
  while (rightIdx < siblings.length && getRank(siblings[rightIdx]) == null) rightIdx++;

  const leftRank  = leftIdx  >= 0                ? getRank(siblings[leftIdx])  : null;
  const rightRank = rightIdx < siblings.length   ? getRank(siblings[rightIdx]) : null;

  // Count of unranked items strictly between leftIdx and rightIdx (exclusive of anchors).
  const startUnranked = leftIdx + 1;
  const endUnranked   = rightIdx - 1;
  const unrankedCount = endUnranked - startUnranked + 1;
  if (unrankedCount <= 0) return;

  // Decide if there is room. If both anchors are ranked, gap must fit (unrankedCount+1) slots.
  if (leftRank != null && rightRank != null) {
    const gap = rightRank - leftRank;
    if (gap < (unrankedCount + 1) * MIN_GAP) {
      // No room — rebalance the entire sibling list and bail.
      rebalance(siblings, setRank);
      return;
    }
    const step = Math.floor(gap / (unrankedCount + 1));
    for (let i = 0; i < unrankedCount; i++) {
      setRank(siblings[startUnranked + i], leftRank + step * (i + 1));
    }
    return;
  }

  if (leftRank != null) {
    // Trailing unranked stretch — step forward by RANK_STEP.
    for (let i = 0; i < unrankedCount; i++) {
      setRank(siblings[startUnranked + i], leftRank + RANK_STEP * (i + 1));
    }
    return;
  }

  if (rightRank != null) {
    // Leading unranked stretch — step backward by RANK_STEP.
    for (let i = 0; i < unrankedCount; i++) {
      const distFromRight = unrankedCount - i;
      setRank(siblings[startUnranked + i], rightRank - RANK_STEP * distFromRight);
    }
    return;
  }

  // Fully unranked list — fresh RANK_STEP spacing from RANK_STEP up.
  for (let i = 0; i < unrankedCount; i++) {
    setRank(siblings[startUnranked + i], RANK_STEP * (i + 1));
  }
}

/** Re-space every sibling at RANK_STEP intervals starting from RANK_STEP. */
export function rebalance<S>(siblings: S[], setRank: (s: S, rank: number) => void): void {
  for (let i = 0; i < siblings.length; i++) {
    setRank(siblings[i], RANK_STEP * (i + 1));
  }
}
```

**Step 2: Run tests, expect PASS**

Run: `pnpm test -- packages/extension/src/ordering/rank.test.ts`
Expected: all tests pass (including the rebalance-on-collapse case).

**Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add packages/extension/src/ordering/rank.ts packages/extension/src/ordering/rank.test.ts
git commit -m "ordering: add ensureRanksAround and rebalance helpers"
```

---

## Task 6: `store.ts` — failing tests for load/save round-trip and .bak recovery

**Files:**
- Create: `packages/extension/src/ordering/store.test.ts`

**Step 1: Write failing tests**

```ts
// packages/extension/src/ordering/store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadOrderingCache, saveOrderingCache, ORDERING_FILE_NAME } from './store';
import { emptyOrderingCache, type OrderingCache } from './types';

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

describe('ordering store', () => {
  let dir: string;
  let file: string;
  let bak: string;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ord-')));
    file = path.join(dir, ORDERING_FILE_NAME);
    bak  = file + '.bak';
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('returns an empty cache when no file exists', async () => {
    const cache = await loadOrderingCache(dir);
    expect(cache).toEqual(emptyOrderingCache());
  });

  it('round-trips a non-empty cache', async () => {
    const cache: OrderingCache = {
      bookmarks: { 'B1': { f: 100, a: 200 } },
      files:     { 'F1': { a: 100 } },
      groups:    { 'G1': { f: 200 } },
      bookmarkFiles: { 'BF1': { f: 300 } },
    };
    await saveOrderingCache(dir, cache);
    const loaded = await loadOrderingCache(dir);
    expect(loaded).toEqual(cache);
  });

  it('writes a .bak copy of the previous file before each save', async () => {
    const c1: OrderingCache = { ...emptyOrderingCache(), bookmarks: { B: { a: 100 } } };
    const c2: OrderingCache = { ...emptyOrderingCache(), bookmarks: { B: { a: 200 } } };
    await saveOrderingCache(dir, c1);
    expect(await exists(bak)).toBe(false); // no bak before second write
    await saveOrderingCache(dir, c2);
    expect(await exists(bak)).toBe(true);
    const bakTxt = await fs.readFile(bak, 'utf8');
    expect(JSON.parse(bakTxt).bookmarks[0].ranks.a).toBe(100);
  });

  it('recovers from .bak when the main file is corrupt', async () => {
    const c: OrderingCache = { ...emptyOrderingCache(), bookmarks: { B: { a: 100 } } };
    await saveOrderingCache(dir, c);
    // Corrupt the main file. The previous save wrote no bak; manually stage one.
    await fs.copyFile(file, bak);
    await fs.writeFile(file, '{ this is not valid json', 'utf8');
    const loaded = await loadOrderingCache(dir);
    expect(loaded.bookmarks['B'].a).toBe(100);
    // Main file should also be restored from .bak.
    const restored = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(restored.bookmarks[0].ranks.a).toBe(100);
  });

  it('returns empty cache when both main and .bak are corrupt', async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, 'garbage', 'utf8');
    await fs.writeFile(bak, 'also garbage', 'utf8');
    const loaded = await loadOrderingCache(dir);
    expect(loaded).toEqual(emptyOrderingCache());
  });
});
```

**Step 2: Run, expect FAIL (module not present)**

Run: `pnpm test -- packages/extension/src/ordering/store.test.ts`
Expected: FAIL.

---

## Task 7: `store.ts` — implement load/save with .bak recovery

**Files:**
- Create: `packages/extension/src/ordering/store.ts`

**Step 1: Write the implementation**

```ts
// packages/extension/src/ordering/store.ts
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { emptyOrderingCache, type OrderingCache, type OrderingFileV1, type RankRecord } from './types';

export const ORDERING_FILE_NAME = 'ordering.json';

function toRecord(arr: Array<{ id: string; ranks: RankRecord }>): Record<string, RankRecord> {
  const out: Record<string, RankRecord> = {};
  for (const { id, ranks } of arr) out[id] = ranks;
  return out;
}

function toArray(rec: Record<string, RankRecord>): Array<{ id: string; ranks: RankRecord }> {
  return Object.entries(rec)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, ranks]) => ({ id, ranks }));
}

function parse(txt: string): OrderingCache | null {
  try {
    const json = JSON.parse(txt) as OrderingFileV1;
    if (!json || json.v !== 1) return null;
    return {
      bookmarks:     toRecord(json.bookmarks ?? []),
      files:         toRecord(json.files ?? []),
      groups:        toRecord(json.groups ?? []),
      bookmarkFiles: toRecord(json.bookmarkFiles ?? []),
    };
  } catch {
    return null;
  }
}

/**
 * Load the ordering cache from `<cacheDir>/ordering.json`. Recovery order:
 *   1. main file parses → return it
 *   2. main missing → empty cache (silent)
 *   3. main corrupt, .bak parses → restore main from .bak, return parsed
 *   4. both corrupt → empty cache, log warning
 *
 * Mirrors the inline pattern in @agentic-bookmarks/core's store_v2.ts; kept
 * local because we don't need the lockfile/pulse machinery for a single-
 * process cache.
 */
export async function loadOrderingCache(cacheDir: string): Promise<OrderingCache> {
  const file = path.join(cacheDir, ORDERING_FILE_NAME);
  const bak  = file + '.bak';

  let mainTxt: string | null = null;
  try { mainTxt = await fs.readFile(file, 'utf8'); }
  catch (err: any) {
    if (err?.code === 'ENOENT') return emptyOrderingCache();
    // Read error other than ENOENT — fall through to bak attempt.
  }

  if (mainTxt != null) {
    const parsed = parse(mainTxt);
    if (parsed) return parsed;
  }

  // Try .bak.
  let bakTxt: string | null = null;
  try { bakTxt = await fs.readFile(bak, 'utf8'); } catch { /* no bak */ }
  if (bakTxt != null) {
    const parsed = parse(bakTxt);
    if (parsed) {
      try { await fs.copyFile(bak, file); } catch { /* best-effort restore */ }
      console.warn(`[ordering] Recovered ordering.json from .bak`);
      return parsed;
    }
  }

  console.warn(`[ordering] Both ordering.json and .bak unreadable — starting with empty cache`);
  return emptyOrderingCache();
}

export async function saveOrderingCache(cacheDir: string, cache: OrderingCache): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, ORDERING_FILE_NAME);
  const bak  = file + '.bak';

  // Backup current main file if it exists.
  try {
    await fs.access(file);
    await fs.copyFile(file, bak);
  } catch { /* no existing main — skip backup */ }

  const payload: OrderingFileV1 = {
    v: 1,
    bookmarks:     toArray(cache.bookmarks),
    files:         toArray(cache.files),
    groups:        toArray(cache.groups),
    bookmarkFiles: toArray(cache.bookmarkFiles),
  };
  await fs.writeFile(file, JSON.stringify(payload, null, 2), { mode: 0o644 });
}
```

**Step 2: Run tests, expect PASS**

Run: `pnpm test -- packages/extension/src/ordering/store.test.ts`
Expected: all 5 tests pass.

**Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add packages/extension/src/ordering/store.ts packages/extension/src/ordering/store.test.ts
git commit -m "ordering: add per-workspace cache with .bak recovery"
```

---

## Task 8: `service.ts` — failing tests for get/set/has/delete + debounced persist + load-prune

**Files:**
- Create: `packages/extension/src/ordering/service.test.ts`

**Step 1: Write failing tests**

```ts
// packages/extension/src/ordering/service.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { OrderingService } from './service';
import { ORDERING_FILE_NAME } from './store';
import { emptyOrderingCache } from './types';

describe('OrderingService', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'svc-')));
    vi.useFakeTimers();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('starts empty when no file exists', async () => {
    const svc = await OrderingService.load(dir);
    expect(svc.has('bookmark', 'X', 'a')).toBe(false);
    expect(svc.get('bookmark', 'X', 'a')).toBeUndefined();
  });

  it('set/get/has/delete work end-to-end', async () => {
    const svc = await OrderingService.load(dir);
    svc.set('bookmark', 'B1', 'f', 200);
    expect(svc.has('bookmark', 'B1', 'f')).toBe(true);
    expect(svc.get('bookmark', 'B1', 'f')).toBe(200);
    svc.delete('bookmark', 'B1', 'f');
    expect(svc.has('bookmark', 'B1', 'f')).toBe(false);
  });

  it('debounces writes — multiple sets within window result in one file', async () => {
    const svc = await OrderingService.load(dir);
    svc.set('bookmark', 'B1', 'f', 100);
    svc.set('bookmark', 'B2', 'f', 200);
    svc.set('bookmark', 'B3', 'f', 300);
    // No write yet.
    expect(await fileExists(path.join(dir, ORDERING_FILE_NAME))).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(await fileExists(path.join(dir, ORDERING_FILE_NAME))).toBe(true);
    const txt = await fs.readFile(path.join(dir, ORDERING_FILE_NAME), 'utf8');
    const parsed = JSON.parse(txt);
    expect(parsed.bookmarks.length).toBe(3);
  });

  it('flush() persists pending writes synchronously', async () => {
    const svc = await OrderingService.load(dir);
    svc.set('group', 'G', 'f', 100);
    await svc.flush();
    expect(await fileExists(path.join(dir, ORDERING_FILE_NAME))).toBe(true);
  });

  it('dispose() flushes pending writes', async () => {
    const svc = await OrderingService.load(dir);
    svc.set('file', 'F', 'a', 100);
    await svc.dispose();
    expect(await fileExists(path.join(dir, ORDERING_FILE_NAME))).toBe(true);
  });

  it('load prunes unknown ids when a known-id set is provided', async () => {
    // Pre-seed a cache with 3 bookmarks, 2 known.
    const svc1 = await OrderingService.load(dir);
    svc1.set('bookmark', 'KEEP1', 'a', 100);
    svc1.set('bookmark', 'KEEP2', 'a', 200);
    svc1.set('bookmark', 'STALE', 'a', 300);
    await svc1.flush();

    const knownIds = {
      bookmarks: new Set(['KEEP1', 'KEEP2']),
      files: new Set<string>(),
      groups: new Set<string>(),
      bookmarkFiles: new Set<string>(),
    };
    const svc2 = await OrderingService.load(dir, knownIds);
    expect(svc2.has('bookmark', 'KEEP1', 'a')).toBe(true);
    expect(svc2.has('bookmark', 'KEEP2', 'a')).toBe(true);
    expect(svc2.has('bookmark', 'STALE', 'a')).toBe(false);
  });
});

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}
```

**Step 2: Run, expect FAIL**

Run: `pnpm test -- packages/extension/src/ordering/service.test.ts`
Expected: FAIL — module not present.

---

## Task 9: `service.ts` — implement OrderingService

**Files:**
- Create: `packages/extension/src/ordering/service.ts`

**Step 1: Write the implementation**

```ts
// packages/extension/src/ordering/service.ts
import { loadOrderingCache, saveOrderingCache } from './store';
import { emptyOrderingCache, type ContextKey, type EntityKind, type OrderingCache } from './types';

export interface KnownIds {
  bookmarks: Set<string>;
  files: Set<string>;
  groups: Set<string>;
  bookmarkFiles: Set<string>;
}

const DEBOUNCE_MS = 250;

function mapFor(cache: OrderingCache, kind: EntityKind) {
  switch (kind) {
    case 'bookmark':     return cache.bookmarks;
    case 'file':         return cache.files;
    case 'group':        return cache.groups;
    case 'bookmarkFile': return cache.bookmarkFiles;
  }
}

/**
 * In-memory ordering state with debounced writes. One instance per workspace.
 * Owned by activate(); inject into providers.
 */
export class OrderingService {
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> | null = null;

  private constructor(
    private readonly cacheDir: string,
    private cache: OrderingCache,
  ) {}

  static async load(cacheDir: string, knownIds?: KnownIds): Promise<OrderingService> {
    let cache = await loadOrderingCache(cacheDir);
    if (knownIds) cache = pruneUnknown(cache, knownIds);
    return new OrderingService(cacheDir, cache);
  }

  has(kind: EntityKind, id: string, ctx: ContextKey): boolean {
    const rec = mapFor(this.cache, kind)[id];
    return rec != null && rec[ctx] != null;
  }

  get(kind: EntityKind, id: string, ctx: ContextKey): number | undefined {
    return mapFor(this.cache, kind)[id]?.[ctx];
  }

  set(kind: EntityKind, id: string, ctx: ContextKey, rank: number): void {
    const m = mapFor(this.cache, kind);
    if (!m[id]) m[id] = {};
    m[id][ctx] = rank;
    this.scheduleWrite();
  }

  delete(kind: EntityKind, id: string, ctx: ContextKey): void {
    const m = mapFor(this.cache, kind);
    const rec = m[id];
    if (!rec) return;
    delete rec[ctx];
    if (Object.keys(rec).length === 0) delete m[id];
    this.scheduleWrite();
  }

  private scheduleWrite(): void {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flushInternal(); }, DEBOUNCE_MS);
  }

  /** Flush any pending write synchronously (awaits in-flight writes). */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    await this.flushInternal();
  }

  private async flushInternal(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    // Serialize writes — if one is in flight, await it before starting another.
    const prev = this.writing ?? Promise.resolve();
    const next = prev.then(() => saveOrderingCache(this.cacheDir, this.cache));
    this.writing = next.finally(() => {
      if (this.writing === next) this.writing = null;
    });
    await next;
  }

  async dispose(): Promise<void> {
    await this.flush();
  }
}

function pruneUnknown(cache: OrderingCache, known: KnownIds): OrderingCache {
  const pruneMap = (m: Record<string, any>, keep: Set<string>) => {
    for (const id of Object.keys(m)) if (!keep.has(id)) delete m[id];
  };
  pruneMap(cache.bookmarks,     known.bookmarks);
  pruneMap(cache.files,         known.files);
  pruneMap(cache.groups,        known.groups);
  pruneMap(cache.bookmarkFiles, known.bookmarkFiles);
  return cache;
}
```

**Step 2: Run tests, expect PASS**

Run: `pnpm test -- packages/extension/src/ordering/service.test.ts`
Expected: all 6 tests pass.

**Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add packages/extension/src/ordering/service.ts packages/extension/src/ordering/service.test.ts
git commit -m "ordering: add OrderingService with debounced persistence and load-time prune"
```

---

## Task 10: `applySort.ts` — failing tests for the three modes

**Files:**
- Create: `packages/extension/src/ordering/applySort.test.ts`

**Step 1: Write failing tests**

```ts
// packages/extension/src/ordering/applySort.test.ts
import { describe, it, expect } from 'vitest';
import { applySort, type SortableItem } from './applySort';

type Item = SortableItem & { id: string; updatedAt?: number; defaultKey?: string };

function defaultCmp(a: Item, b: Item) {
  return (a.defaultKey ?? a.id).localeCompare(b.defaultKey ?? b.id);
}

describe('applySort', () => {
  const items: Item[] = [
    { id: 'A', kind: 'bookmark', updatedAt: 30, defaultKey: '03' },
    { id: 'B', kind: 'bookmark', updatedAt: 10, defaultKey: '01' },
    { id: 'C', kind: 'bookmark', updatedAt: 20, defaultKey: '02' },
  ];

  const ranks = new Map<string, number>([['C', 100], ['A', 200]]); // B has no rank

  const svc = {
    has: (_k: any, id: string, _c: any) => ranks.has(id),
    get: (_k: any, id: string, _c: any) => ranks.get(id),
  };

  it('default mode delegates to defaultCmp', () => {
    const out = applySort(items, 'default', 'a', svc as any, defaultCmp);
    expect(out.map(i => i.id)).toEqual(['B', 'C', 'A']);
  });

  it('recent mode sorts by updatedAt descending', () => {
    const out = applySort(items, 'recent', 'a', svc as any, defaultCmp);
    expect(out.map(i => i.id)).toEqual(['A', 'C', 'B']);
  });

  it('user mode puts ranked items first (by rank asc), then unranked via defaultCmp', () => {
    const out = applySort(items, 'user', 'a', svc as any, defaultCmp);
    // ranked: C(100), A(200). unranked: B → default
    expect(out.map(i => i.id)).toEqual(['C', 'A', 'B']);
  });

  it('user mode falls back to defaultCmp when nothing is ranked', () => {
    const out = applySort(items, 'user', 'g', svc as any, defaultCmp); // 'g' has no ranks
    expect(out.map(i => i.id)).toEqual(['B', 'C', 'A']);
  });
});
```

**Step 2: Run, expect FAIL**

Run: `pnpm test -- packages/extension/src/ordering/applySort.test.ts`
Expected: FAIL.

---

## Task 11: `applySort.ts` — implement

**Files:**
- Create: `packages/extension/src/ordering/applySort.ts`

**Step 1: Write the implementation**

```ts
// packages/extension/src/ordering/applySort.ts
import type { ContextKey, EntityKind, SortMode } from './types';
import type { OrderingService } from './service';

export interface SortableItem {
  id: string;
  kind: EntityKind;
  /** Last-updated timestamp in ms. For files/groups, derive as max of children. */
  updatedAt?: number;
}

/**
 * Pure sort. Caller provides a `defaultCmp` so this stays decoupled from
 * provider-specific tie-breakers (line numbers, paths, etc.).
 */
export function applySort<T extends SortableItem>(
  items: T[],
  mode: SortMode,
  ctx: ContextKey,
  service: Pick<OrderingService, 'has' | 'get'>,
  defaultCmp: (a: T, b: T) => number,
): T[] {
  switch (mode) {
    case 'default':
      return [...items].sort(defaultCmp);
    case 'recent':
      return [...items].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    case 'user': {
      const ranked:   T[] = [];
      const unranked: T[] = [];
      for (const i of items) {
        if (service.has(i.kind, i.id, ctx)) ranked.push(i);
        else unranked.push(i);
      }
      ranked.sort((a, b) => service.get(a.kind, a.id, ctx)! - service.get(b.kind, b.id, ctx)!);
      unranked.sort(defaultCmp);
      return [...ranked, ...unranked];
    }
  }
}
```

**Step 2: Run tests, expect PASS**

Run: `pnpm test -- packages/extension/src/ordering/applySort.test.ts`
Expected: 4 tests pass.

**Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add packages/extension/src/ordering/applySort.ts packages/extension/src/ordering/applySort.test.ts
git commit -m "ordering: add applySort for default/user/recent modes"
```

---

## Task 12: `dnd-validation.ts` — failing tests for the validation table

**Files:**
- Create: `packages/extension/src/ordering/dnd-validation.test.ts`

**Step 1: Write failing tests**

Each row of the table in the design doc gets a test. Use a compact shape:

```ts
// packages/extension/src/ordering/dnd-validation.test.ts
import { describe, it, expect } from 'vitest';
import { canReorder, type DragSpec } from './dnd-validation';

const mk = (overrides: Partial<DragSpec>): DragSpec => ({
  kind: 'bookmark', id: 'X', ctx: 'f', parentId: 'PARENT-1',
  ...overrides,
});

describe('canReorder', () => {
  it('allows bookmark→bookmark in the same parent', () => {
    expect(canReorder(mk({}), mk({}))).toBe(true);
  });

  it('rejects bookmark→bookmark across files in All Bookmarks (ctx=f, different parent)', () => {
    expect(canReorder(mk({ ctx: 'f', parentId: 'A' }), mk({ ctx: 'f', parentId: 'B' }))).toBe(false);
  });

  it('rejects bookmark→bookmark across groups in F&G (ctx=g, different parent)', () => {
    expect(canReorder(mk({ ctx: 'g', parentId: 'G1' }), mk({ ctx: 'g', parentId: 'G2' }))).toBe(false);
  });

  it('allows bookmark→bookmark in flat All Bookmarks (ctx=a, parentId always null)', () => {
    expect(canReorder(mk({ ctx: 'a', parentId: null }), mk({ ctx: 'a', parentId: null }))).toBe(true);
  });

  it('allows group→group in the same file', () => {
    expect(canReorder(
      mk({ kind: 'group', ctx: 'f', parentId: 'FILE-1' }),
      mk({ kind: 'group', ctx: 'f', parentId: 'FILE-1' }),
    )).toBe(true);
  });

  it('rejects group→group across files', () => {
    expect(canReorder(
      mk({ kind: 'group', ctx: 'f', parentId: 'FILE-1' }),
      mk({ kind: 'group', ctx: 'f', parentId: 'FILE-2' }),
    )).toBe(false);
  });

  it('allows file→file in All Bookmarks', () => {
    expect(canReorder(
      mk({ kind: 'file', ctx: 'a', parentId: null }),
      mk({ kind: 'file', ctx: 'a', parentId: null }),
    )).toBe(true);
  });

  it('allows bookmarkFile→bookmarkFile in the same workspace', () => {
    expect(canReorder(
      mk({ kind: 'bookmarkFile', ctx: 'f', parentId: 'WS-1' }),
      mk({ kind: 'bookmarkFile', ctx: 'f', parentId: 'WS-1' }),
    )).toBe(true);
  });

  it('rejects bookmarkFile→bookmarkFile across workspaces', () => {
    expect(canReorder(
      mk({ kind: 'bookmarkFile', ctx: 'f', parentId: 'WS-1' }),
      mk({ kind: 'bookmarkFile', ctx: 'f', parentId: 'WS-2' }),
    )).toBe(false);
  });

  it('rejects mismatched kinds (e.g. group dropped on bookmark)', () => {
    expect(canReorder(
      mk({ kind: 'group',    ctx: 'f', parentId: 'FILE-1' }),
      mk({ kind: 'bookmark', ctx: 'f', parentId: 'FILE-1' }),
    )).toBe(false);
  });
});
```

**Step 2: Run, expect FAIL**

Run: `pnpm test -- packages/extension/src/ordering/dnd-validation.test.ts`
Expected: FAIL.

---

## Task 13: `dnd-validation.ts` — implement

**Files:**
- Create: `packages/extension/src/ordering/dnd-validation.ts`

**Step 1: Write the implementation**

```ts
// packages/extension/src/ordering/dnd-validation.ts
import type { ContextKey, EntityKind } from './types';

export interface DragSpec {
  kind: EntityKind;
  id: string;
  ctx: ContextKey;
  /**
   * Sibling-scope identifier:
   *   - bookmark in ctx 'f': fileId
   *   - bookmark in ctx 'g': groupId
   *   - bookmark in ctx 'a': null (flat view)
   *   - group in ctx 'f': fileId
   *   - file in ctx 'a': null
   *   - bookmarkFile in ctx 'f': workspaceRoot (or workspace identifier)
   */
  parentId: string | null;
}

/**
 * Pure validation. Returns true iff `src` may be reordered to `tgt`'s position.
 * Mismatches (different kinds, different parents in scopes that don't permit
 * cross-parent reordering) silently return false — the drop handler no-ops.
 *
 * TODO(future): cross-file move-bookmark, cross-group move-bookmark,
 * cross-file move-group, cross-workspace move-file are separate commands
 * (not sort operations). Hook sites left at the ignore branches.
 */
export function canReorder(src: DragSpec, tgt: DragSpec): boolean {
  if (src.kind !== tgt.kind) return false;
  if (src.ctx !== tgt.ctx) return false;
  // Same parent required in all current scopes.
  // (ctx 'a' implies parentId === null for both, so the equality holds.)
  if (src.parentId !== tgt.parentId) return false;
  return true;
}
```

**Step 2: Run tests, expect PASS**

Run: `pnpm test -- packages/extension/src/ordering/dnd-validation.test.ts`
Expected: 10 tests pass.

**Step 3: Typecheck and commit**

```bash
pnpm typecheck
git add packages/extension/src/ordering/dnd-validation.ts packages/extension/src/ordering/dnd-validation.test.ts
git commit -m "ordering: add canReorder validation for drag/drop"
```

---

## Task 14: Declare new settings and commands in `package.json`

**Files:**
- Modify: `packages/extension/package.json` (in the `contributes.configuration.properties` block, and `contributes.commands`)
- Modify: `packages/extension/src/manifest.test.ts` (add assertion for new entries)

**Step 1: Add to `manifest.test.ts` — failing test first**

Append a new `it()` block following the existing pattern in `manifest.test.ts`:

```ts
it('declares sortMode settings, dev multi-select drag, and sort-mode commands', () => {
  // Settings
  expect(linesMatching(/"agenticBookmarks\.sortMode\.allBookmarks"/)).not.toEqual([]);
  expect(linesMatching(/"agenticBookmarks\.sortMode\.filesAndGroups"/)).not.toEqual([]);
  expect(linesMatching(/"agenticBookmarks\.dev\.enableMultiSelectDrag"/)).not.toEqual([]);
  // Commands
  expect(linesMatching(/"command":\s*"agenticBookmarks\.setSortModeAllBookmarks"/)).not.toEqual([]);
  expect(linesMatching(/"command":\s*"agenticBookmarks\.setSortModeFilesAndGroups"/)).not.toEqual([]);
});
```

Run: `pnpm test -- packages/extension/src/manifest.test.ts`
Expected: FAIL on the new `it`.

**Step 2: Add the configuration properties**

In `packages/extension/package.json`, inside `contributes.configuration.properties`, add (alphabetic-ish placement is fine):

```jsonc
"agenticBookmarks.sortMode.allBookmarks": {
  "type": "string",
  "enum": ["default", "user", "recent"],
  "default": "user",
  "description": "Sort mode for the All Bookmarks tree. 'user' enables drag-to-reorder; 'default' uses path/line ordering; 'recent' sorts by last-updated descending."
},
"agenticBookmarks.sortMode.filesAndGroups": {
  "type": "string",
  "enum": ["default", "user", "recent"],
  "default": "user",
  "description": "Sort mode for the Files & Groups tree. 'user' enables drag-to-reorder; 'default' uses path/line ordering; 'recent' sorts by last-updated descending."
},
"agenticBookmarks.dev.enableMultiSelectDrag": {
  "type": "boolean",
  "default": false,
  "description": "Internal: enable multi-select drag in the bookmark trees. Right-click/context-menu commands are not yet multi-select aware — leave off in production."
}
```

**Step 3: Add the command contributions**

In `packages/extension/package.json`, inside `contributes.commands`, add:

```jsonc
{ "command": "agenticBookmarks.setSortModeAllBookmarks",   "title": "Bookmarks: Set sort mode (All Bookmarks)",   "category": "Agentic Bookmarks" },
{ "command": "agenticBookmarks.setSortModeFilesAndGroups", "title": "Bookmarks: Set sort mode (Files & Groups)", "category": "Agentic Bookmarks" }
```

**Step 4: Run the manifest test, expect PASS**

Run: `pnpm test -- packages/extension/src/manifest.test.ts`
Expected: all tests pass.

**Step 5: Commit**

```bash
git add packages/extension/package.json packages/extension/src/manifest.test.ts
git commit -m "manifest: declare sortMode settings, dev multi-select drag flag, and sort commands"
```

---

## Task 15: Register the two `setSortMode*` commands

**Files:**
- Modify: `packages/extension/src/commands/views.ts` (extend `registerViewsCommands`)

**Step 1: Add the commands to the existing `registerViewsCommands` return array**

At the bottom of `registerViewsCommands` (before the closing `];`), add:

```ts
vscode.commands.registerCommand('agenticBookmarks.setSortModeAllBookmarks', async (mode?: string) => {
  const chosen = mode ?? await pickSortMode();
  if (!chosen) return;
  await vscode.workspace.getConfiguration('agenticBookmarks').update('sortMode.allBookmarks', chosen, vscode.ConfigurationTarget.Global);
  settingsProvider.refresh();
  provider.refresh();
}),

vscode.commands.registerCommand('agenticBookmarks.setSortModeFilesAndGroups', async (mode?: string) => {
  const chosen = mode ?? await pickSortMode();
  if (!chosen) return;
  await vscode.workspace.getConfiguration('agenticBookmarks').update('sortMode.filesAndGroups', chosen, vscode.ConfigurationTarget.Global);
  settingsProvider.refresh();
  filesGroups.refresh();
}),
```

And add this helper at the top of the file (after imports):

```ts
async function pickSortMode(): Promise<string | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: 'Default',          description: 'Path / line-number order',        value: 'default' },
      { label: 'User sorting',     description: 'Drag-to-reorder, persisted',      value: 'user' },
      { label: 'Recently updated', description: 'Last-updated first',              value: 'recent' },
    ],
    { placeHolder: 'Choose a sort mode' },
  );
  return pick?.value;
}
```

**Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

**Step 3: Commit**

```bash
git add packages/extension/src/commands/views.ts
git commit -m "commands: register setSortMode commands with QuickPick fallback"
```

---

## Task 16: Add sort-mode rows to the Settings tree

**Files:**
- Modify: `packages/extension/src/settingsProvider.ts` — the existing `if ((e as any).label === 'Views')` branch (around line 135).

**Step 1: Add two combo rows after the existing toggle rows**

Inside the Views branch (right after the two existing `items.push(this.toggleItem(...))` calls), append:

```ts
const sortAll = vscode.workspace.getConfiguration('agenticBookmarks').get<string>('sortMode.allBookmarks', 'user');
items.push(this.comboItem(
  `Sort: All Bookmarks · ${formatSortMode(sortAll)}`,
  'agenticBookmarks.setSortModeAllBookmarks',
));

const sortFG = vscode.workspace.getConfiguration('agenticBookmarks').get<string>('sortMode.filesAndGroups', 'user');
items.push(this.comboItem(
  `Sort: Files & Groups · ${formatSortMode(sortFG)}`,
  'agenticBookmarks.setSortModeFilesAndGroups',
));
```

**Step 2: Add the helpers**

Add a private `comboItem` method to `SettingsProvider` (next to `toggleItem`), and a module-level `formatSortMode`:

```ts
private comboItem(label: string, commandId: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon('list-ordered');
  item.command = { command: commandId, title: 'Change' };
  (item as any).contextValue = 'comboItem';
  return item;
}
```

```ts
function formatSortMode(m: string): string {
  if (m === 'user') return 'User sorting';
  if (m === 'recent') return 'Recently updated';
  return 'Default';
}
```

**Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

**Step 4: Commit**

```bash
git add packages/extension/src/settingsProvider.ts
git commit -m "settings: surface per-view sort mode in Views section"
```

---

## Task 17: Wire `OrderingService` into activate(), inject into providers

**Files:**
- Modify: `packages/extension/src/extension.ts` (around lines 130–164)
- Modify: `packages/extension/src/treeProvider.ts` (BookmarksProvider constructor — line 189)
- Modify: `packages/extension/src/filesGroupsProvider.ts` (FilesGroupsProvider constructor — line 75)

**Step 1: Add the constructor argument to both providers**

In each provider, add `private readonly orderingService: OrderingService` as the last constructor parameter. Import:

```ts
import { OrderingService } from './ordering/service';
```

Do not use it yet — that's a later task. We're just plumbing.

**Step 2: Load OrderingService and pass it through in `extension.ts`**

In `activate()`, after the `paths` are computed (and `getCacheDir` is in scope), before constructing `BookmarksProvider`:

```ts
import { getCacheDir } from '@agentic-bookmarks/core';
import { OrderingService } from './ordering/service';

// ... inside activate(), with reg already loaded:
const dataRoot = getBookmarksDataRoot(reg);
const cacheDir = getCacheDir(workspaceRoot, dataRoot);

// knownIds prune at load time — keeps stale entries from accumulating
const knownIds = {
  bookmarks: new Set<string>(),     // populated below
  files: new Set<string>(),
  groups: new Set<string>(),
  bookmarkFiles: new Set<string>(reg.files.map(f => (f as any).fileId as string)),
};
// Walk each bookmark data file to collect bookmark/group ids and file paths.
for (const rf of reg.files) {
  try {
    const p = pathsForDataFile(rf.path, workspaceRoot, dataRoot);
    const f = await readFileV2(p);
    for (const b of f.bookmarks) knownIds.bookmarks.add((b as any).id);
    for (const g of f.groups)    knownIds.groups.add((g as any).id);
    knownIds.files.add(rf.path); // user-code-files use path as identity
  } catch { /* skip unreadable file */ }
}

const orderingService = await OrderingService.load(cacheDir, knownIds);
context.subscriptions.push({ dispose: () => { void orderingService.dispose(); } });
```

Then pass `orderingService` as the final constructor argument to both providers.

**Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

**Step 4: Smoke-build**

Run: `pnpm build`
Expected: builds without errors.

**Step 5: Commit**

```bash
git add packages/extension/src/extension.ts packages/extension/src/treeProvider.ts packages/extension/src/filesGroupsProvider.ts
git commit -m "wire OrderingService through activate() and inject into providers"
```

---

## Task 18: Apply user/recent sort in `BookmarksProvider.getChildren`

**Files:**
- Modify: `packages/extension/src/treeProvider.ts` — `getChildren` (lines 213–406 area).

**Step 1: Read the current mode at the top of `getChildren`**

```ts
const mode = vscode.workspace.getConfiguration('agenticBookmarks').get<SortMode>('sortMode.allBookmarks', 'user');
```

Import:

```ts
import { applySort } from './ordering/applySort';
import type { SortMode } from './ordering/types';
```

**Step 2: Apply sort to the flat (no-files) bookmark list**

Replace the `flatEntries.sort(...)` block (the URI + line comparator around lines 337–347) with:

```ts
// Build SortableItem-shaped wrappers around the existing entries.
const flatSortable = flatEntries.map(fe => ({
  id: (fe.entry.bookmark as any).id as string,
  kind: 'bookmark' as const,
  updatedAt: (fe.entry.bookmark as any).updatedAt as number | undefined,
  _entry: fe,
}));

const defaultCmp = (a: typeof flatSortable[number], b: typeof flatSortable[number]) => {
  const uriCmp = a._entry.uri.localeCompare(b._entry.uri);
  if (uriCmp !== 0) return uriCmp;
  const startA = startLineOf(a._entry.entry.bookmark);
  const startB = startLineOf(b._entry.entry.bookmark);
  return startA - startB;
};

const sortedFlat = applySort(flatSortable, mode, 'a', this.orderingService, defaultCmp);
const orderedEntries = sortedFlat.map(s => s._entry);
// ... iterate orderedEntries instead of flatEntries below
```

(`startLineOf` is a tiny local helper extracted from the existing comparator — define once at module scope.)

**Step 3: Apply sort to the per-file branch**

Where `FileNode`s are built (lines 367–...), sort the files themselves with ctx `'a'` and sort each file's bookmarks with ctx `'f'`. Add sort right before `return fileNodes`:

```ts
const fileSortable = fileNodes.map(fn => ({
  id: fn.resourceUri!.toString(),
  kind: 'file' as const,
  // For files, derive updatedAt as max(child.updatedAt).
  updatedAt: fn.entries.reduce((m, e) => Math.max(m, (e.bookmark as any).updatedAt ?? 0), 0),
  _node: fn,
}));
const fileDefaultCmp = (a: typeof fileSortable[number], b: typeof fileSortable[number]) =>
  a.id.localeCompare(b.id);
const sortedFiles = applySort(fileSortable, mode, 'a', this.orderingService, fileDefaultCmp)
  .map(s => s._node);
return sortedFiles;
```

And in the FileNode → bookmarks branch (the case `element instanceof FileNode`), sort the bookmarks with ctx `'f'`, parentId = file URI.

**Step 4: Typecheck and build**

```bash
pnpm typecheck && pnpm build
```

**Step 5: Commit**

```bash
git add packages/extension/src/treeProvider.ts
git commit -m "treeProvider: apply per-view sort mode in getChildren"
```

---

## Task 19: Apply user/recent sort in `FilesGroupsProvider.getChildren`

**Files:**
- Modify: `packages/extension/src/filesGroupsProvider.ts` — `getChildren` (lines 173–293)

**Step 1: At the top of `getChildren`, read the mode**

```ts
const mode = vscode.workspace.getConfiguration('agenticBookmarks')
  .get<SortMode>('sortMode.filesAndGroups', 'user');
```

**Step 2: Sort bookmarkFiles under each workspace**

In `getFilesForWorkspace` (line 160), sort the resulting `RegFileNode[]` with ctx `'f'`, parentId = `wsRoot`, kind = `'bookmarkFile'`. The default comparator is by `fileName.localeCompare`. updatedAt: skip for now (derive only if `mode === 'recent'`; if costly, leave as 0 and add a TODO).

**Step 3: Sort groups within a RegFileNode**

Where groups are pushed into `nodes`, sort with ctx `'f'`, parentId = `fileId`, kind = `'group'`. Default cmp: `a.group.name.localeCompare(b.group.name)`.

**Step 4: Sort bookmarks within a GroupNode**

Replace the existing `bookmarks.sort(...)` block (lines 268–276) with `applySort` ctx `'g'`, parentId = `e.groupId`, kind = `'bookmark'`. The default comparator is the existing start-line comparison.

**Step 5: Typecheck and build**

```bash
pnpm typecheck && pnpm build
```

**Step 6: Commit**

```bash
git add packages/extension/src/filesGroupsProvider.ts
git commit -m "filesGroupsProvider: apply per-view sort mode in getChildren"
```

---

## Task 20: `dnd-controller.ts` — drag/drop wiring (no tests; pure-logic helpers are tested separately)

**Files:**
- Create: `packages/extension/src/ordering/dnd-controller.ts`

**Step 1: Implement the controller helpers**

```ts
// packages/extension/src/ordering/dnd-controller.ts
import * as vscode from 'vscode';
import type { OrderingService } from './service';
import type { ContextKey, EntityKind } from './types';
import { assignRankBetween, ensureRanksAround } from './rank';
import { canReorder, type DragSpec } from './dnd-validation';

/**
 * Per-drop sibling resolver: given the target node and view state, return the
 * full sibling list in current visual order along with the dropped item's
 * insertion index. Provider-specific — each provider passes its own resolver.
 */
export interface SiblingResolver {
  /** Returns the sibling list (in visual order) and the insert index BEFORE the target. */
  resolve(target: vscode.TreeItem | undefined): {
    siblings: Array<{ spec: DragSpec; rank: number | null }>;
    insertIdx: number;
  } | null;
}

export interface DnDOptions {
  /** Unique MIME type for this tree's drag transfer. */
  mimeType: string;
  /** Extract a DragSpec from a tree item. Return null if not draggable. */
  specOf: (item: vscode.TreeItem) => DragSpec | null;
  /** Resolve siblings + insertIdx around a drop target. */
  resolver: SiblingResolver;
  /** Refresh callback (provider's `_onDidChangeTreeData.fire()`). */
  onChanged: () => void;
  service: OrderingService;
}

export function makeDnDController(opts: DnDOptions): vscode.TreeDragAndDropController<vscode.TreeItem> {
  return {
    dropMimeTypes: [opts.mimeType],
    dragMimeTypes: [opts.mimeType],

    handleDrag(source, dataTransfer) {
      const specs = source
        .map(opts.specOf)
        .filter((s): s is DragSpec => s != null);
      if (specs.length === 0) return;
      dataTransfer.set(opts.mimeType, new vscode.DataTransferItem(JSON.stringify(specs)));
    },

    async handleDrop(target, dataTransfer) {
      const item = dataTransfer.get(opts.mimeType);
      if (!item) return;
      let srcSpecs: DragSpec[];
      try { srcSpecs = JSON.parse(await item.asString()) as DragSpec[]; }
      catch { return; }
      if (!Array.isArray(srcSpecs) || srcSpecs.length === 0) return;

      const targetSpec = target ? opts.specOf(target) : null;
      // If target is null (drop on empty area), we can still allow drops by
      // treating "append to current parent of first source" as the intent.
      // For simplicity, require a target spec.
      if (!targetSpec) return;

      const resolved = opts.resolver.resolve(target);
      if (!resolved) return;
      const { siblings } = resolved;
      let { insertIdx } = resolved;

      // Local sibling state mutates as we place each survivor.
      const survivors = srcSpecs.filter(s => canReorder(s, targetSpec));
      if (survivors.length === 0) return;

      const getRank = (s: { rank: number | null }) => s.rank;
      const setRank = (s: { rank: number | null }, r: number) => { s.rank = r; };

      for (const src of survivors) {
        // If src is already in this sibling list, remove it before inserting
        // (so we don't double-count it as a neighbor of itself).
        const existingIdx = siblings.findIndex(s => s.spec.id === src.id && s.spec.kind === src.kind);
        if (existingIdx >= 0) {
          siblings.splice(existingIdx, 1);
          if (existingIdx < insertIdx) insertIdx--;
        }

        ensureRanksAround(siblings, insertIdx, getRank, setRank);
        const prevRank = insertIdx > 0                ? siblings[insertIdx - 1].rank : null;
        const nextRank = insertIdx < siblings.length  ? siblings[insertIdx].rank     : null;
        const newRank  = assignRankBetween(prevRank, nextRank);

        // Persist ensure-ranks side effects + the new rank.
        for (const s of siblings) {
          if (s.rank != null) opts.service.set(s.spec.kind, s.spec.id, s.spec.ctx, s.rank);
        }
        opts.service.set(src.kind, src.id, src.ctx, newRank);

        // Splice src into local list for next iteration.
        siblings.splice(insertIdx, 0, { spec: src, rank: newRank });
        insertIdx++;
      }

      opts.onChanged();
    },
  };
}
```

**Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

**Step 3: Commit**

```bash
git add packages/extension/src/ordering/dnd-controller.ts
git commit -m "ordering: add shared drag/drop controller factory"
```

---

## Task 21: Register drag/drop on `BookmarksProvider`

**Files:**
- Modify: `packages/extension/src/treeProvider.ts` (add `dnd` field + sibling resolver)
- Modify: `packages/extension/src/extension.ts` (use it in `createTreeView`)

**Step 1: In `BookmarksProvider`, add `public dnd: vscode.TreeDragAndDropController<vscode.TreeItem>`**

Construct it in the constructor body using `makeDnDController` with:
- `mimeType: 'application/vnd.agenticBookmarks.allBookmarks+json'`
- `specOf`: returns a `DragSpec` for `BookmarkNode` (ctx = `f` if grouped under a FileNode, else `a`; parentId = parent file URI or null) and for `FileNode` (kind `file`, ctx `a`, parentId null). Returns null otherwise.
- `resolver`: invokes `this.getChildren(parent)` to materialize siblings in current visual order, looks up each by id via `this.orderingService.get(...)` to attach a rank, finds `insertIdx` by `target.id`'s position.
- `onChanged: () => this._onDidChangeTreeData.fire()`
- `service: orderingService`

**Step 2: In `extension.ts`, pass it to `createTreeView`**

```ts
const enableMulti = vscode.workspace.getConfiguration('agenticBookmarks')
  .get<boolean>('dev.enableMultiSelectDrag', false);
const treeView = vscode.window.createTreeView('agenticBookmarks.view', {
  treeDataProvider: provider,
  showCollapseAll: true,
  dragAndDropController: provider.dnd,
  canSelectMany: enableMulti,
});
```

**Step 3: Typecheck and build**

Run: `pnpm typecheck && pnpm build`
Expected: clean.

**Step 4: Commit**

```bash
git add packages/extension/src/treeProvider.ts packages/extension/src/extension.ts
git commit -m "treeProvider: register drag/drop controller on All Bookmarks tree"
```

---

## Task 22: Register drag/drop on `FilesGroupsProvider`

**Files:**
- Modify: `packages/extension/src/filesGroupsProvider.ts`
- Modify: `packages/extension/src/extension.ts`

**Step 1: Same pattern as Task 21**

- `mimeType: 'application/vnd.agenticBookmarks.filesGroups+json'`
- `specOf`: `BookmarkNode` (ctx `g`, parentId groupId), `GroupNode` (ctx `f`, parentId fileId), `RegFileNode` (kind `bookmarkFile`, ctx `f`, parentId wsRoot), `WorkspaceFolderNode` → null.
- `resolver`: same shape, walks `getChildren(parent)`.
- `onChanged`, `service`: as before.

**Step 2: In `extension.ts`, pass it**

```ts
const filesGroupsView = vscode.window.createTreeView('agenticBookmarks.filesGroups', {
  treeDataProvider: filesGroups,
  showCollapseAll: true,
  dragAndDropController: filesGroups.dnd,
  canSelectMany: enableMulti,
});
```

**Step 3: Typecheck, build, commit**

```bash
pnpm typecheck && pnpm build
git add packages/extension/src/filesGroupsProvider.ts packages/extension/src/extension.ts
git commit -m "filesGroupsProvider: register drag/drop controller"
```

---

## Task 23: Refire trees on configuration change

**Files:**
- Modify: `packages/extension/src/extension.ts`

**Step 1: Add a configuration listener**

In `activate()`, add (alongside the existing one):

```ts
context.subscriptions.push(
  vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('agenticBookmarks.sortMode.allBookmarks'))      provider.refresh();
    if (e.affectsConfiguration('agenticBookmarks.sortMode.filesAndGroups'))    filesGroups.refresh();
    if (e.affectsConfiguration('agenticBookmarks.sortMode'))                   settingsProvider.refresh();
  }),
);
```

**Step 2: Typecheck and commit**

```bash
pnpm typecheck
git add packages/extension/src/extension.ts
git commit -m "extension: refresh trees when sortMode settings change"
```

---

## Task 24: End-to-end manual smoke test

**Files:** none (manual test pass).

The UI cannot be unit-tested in this harness — run through each scenario in a fresh VS Code Extension Host (`pnpm package:install` then reload window), and **state the result of each step in the chat before claiming the task complete** (per verification-before-completion).

1. With default settings, drag a bookmark within a single file in **All Bookmarks**. Reload window. Order persists.
2. With `showFilesInAllBookmarks` toggled off, the same bookmark appears in the flat list. Its position in flat mode is independent (ctx `a` vs `f`).
3. Drag a bookmark **across files** in All Bookmarks (with files visible). No change, no error. Check the developer output for the silent-ignore.
4. In **Files & Groups**, drag a group within a file. Persists. Drag a group across files: ignored.
5. Drag a bookmark within a group. Persists. Drag across groups: ignored.
6. In a multi-root workspace, drag a `RegFileNode` within one workspace folder. Persists. Drag across workspace folders: ignored.
7. Flip All Bookmarks sort mode to `recent` via the Settings tree row. Order changes to updatedAt-desc. Flip back to `user`: ranks restored.
8. Toggle `agenticBookmarks.dev.enableMultiSelectDrag` on. Select two bookmarks in the same file, drag together. Both reorder, preserving relative order at target. With the flag off, only single-select drag works.
9. Manually corrupt `<workspace>/.bookmarks/local/.cache/ordering.json` (overwrite with `garbage`). Reload window. Tree still loads. Check that the cache recovered from `ordering.json.bak` if present, or fell back to empty cache cleanly.

**Step 1: Run through each scenario. Record results.**

**Step 2: If any scenario fails — stop and debug before committing.** Use `superpowers:systematic-debugging`.

**Step 3: When all scenarios pass, commit a small note**

If any minor fixes were applied during smoke testing, commit them with a focused message. No commit needed if all scenarios passed without changes.

---

## Task 25: Final verification

**Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all green.

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

**Step 3: Run lint**

Run: `pnpm lint`
Expected: clean (or warnings only — match repo standard).

**Step 4: Report**

Summarize: tasks done, files added/changed, manual smoke results, anything deferred to follow-up tickets (multi-select context menus per design doc § Out of scope).

---

## Notes for the executor

- **Each task is meant to be a single sub-agent invocation.** Don't batch.
- **If `pnpm test` ever has unrelated failures**, surface them and ask before continuing — don't paper over them.
- **The design doc is the source of truth.** If a step here contradicts it, prefer the design doc and surface the discrepancy.
- **Future-task TODO markers** at every ignore site in `dnd-controller.ts` and `dnd-validation.ts` should reference the deferred work listed in the design doc.
