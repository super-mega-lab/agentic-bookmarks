# Scan All & Repair All rows — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two independent action rows ("Scan All", "Repair All") to the top of the All Bookmarks tree view — Scan validates every bookmarked file without opening tabs and reports coverage; Repair All reflects the known-broken set and launches an agent-driven repair session.

**Architecture:** Pure, unit-tested helpers (label/icon formatting, throttle chunking, agent selection, command-string building, broken-count) plus thin VS Code glue. A new `ScanQueue` (mirroring `AnchorRepairQueue`'s debounce/yield style) drains bookmarked files through `openTextDocument` (no tabs), riding the existing resolution → auto-repair path. A session-scoped "validated files" set provides scan coverage decoupled from `anchorState` eviction. A new agent-repair launch module is reusable beyond the button.

**Tech Stack:** TypeScript, VS Code extension API, vitest, tsup. Workspace dep `@agentic-bookmarks/core`. Pure JS, no native deps.

**Companion design:** `docs/plans/2026-05-20-scan-repair-rows-design.md`.

---

## Conventions for the executor

- **Build/typecheck/lint/test** from repo root: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- **Single test file:** `pnpm test packages/extension/src/<file>.test.ts` (vitest, single pass). Tests live next to source as `*.test.ts`.
- **0-based line/column indices everywhere** in code/storage; user-facing strings are 1-based. The counts here are file/bookmark counts, not line indices — no conversion needed.
- ESLint: 2-space indent, single quotes, semicolons.
- All files start with the two-line `// ABOUTME:` comment pattern used across `packages/extension/src`.
- Commit after each task with the message shown in its final step.
- Use **@superpowers:test-driven-development** for every task that has a `*.test.ts` (write failing test → run → implement → run → commit).
- VS Code glue (queue wiring, tree rows, command registration) can't be unit-tested without the editor; for those tasks the "test" is `pnpm typecheck` + `pnpm lint` + the manual smoke in the final task. Keep logic in the injectable pure helpers so it *is* tested.

### New identifiers introduced (reference)

| Thing | Value |
|---|---|
| Scan command | `agenticBookmarks.scanAll` |
| Repair command | `agenticBookmarks.repairAll` |
| Repair settings (gear) command | `agenticBookmarks.repairAllSettings` |
| Scan row `contextValue` | `scanAllRow` |
| Repair row `contextValue` | `repairAllRow` |
| Default-agent global key | `agenticBookmarks.repairAgentDefault` |
| Consent global key | `agenticBookmarks.agentRepairConsentV1` |
| Repair prompt | `Please use the agentic-bookmarks MCP to repair all broken bookmarks.` |

---

## Task 1: `AnchorRepairQueue.isIdle()`

The Repair All row must freeze its count while auto-repair is draining. Expose an idle check.

**Files:**
- Modify: `packages/extension/src/repairQueue.ts`
- Test: `packages/extension/src/repairQueue.isIdle.test.ts` (new)

**Step 1: Write the failing test**

```typescript
// ABOUTME: Tests for AnchorRepairQueue.isIdle() — the signal the action rows use
// ABOUTME: to avoid refreshing broken counts while auto-repair is mid-flight.
import { describe, it, expect, vi } from 'vitest';
import { AnchorRepairQueue } from './repairQueue';

// Minimal deps — none are called by isIdle(), so stubs suffice.
function makeQueue(): AnchorRepairQueue {
  return new AnchorRepairQueue({
    getBrokenAnchors: () => [],
    getDeepFlexAnchors: () => [],
    getBookmarkAnchor: async () => null,
    findRepairCandidate: (async () => ({ bookmarkId: 'x', status: 'skipped' })) as any,
    applyRepair: async () => false,
    updateAnchorState: () => {},
    updateDeepFlexState: () => {},
    refreshUI: () => {},
    getFileLines: () => null,
    log: () => {},
  });
}

describe('AnchorRepairQueue.isIdle', () => {
  it('is idle when freshly constructed', () => {
    expect(makeQueue().isIdle()).toBe(true);
  });

  it('is not idle once a URI is enqueued (debounce timer pending)', () => {
    // autoRepair defaults to true via vscode mock; enqueue sets the debounce timer.
    const q = makeQueue();
    q.enqueue('file:///a.ts');
    expect(q.isIdle()).toBe(false);
  });

  it('returns idle again after dispose clears timers', () => {
    const q = makeQueue();
    q.enqueue('file:///a.ts');
    q.dispose();
    expect(q.isIdle()).toBe(true);
  });
});
```

> Note: `packages/extension/src/repairQueue.ts` reads `vscode.workspace.getConfiguration(...)`. There must already be a vitest `vscode` mock (other extension tests import code that touches `vscode`). If the test fails to resolve `vscode`, check `packages/extension/vitest.config.*` / existing `__mocks__` and follow the same pattern an existing passing test uses. If `enqueue` bails because the mock returns `autoRepair=false`, assert idle behavior via `enqueueDeepFlexOnly` instead (not autoRepair-gated).

**Step 2: Run to verify it fails**

Run: `pnpm test packages/extension/src/repairQueue.isIdle.test.ts`
Expected: FAIL — `q.isIdle is not a function`.

**Step 3: Implement**

Add to `AnchorRepairQueue` (after `dispose()`):

```typescript
  /**
   * True when both queues are drained and no processing/debounce is in flight.
   * Used by the action rows to avoid refreshing counts mid-repair.
   */
  isIdle(): boolean {
    return (
      !this.processing &&
      this.pending.size === 0 &&
      this.pendingDeepFlex.size === 0 &&
      this.debounceTimer === null &&
      this.deepFlexDebounceTimer === null
    );
  }
```

**Step 4: Run to verify it passes**

Run: `pnpm test packages/extension/src/repairQueue.isIdle.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/extension/src/repairQueue.ts packages/extension/src/repairQueue.isIdle.test.ts
git commit -m "feat(repairQueue): expose isIdle() for action-row count gating"
```

---

## Task 2: Scan-coverage session set

"Scanned" = bookmarked files validated this session. This module owns that set, fed by both normal file-opens and the scan queue. Decoupling it from `anchorState` resolves the eviction risk noted in the design (docs opened-but-never-shown may get `clearStateForFile`'d).

**Files:**
- Create: `packages/extension/src/scanCoverage.ts`
- Test: `packages/extension/src/scanCoverage.test.ts`

**Step 1: Write the failing test**

```typescript
// ABOUTME: Tests for the session-scoped validated-files set backing Scan coverage.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  markFileValidated,
  isFileValidated,
  countValidatedAmong,
  resetScanCoverage,
} from './scanCoverage';

describe('scanCoverage', () => {
  beforeEach(() => resetScanCoverage());

  it('records and reports validated files', () => {
    expect(isFileValidated('/ws/a.ts')).toBe(false);
    markFileValidated('/ws/a.ts');
    expect(isFileValidated('/ws/a.ts')).toBe(true);
  });

  it('counts how many of a candidate set are validated', () => {
    markFileValidated('/ws/a.ts');
    markFileValidated('/ws/c.ts');
    const total = new Set(['/ws/a.ts', '/ws/b.ts', '/ws/c.ts']);
    expect(countValidatedAmong(total)).toBe(2);
  });

  it('counts only members of the candidate set (validated extras ignored)', () => {
    markFileValidated('/ws/a.ts');
    markFileValidated('/ws/zzz.ts'); // not in candidate set
    expect(countValidatedAmong(new Set(['/ws/a.ts']))).toBe(1);
  });
});
```

**Step 2: Run to verify it fails**

Run: `pnpm test packages/extension/src/scanCoverage.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement**

```typescript
// ABOUTME: Session-scoped set of bookmarked files we've validated (opened/scanned)
// ABOUTME: this session. Backs the Scan All row's "X/Y scanned" coverage count.

// Keyed by absolute fsPath. Not persisted — coverage resets each session.
const validated = new Set<string>();

/** Mark a file as validated this session. */
export function markFileValidated(fsPath: string): void {
  validated.add(fsPath);
}

/** Whether a file has been validated this session. */
export function isFileValidated(fsPath: string): boolean {
  return validated.has(fsPath);
}

/** Count how many members of `candidateFsPaths` have been validated. */
export function countValidatedAmong(candidateFsPaths: Set<string>): number {
  let n = 0;
  for (const p of candidateFsPaths) if (validated.has(p)) n++;
  return n;
}

/** Test-only: clear the set. */
export function resetScanCoverage(): void {
  validated.clear();
}
```

**Step 4: Run to verify it passes**

Run: `pnpm test packages/extension/src/scanCoverage.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/extension/src/scanCoverage.ts packages/extension/src/scanCoverage.test.ts
git commit -m "feat(scan): add session-scoped validated-files coverage set"
```

---

## Task 3: `ScanQueue` (throttled, injectable)

A small queue that drains bookmarked-file paths through an injected `openDocument`, batching 5 files then sleeping ~200ms, marking each validated, and waiting for the repair queue to go idle before the final refresh. All side effects are injected so it is unit-testable without VS Code.

**Files:**
- Create: `packages/extension/src/scanQueue.ts`
- Test: `packages/extension/src/scanQueue.test.ts`

**Step 1: Write the failing test**

```typescript
// ABOUTME: Tests for ScanQueue — batched, throttled validation of bookmarked files
// ABOUTME: with injected open/delay/idle so no VS Code or real timers are needed.
import { describe, it, expect, vi } from 'vitest';
import { ScanQueue } from './scanQueue';

function deps(over: Partial<ConstructorParameters<typeof ScanQueue>[0]> = {}) {
  const opened: string[] = [];
  const base = {
    openDocument: vi.fn(async (p: string) => { opened.push(p); }),
    markValidated: vi.fn(),
    isRepairIdle: vi.fn(() => true),
    onProgress: vi.fn(),
    delay: vi.fn(async () => {}),     // no real sleeping in tests
    log: vi.fn(),
    batchSize: 5,
    sleepMs: 200,
  };
  return { d: { ...base, ...over }, opened };
}

describe('ScanQueue', () => {
  it('opens every target and marks each validated', async () => {
    const { d, opened } = deps();
    const q = new ScanQueue(d);
    await q.run(['/ws/a.ts', '/ws/b.ts', '/ws/c.ts']);
    expect(opened).toEqual(['/ws/a.ts', '/ws/b.ts', '/ws/c.ts']);
    expect(d.markValidated).toHaveBeenCalledTimes(3);
  });

  it('sleeps once per completed batch of batchSize', async () => {
    const { d } = deps({ batchSize: 2 });
    const q = new ScanQueue(d);
    await q.run(['a', 'b', 'c', 'd', 'e']); // batches: [a,b][c,d][e] -> 2 sleeps after full batches
    expect(d.delay).toHaveBeenCalledTimes(2);
  });

  it('reports running state and progress', async () => {
    const { d } = deps();
    const q = new ScanQueue(d);
    expect(q.isRunning()).toBe(false);
    const p = q.run(['a', 'b']);
    expect(q.isRunning()).toBe(true);
    await p;
    expect(q.isRunning()).toBe(false);
    expect(q.scannedThisRun()).toBe(2);
    expect(d.onProgress).toHaveBeenCalled();
  });

  it('continues past a file that fails to open', async () => {
    const openDocument = vi.fn(async (p: string) => {
      if (p === 'bad') throw new Error('nope');
    });
    const { d } = deps({ openDocument });
    const q = new ScanQueue(d);
    await q.run(['ok1', 'bad', 'ok2']);
    expect(d.markValidated).toHaveBeenCalledWith('ok1');
    expect(d.markValidated).toHaveBeenCalledWith('ok2');
    expect(d.markValidated).not.toHaveBeenCalledWith('bad');
  });

  it('cancel() stops further opens', async () => {
    const openDocument = vi.fn(async (p: string) => {
      if (p === 'b') q.cancel();
    });
    const { d } = deps({ openDocument });
    const q = new ScanQueue(d);
    await q.run(['a', 'b', 'c', 'd']);
    // a and b open; cancel during b prevents c, d.
    expect(openDocument).toHaveBeenCalledTimes(2);
  });

  it('waits for repair queue to become idle before final progress', async () => {
    let idle = false;
    const isRepairIdle = vi.fn(() => idle);
    const delay = vi.fn(async () => { idle = true; }); // becomes idle after one poll
    const { d } = deps({ isRepairIdle, delay });
    const q = new ScanQueue(d);
    await q.run(['a']);
    expect(isRepairIdle).toHaveBeenCalled();
  });
});
```

**Step 2: Run to verify it fails**

Run: `pnpm test packages/extension/src/scanQueue.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement**

```typescript
// ABOUTME: Throttled scan queue — drains bookmarked files through an injected
// ABOUTME: openDocument (no editor tabs), batching + sleeping to stay CPU-friendly.

export interface ScanQueueDeps {
  /** Load a file so its anchors resolve (e.g. via workspace.openTextDocument). */
  openDocument: (fsPath: string) => Promise<void>;
  /** Record a file as validated for coverage tracking. */
  markValidated: (fsPath: string) => void;
  /** Whether the auto-repair queue is idle (drained). */
  isRepairIdle: () => boolean;
  /** Called when running-state or progress changes (drives a tree refresh). */
  onProgress: () => void;
  /** Sleep helper — injected so tests don't use real timers. */
  delay: (ms: number) => Promise<void>;
  log: (msg: string) => void;
  /** Files per batch before sleeping. Default 5. */
  batchSize?: number;
  /** Sleep between batches, ms. Default 200. */
  sleepMs?: number;
}

const MAX_IDLE_POLLS = 40; // ~6s at 150ms; bounds the post-scan idle wait.

export class ScanQueue {
  private running = false;
  private cancelled = false;
  private scanned = 0;
  private total = 0;

  constructor(private readonly deps: ScanQueueDeps) {}

  isRunning(): boolean { return this.running; }
  scannedThisRun(): number { return this.scanned; }
  totalThisRun(): number { return this.total; }

  cancel(): void { this.cancelled = true; }

  /**
   * Validate every target, batching + sleeping between batches. Per-file failures
   * are logged and skipped. After draining, waits (bounded) for the repair queue
   * to go idle so the final refresh reflects post-auto-repair truth.
   */
  async run(fsPaths: string[]): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.cancelled = false;
    this.scanned = 0;
    this.total = fsPaths.length;
    const batchSize = this.deps.batchSize ?? 5;
    const sleepMs = this.deps.sleepMs ?? 200;
    this.deps.onProgress();

    try {
      let inBatch = 0;
      for (const fsPath of fsPaths) {
        if (this.cancelled) break;
        try {
          await this.deps.openDocument(fsPath);
          this.deps.markValidated(fsPath);
        } catch (err) {
          this.deps.log(`[scan] failed to load ${fsPath}: ${(err as Error)?.message ?? err}`);
        }
        this.scanned++;
        this.deps.onProgress();
        inBatch++;
        if (inBatch >= batchSize) {
          inBatch = 0;
          await this.deps.delay(sleepMs);
        }
      }

      // Let auto-repair (kicked off by the opens above) drain before final refresh.
      for (let i = 0; i < MAX_IDLE_POLLS && !this.deps.isRepairIdle(); i++) {
        await this.deps.delay(150);
      }
    } finally {
      this.running = false;
      this.deps.onProgress();
    }
  }
}
```

**Step 4: Run to verify it passes**

Run: `pnpm test packages/extension/src/scanQueue.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/extension/src/scanQueue.ts packages/extension/src/scanQueue.test.ts
git commit -m "feat(scan): add throttled ScanQueue with injectable side effects"
```

---

## Task 4: Action-row label/icon pure helpers

Pure formatters for the two rows' labels, icons, and `contextValue`s. No VS Code import — return plain descriptors the provider maps to `TreeItem`s. This keeps the display logic tested.

**Files:**
- Create: `packages/extension/src/views/action-rows.ts`
- Test: `packages/extension/src/views/action-rows.test.ts`

**Step 1: Write the failing test**

```typescript
// ABOUTME: Tests for pure label/icon descriptors of the Scan All / Repair All rows.
import { describe, it, expect } from 'vitest';
import { scanRowDescriptor, repairRowDescriptor } from './action-rows';

describe('scanRowDescriptor', () => {
  it('shows coverage at rest', () => {
    const d = scanRowDescriptor({ scanned: 3, total: 43, running: false });
    expect(d.label).toBe('Scan All — 3/43 scanned');
    expect(d.icon).toBe('run-all');
    expect(d.spin).toBe(false);
  });
  it('shows progress + spinner while running', () => {
    const d = scanRowDescriptor({ scanned: 18, total: 43, running: true });
    expect(d.label).toBe('Scanning… 18/43');
    expect(d.icon).toBe('sync');
    expect(d.spin).toBe(true);
  });
  it('handles zero bookmarked files', () => {
    const d = scanRowDescriptor({ scanned: 0, total: 0, running: false });
    expect(d.label).toBe('Scan All — 0/0 scanned');
  });
});

describe('repairRowDescriptor', () => {
  it('reports no errors when nothing is broken', () => {
    const d = repairRowDescriptor({ broken: 0, total: 12 });
    expect(d.label).toBe('Repair All — no errors');
    expect(d.icon).toBe('pass-filled');
    expect(d.themeColor).toBe('charts.green');
    expect(d.actionable).toBe(false);
  });
  it('reports broken count with error styling', () => {
    const d = repairRowDescriptor({ broken: 4, total: 43 });
    expect(d.label).toBe('Repair All — 4/43 broken');
    expect(d.icon).toBe('error');
    expect(d.themeColor).toBe('charts.red');
    expect(d.actionable).toBe(true);
  });
});
```

**Step 2: Run to verify it fails**

Run: `pnpm test packages/extension/src/views/action-rows.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement**

```typescript
// ABOUTME: Pure descriptors for the Scan All / Repair All action rows. No VS Code
// ABOUTME: dependency — the tree provider maps these to TreeItems + ThemeIcons.

export interface ScanRowDescriptor {
  label: string;
  icon: string;        // ThemeIcon id
  spin: boolean;       // append ~spin when true
  contextValue: 'scanAllRow';
}

export interface RepairRowDescriptor {
  label: string;
  icon: string;            // ThemeIcon id
  themeColor: string;      // ThemeColor id
  actionable: boolean;     // false when nothing is broken (click is a no-op)
  contextValue: 'repairAllRow';
}

export function scanRowDescriptor(s: { scanned: number; total: number; running: boolean }): ScanRowDescriptor {
  return s.running
    ? { label: `Scanning… ${s.scanned}/${s.total}`, icon: 'sync', spin: true, contextValue: 'scanAllRow' }
    : { label: `Scan All — ${s.scanned}/${s.total} scanned`, icon: 'run-all', spin: false, contextValue: 'scanAllRow' };
}

export function repairRowDescriptor(s: { broken: number; total: number }): RepairRowDescriptor {
  return s.broken === 0
    ? { label: 'Repair All — no errors', icon: 'pass-filled', themeColor: 'charts.green', actionable: false, contextValue: 'repairAllRow' }
    : { label: `Repair All — ${s.broken}/${s.total} broken`, icon: 'error', themeColor: 'charts.red', actionable: true, contextValue: 'repairAllRow' };
}
```

**Step 4: Run to verify it passes**

Run: `pnpm test packages/extension/src/views/action-rows.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/extension/src/views/action-rows.ts packages/extension/src/views/action-rows.test.ts
git commit -m "feat(view): add pure descriptors for Scan/Repair action rows"
```

---

## Task 5: Broken-count helper

Counts genuinely-broken anchors from `BrokenAnchorEntry[]` (warnings excluded — they show as normal node decorations, per design out-of-scope). Pure; the provider reads the cache and passes entries in.

**Files:**
- Create: `packages/extension/src/brokenCount.ts`
- Test: `packages/extension/src/brokenCount.test.ts`

**Step 1: Write the failing test**

```typescript
// ABOUTME: Tests for counting genuinely-broken anchors (warnings excluded).
import { describe, it, expect } from 'vitest';
import { countBroken } from './brokenCount';

const e = (status: 'broken' | 'warning', bookmarkId: string) =>
  ({ bookmarkId, uri: 'x', status, errorCode: null, errorDetails: null, score: null, discoveredAt: 0 });

describe('countBroken', () => {
  it('counts only broken, not warning', () => {
    expect(countBroken([e('broken', 'a'), e('warning', 'b'), e('broken', 'c')])).toBe(2);
  });
  it('dedupes by bookmarkId', () => {
    expect(countBroken([e('broken', 'a'), e('broken', 'a')])).toBe(1);
  });
  it('handles empty', () => {
    expect(countBroken([])).toBe(0);
  });
});
```

**Step 2: Run to verify it fails**

Run: `pnpm test packages/extension/src/brokenCount.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement**

```typescript
// ABOUTME: Pure helper to count genuinely-broken anchors from broken-anchors cache
// ABOUTME: entries. Warnings are excluded; broken bookmarkIds are deduped.
import type { brokenAnchorsCache } from '@agentic-bookmarks/core';

export function countBroken(entries: brokenAnchorsCache.BrokenAnchorEntry[]): number {
  const ids = new Set<string>();
  for (const e of entries) if (e.status === 'broken') ids.add(e.bookmarkId);
  return ids.size;
}
```

> Verify the import shape: `brokenAnchorsCache.BrokenAnchorEntry` is how `brokenAnchorsSync.ts` references it. If a direct named type export exists, prefer `import type { BrokenAnchorEntry }` — match whatever `brokenAnchorsSync.ts` does.

**Step 4: Run to verify it passes**

Run: `pnpm test packages/extension/src/brokenCount.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/extension/src/brokenCount.ts packages/extension/src/brokenCount.test.ts
git commit -m "feat(repair): add pure broken-anchor count helper"
```

---

## Task 6: Agent-repair pure helpers (selection + command string)

Decide which agent to launch given connected agents + saved default, and build the terminal command (or signal clipboard fallback). Pure and fully tested.

**Files:**
- Create: `packages/extension/src/commands/agent-repair-helpers.ts`
- Test: `packages/extension/src/commands/agent-repair-helpers.test.ts`

**Step 1: Write the failing test**

```typescript
// ABOUTME: Tests for agent-repair selection logic and command-string construction.
import { describe, it, expect } from 'vitest';
import {
  REPAIR_PROMPT,
  pickAgentToLaunch,
  buildAgentLaunch,
} from './agent-repair-helpers';

describe('pickAgentToLaunch', () => {
  it('asks to connect when no agents are connected', () => {
    expect(pickAgentToLaunch({ connected: [], preferred: undefined }))
      .toEqual({ action: 'connect' });
  });
  it('launches the only connected agent', () => {
    expect(pickAgentToLaunch({ connected: ['claude'], preferred: undefined }))
      .toEqual({ action: 'launch', agent: 'claude' });
  });
  it('uses the saved preference when set and still connected', () => {
    expect(pickAgentToLaunch({ connected: ['claude', 'codex'], preferred: 'codex' }))
      .toEqual({ action: 'launch', agent: 'codex' });
  });
  it('asks the user to choose when 2+ connected and no valid preference', () => {
    expect(pickAgentToLaunch({ connected: ['claude', 'codex'], preferred: undefined }))
      .toEqual({ action: 'choose', agents: ['claude', 'codex'] });
  });
  it('ignores a preference that is no longer connected', () => {
    expect(pickAgentToLaunch({ connected: ['claude', 'codex'], preferred: 'cursor' }))
      .toEqual({ action: 'choose', agents: ['claude', 'codex'] });
  });
});

describe('buildAgentLaunch', () => {
  it('builds a terminal command for claude', () => {
    expect(buildAgentLaunch('claude')).toEqual({
      method: 'terminal',
      command: `claude "${REPAIR_PROMPT}"`,
    });
  });
  it('builds a terminal command for codex', () => {
    expect(buildAgentLaunch('codex')).toEqual({
      method: 'terminal',
      command: `codex "${REPAIR_PROMPT}"`,
    });
  });
  it('falls back to clipboard for cursor', () => {
    expect(buildAgentLaunch('cursor')).toEqual({
      method: 'clipboard',
      text: REPAIR_PROMPT,
    });
  });
});
```

**Step 2: Run to verify it fails**

Run: `pnpm test packages/extension/src/commands/agent-repair-helpers.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement**

```typescript
// ABOUTME: Pure agent-repair helpers — choose which connected agent to launch and
// ABOUTME: build the launch command. No VS Code dependency for testability.
import type { McpAgent } from './mcp-install-state';

export const REPAIR_PROMPT =
  'Please use the agentic-bookmarks MCP to repair all broken bookmarks.';

export type LaunchDecision =
  | { action: 'connect' }
  | { action: 'launch'; agent: McpAgent }
  | { action: 'choose'; agents: McpAgent[] };

/** Decide what clicking Repair All should do, given connected agents + saved default. */
export function pickAgentToLaunch(input: {
  connected: McpAgent[];
  preferred: McpAgent | undefined;
}): LaunchDecision {
  const connected = dedupe(input.connected);
  if (connected.length === 0) return { action: 'connect' };
  if (input.preferred && connected.includes(input.preferred)) {
    return { action: 'launch', agent: input.preferred };
  }
  if (connected.length === 1) return { action: 'launch', agent: connected[0] };
  return { action: 'choose', agents: connected };
}

export type AgentLaunch =
  | { method: 'terminal'; command: string }
  | { method: 'clipboard'; text: string };

/** Terminal launch for agents with a headless prompt CLI; clipboard for the rest. */
export function buildAgentLaunch(agent: McpAgent): AgentLaunch {
  switch (agent) {
    case 'claude':
      return { method: 'terminal', command: `claude "${REPAIR_PROMPT}"` };
    case 'codex':
      return { method: 'terminal', command: `codex "${REPAIR_PROMPT}"` };
    case 'cursor':
    default:
      return { method: 'clipboard', text: REPAIR_PROMPT };
  }
}

function dedupe(xs: McpAgent[]): McpAgent[] {
  return Array.from(new Set(xs));
}
```

**Step 4: Run to verify it passes**

Run: `pnpm test packages/extension/src/commands/agent-repair-helpers.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/extension/src/commands/agent-repair-helpers.ts packages/extension/src/commands/agent-repair-helpers.test.ts
git commit -m "feat(repair): add pure agent selection + launch-command helpers"
```

---

## Task 7: Repair-agent state (default preference + consent)

Small persisted-state helpers over `globalState`, mirroring the existing `mcp-install-state.ts` style. The default preference and one-time consent flag.

**Files:**
- Create: `packages/extension/src/commands/repair-agent-state.ts`
- Test: `packages/extension/src/commands/repair-agent-state.test.ts`

**Step 1: Write the failing test**

```typescript
// ABOUTME: Tests for repair-agent default-preference + consent persistence helpers.
import { describe, it, expect } from 'vitest';
import {
  getRepairAgentDefault,
  setRepairAgentDefault,
  hasRepairConsent,
  recordRepairConsent,
} from './repair-agent-state';

// Fake of the slice of ExtensionContext we use.
function fakeCtx() {
  const g = new Map<string, unknown>();
  return {
    globalState: {
      get: <T>(k: string) => g.get(k) as T | undefined,
      update: async (k: string, v: unknown) => { g.set(k, v); },
    },
  } as any;
}

describe('repair-agent-state', () => {
  it('round-trips the default agent', async () => {
    const ctx = fakeCtx();
    expect(getRepairAgentDefault(ctx)).toBeUndefined();
    await setRepairAgentDefault(ctx, 'codex');
    expect(getRepairAgentDefault(ctx)).toBe('codex');
  });
  it('tracks one-time consent', async () => {
    const ctx = fakeCtx();
    expect(hasRepairConsent(ctx)).toBe(false);
    await recordRepairConsent(ctx);
    expect(hasRepairConsent(ctx)).toBe(true);
  });
});
```

**Step 2: Run to verify it fails**

Run: `pnpm test packages/extension/src/commands/repair-agent-state.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement**

```typescript
// ABOUTME: Persisted state for agent-driven repair — the default agent preference
// ABOUTME: and the one-time "agent runs locally" consent flag (both globalState).
import type * as vscode from 'vscode';
import type { McpAgent } from './mcp-install-state';

const DEFAULT_KEY = 'agenticBookmarks.repairAgentDefault';
const CONSENT_KEY = 'agenticBookmarks.agentRepairConsentV1';

export function getRepairAgentDefault(ctx: vscode.ExtensionContext): McpAgent | undefined {
  return ctx.globalState.get<McpAgent>(DEFAULT_KEY);
}

export async function setRepairAgentDefault(ctx: vscode.ExtensionContext, agent: McpAgent): Promise<void> {
  await ctx.globalState.update(DEFAULT_KEY, agent);
}

export function hasRepairConsent(ctx: vscode.ExtensionContext): boolean {
  return ctx.globalState.get<boolean>(CONSENT_KEY) === true;
}

export async function recordRepairConsent(ctx: vscode.ExtensionContext): Promise<void> {
  await ctx.globalState.update(CONSENT_KEY, true);
}
```

**Step 4: Run to verify it passes**

Run: `pnpm test packages/extension/src/commands/repair-agent-state.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/extension/src/commands/repair-agent-state.ts packages/extension/src/commands/repair-agent-state.test.ts
git commit -m "feat(repair): persist default repair agent + one-time consent"
```

---

## Task 8: Agent-repair command registration (glue)

Wire the pure helpers into two registered commands: `repairAll` (the click) and `repairAllSettings` (the gear). This is VS Code glue — verified by typecheck/lint + the manual smoke. Keep all branching logic delegated to Task 6/7 helpers.

**Files:**
- Create: `packages/extension/src/commands/agent-repair-launch.ts`

**Step 1: Implement the module**

```typescript
// ABOUTME: VS Code glue registering Repair All (agent launch) + its gear settings.
// ABOUTME: Decision logic lives in agent-repair-helpers; persistence in repair-agent-state.
import * as vscode from 'vscode';
import {
  AGENT_DISPLAY_NAMES,
  getMcpInstallRecords,
  type McpAgent,
} from './mcp-install-state';
import {
  pickAgentToLaunch,
  buildAgentLaunch,
  REPAIR_PROMPT,
} from './agent-repair-helpers';
import {
  getRepairAgentDefault,
  setRepairAgentDefault,
  hasRepairConsent,
  recordRepairConsent,
} from './repair-agent-state';

export interface AgentRepairDeps {
  context: vscode.ExtensionContext;
  workspaceRoot: string;
  log: { info(m: string): void; error(m: string): void };
}

const SETUP_COMMAND: Record<McpAgent, string> = {
  claude: 'agenticBookmarks.setupClaude',
  cursor: 'agenticBookmarks.setupCursor',
  codex: 'agenticBookmarks.setupCodex',
};

function connectedAgents(context: vscode.ExtensionContext): McpAgent[] {
  return Array.from(new Set(getMcpInstallRecords(context).map((e) => e.agent)));
}

async function ensureConsent(context: vscode.ExtensionContext): Promise<boolean> {
  if (hasRepairConsent(context)) return true;
  const proceed = 'Run repair';
  const choice = await vscode.window.showInformationMessage(
    'Repairing broken bookmarks runs a local AI agent of your choice — you’ll see it run in a terminal. ' +
      'It uses your agent’s own billing. Agentic Bookmarks sends no code or telemetry to the cloud.',
    { modal: true },
    proceed,
  );
  if (choice !== proceed) return false;
  await recordRepairConsent(context);
  return true;
}

async function launchAgent(deps: AgentRepairDeps, agent: McpAgent): Promise<void> {
  const launch = buildAgentLaunch(agent);
  if (launch.method === 'terminal') {
    const terminal = vscode.window.createTerminal({
      name: `Repair Bookmarks (${AGENT_DISPLAY_NAMES[agent]})`,
      cwd: deps.workspaceRoot, // so the agent's MCP stdio discovery finds .bookmarks
    });
    terminal.show();
    terminal.sendText(launch.command, true);
    deps.log.info(`[repairAll] launched ${agent} in terminal`);
  } else {
    await vscode.env.clipboard.writeText(launch.text);
    vscode.window.showInformationMessage(
      `Repair prompt copied to clipboard — paste it into ${AGENT_DISPLAY_NAMES[agent]}.`,
    );
  }
}

async function chooseAgent(agents: McpAgent[]): Promise<McpAgent | undefined> {
  const pick = await vscode.window.showQuickPick(
    agents.map((a) => ({ label: AGENT_DISPLAY_NAMES[a], agent: a })),
    { placeHolder: 'Choose an agent to repair broken bookmarks' },
  );
  return pick?.agent;
}

async function offerConnect(): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    (['claude', 'codex', 'cursor'] as McpAgent[]).map((a) => ({ label: `Connect ${AGENT_DISPLAY_NAMES[a]}`, agent: a })),
    { placeHolder: 'No agent connected — connect one to enable repair' },
  );
  if (pick) await vscode.commands.executeCommand(SETUP_COMMAND[pick.agent]);
}

export function registerAgentRepairCommands(deps: AgentRepairDeps): vscode.Disposable[] {
  const { context } = deps;
  return [
    vscode.commands.registerCommand('agenticBookmarks.repairAll', async () => {
      const decision = pickAgentToLaunch({
        connected: connectedAgents(context),
        preferred: getRepairAgentDefault(context),
      });
      if (decision.action === 'connect') { await offerConnect(); return; }
      if (!(await ensureConsent(context))) return;
      let agent: McpAgent | undefined;
      if (decision.action === 'launch') {
        agent = decision.agent;
      } else {
        agent = await chooseAgent(decision.agents);
        if (agent) await setRepairAgentDefault(context, agent); // remember the choice
      }
      if (agent) await launchAgent(deps, agent);
    }),

    vscode.commands.registerCommand('agenticBookmarks.repairAllSettings', async () => {
      const connected = connectedAgents(context);
      const current = getRepairAgentDefault(context);
      const items: Array<vscode.QuickPickItem & { agent?: McpAgent; connect?: boolean }> = [];
      for (const a of connected) {
        items.push({
          label: `${current === a ? '$(check) ' : ''}Use ${AGENT_DISPLAY_NAMES[a]}`,
          agent: a,
        });
      }
      items.push({ label: '$(plus) Connect another agent…', connect: true });
      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: current
          ? `Default repair agent: ${AGENT_DISPLAY_NAMES[current]}`
          : 'No default repair agent set',
      });
      if (!pick) return;
      if (pick.connect) { await offerConnect(); return; }
      if (pick.agent) {
        await setRepairAgentDefault(context, pick.agent);
        vscode.window.showInformationMessage(`Repair agent set to ${AGENT_DISPLAY_NAMES[pick.agent]}.`);
      }
    }),
  ];
}
```

**Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS (no type errors in the new module).

> If `vscode.window.createTerminal({ cwd })` types complain, `cwd` accepts a string path — confirm against the version of `@types/vscode` in the repo; an existing `createTerminal` call (Task ref: `applyClaudeSetup`) uses the string-name overload, so the options-object overload is available in the same typings.

**Step 3: Commit**

```bash
git add packages/extension/src/commands/agent-repair-launch.ts
git commit -m "feat(repair): register Repair All agent-launch + gear settings commands"
```

---

## Task 9: package.json contributions (commands + menus)

Declare the three commands and wire the rows' inline gear + click behavior. Activation: the view is already contributed; commands are registered at activation.

**Files:**
- Modify: `packages/extension/package.json`

**Step 1: Add commands** (in `contributes.commands`, near the other `agenticBookmarks.*` view commands):

```json
{
  "command": "agenticBookmarks.scanAll",
  "title": "Scan All Bookmarked Files",
  "category": "Agentic Bookmarks",
  "icon": "$(run-all)"
},
{
  "command": "agenticBookmarks.repairAll",
  "title": "Repair All Broken Bookmarks",
  "category": "Agentic Bookmarks",
  "icon": "$(wrench)"
},
{
  "command": "agenticBookmarks.repairAllSettings",
  "title": "Repair All: Settings",
  "category": "Agentic Bookmarks",
  "icon": "$(gear)"
}
```

**Step 2: Add the gear inline button** (in `contributes.menus."view/item/context"`, alongside the `filterInfo`/`subSearch` entries):

```json
{
  "command": "agenticBookmarks.repairAllSettings",
  "when": "view == agenticBookmarks.view && viewItem == repairAllRow",
  "group": "inline@0"
}
```

> The Scan All and Repair All *rows themselves* are made clickable via `TreeItem.command` in Task 10 (not a menu contribution). The gear is the only inline menu button.

**Step 3: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. (package.json JSON must stay valid — watch trailing commas.)

**Step 4: Commit**

```bash
git add packages/extension/package.json
git commit -m "feat(view): contribute scanAll/repairAll/repairAllSettings commands + gear"
```

---

## Task 10: Render the rows in the tree provider

Add the two rows to the root of the All Bookmarks tree, directly after the `filterInfo` row. Inject the dynamic data via new constructor deps (counts/state the provider can't compute alone).

**Files:**
- Modify: `packages/extension/src/treeProvider.ts`

**Step 1: Extend the constructor with an action-row data provider**

Add a constructor parameter (after `orderingService`):

```typescript
    private readonly getActionRowState: () => {
      scanRunning: boolean;
      scanned: number;       // validated files among bookmarked files
      brokenCount: number;   // genuinely-broken anchors (frozen while repair queue busy)
    },
```

> The provider already computes `totalBookmarks` and the set of bookmarked files in `getChildren`. Only the *dynamic* numbers (scan running/scanned, broken count) come from outside; pass those in. Keep `brokenCount` here read-through from a value the extension only updates when the repair queue is idle (see Task 12), satisfying the "freeze while auto-repair drains" requirement.

**Step 2: Track the bookmarked-file set + render rows**

In `getChildren`, inside the `if (!element)` branch:

- While iterating bookmarks, also collect the **distinct bookmarked file fsPaths** (unfiltered — count every bookmark's target, not just visible ones). Add near the existing `totalBookmarks++`:

```typescript
// (declare alongside totalBookmarks, before the folder loop)
const bookmarkedFsPaths = new Set<string>();
```

and where each bookmark's `absoluteUri` is computed (before the visibility `continue`s), record its fsPath:

```typescript
try {
  bookmarkedFsPaths.add(vscode.Uri.parse(absoluteUri).fsPath);
} catch { /* ignore unparseable URIs */ }
```

- After the `filterEnabled` block that pushes the `filterInfo` row (right after `nodes.push(info)` / the closing of that `if`), push the two action rows so they render directly below `filterInfo` (and at the very top when filtering is off):

```typescript
import { scanRowDescriptor, repairRowDescriptor } from './views/action-rows';
// ...
{
  const st = this.getActionRowState();
  const scan = scanRowDescriptor({
    scanned: st.scanned,
    total: bookmarkedFsPaths.size,
    running: st.scanRunning,
  });
  const scanRow = new vscode.TreeItem(scan.label, vscode.TreeItemCollapsibleState.None);
  scanRow.iconPath = new vscode.ThemeIcon(scan.spin ? `${scan.icon}~spin` : scan.icon);
  (scanRow as any).contextValue = scan.contextValue;
  scanRow.command = { command: 'agenticBookmarks.scanAll', title: 'Scan All' };
  nodes.push(scanRow);

  const repair = repairRowDescriptor({ broken: st.brokenCount, total: totalBookmarks });
  const repairRow = new vscode.TreeItem(repair.label, vscode.TreeItemCollapsibleState.None);
  repairRow.iconPath = new vscode.ThemeIcon(repair.icon, new vscode.ThemeColor(repair.themeColor));
  (repairRow as any).contextValue = repair.contextValue;
  // Always wire the click; the handler no-ops when nothing is broken.
  repairRow.command = { command: 'agenticBookmarks.repairAll', title: 'Repair All' };
  nodes.push(repairRow);
}
```

> Placement detail: the existing code builds `const nodes: vscode.TreeItem[] = []` then conditionally pushes `filterInfo`. Insert the block immediately after that `if (filterEnabled) { … }` so the two rows always appear, just below `filterInfo` when present. Both later return paths (`return nodes;` flat, and `return nodes.concat(sortedFiles);`) already include `nodes`, so the rows ride along in both view modes. The `~spin` suffix on a `ThemeIcon` id animates the codicon.

**Step 3: Confirm DnD/reveal exclusion**

No code change needed: `specOf` returns `null` for items that aren't `BookmarkNode`/`FileNode`, so the new rows are excluded from sibling/drag computations exactly like `filterInfo`. `getParent` returns `undefined` for them. Just re-read `specOf`/`resolveSiblings` to confirm after editing.

**Step 4: Verify**

Run: `pnpm typecheck`
Expected: PASS. (Provider construction will error until Task 12 passes the new arg — that's expected and fixed there. If you want a green typecheck at this commit, temporarily make the new constructor param optional with a default `() => ({ scanRunning: false, scanned: 0, brokenCount: 0 })`, then tighten in Task 12. Prefer the default-param approach so each commit builds.)

**Step 5: Commit**

```bash
git add packages/extension/src/treeProvider.ts
git commit -m "feat(view): render Scan All + Repair All rows below the filter row"
```

---

## Task 11: Scan command + ScanQueue wiring in extension.ts

Register `agenticBookmarks.scanAll`, instantiate the `ScanQueue`, feed coverage from file-opens, and collect targets with the existing visible-scope helpers.

**Files:**
- Modify: `packages/extension/src/extension.ts`
- Reuse: `collectTargets`-style logic from `commands/bookmark-bulk-open.ts` (visible scope) and `collectVisibleBookmarkedFiles`.

**Step 1: Feed coverage from normal opens**

Find `onFileOpened` (used at activation `for (const editor of vscode.window.visibleTextEditors) await onFileOpened(...)` and on active-editor-change). After it resolves anchors for a `file:`-scheme document, mark it validated:

```typescript
import { markFileValidated } from './scanCoverage';
// inside onFileOpened, after resolution completes, for file-scheme docs:
markFileValidated(document.uri.fsPath);
```

> Locate the exact spot by reading `onFileOpened` (it lives in extension.ts or an imported module). The requirement: every successful anchor resolution for a `file:` doc calls `markFileValidated(fsPath)`.

**Step 2: Instantiate the ScanQueue** (near the `repairQueue = new AnchorRepairQueue(...)` block, after `repairQueue` exists):

```typescript
import { ScanQueue } from './scanQueue';
// ...
const scanQueue = new ScanQueue({
  openDocument: async (fsPath: string) => {
    await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath)); // no tab
  },
  markValidated: (fsPath: string) => markFileValidated(fsPath),
  isRepairIdle: () => repairQueue?.isIdle() ?? true,
  onProgress: () => provider.refresh(),
  delay: (ms: number) => new Promise((r) => setTimeout(r, ms)),
  log: (m: string) => log.debug(m),
});
```

**Step 3: Register the scanAll command**

Add to the `context.subscriptions.push(...)` command registrations:

```typescript
vscode.commands.registerCommand('agenticBookmarks.scanAll', async () => {
  if (!vscode.workspace.workspaceFolders?.length) {
    vscode.window.showWarningMessage('No workspace folder open');
    return;
  }
  if (scanQueue.isRunning()) { scanQueue.cancel(); return; } // click again = cancel
  // Collect visible bookmarked files using the same helpers as scanAllFiles.
  const { folders, filesData } = await loadAllFolders(log, workspaceRoot);
  const ui = getUIState();
  const visibility = { hidden: ui.hidden, focus: ui.focus, filterEnabled: ui.filterEnabled === true, searches: ui.searches };
  const composed = composeFileHiddenPredicate(folders, filesData, visibility, isFileHidden);
  const targets = collectVisibleBookmarkedFiles({ filesData, visibility, composedIsFileHidden: composed });
  // Skip files already open (validated live).
  const openFsPaths = new Set(vscode.workspace.textDocuments.map((d) => d.uri.fsPath));
  const toScan = targets.map((t) => t.fsPath).filter((p) => !openFsPaths.has(p));
  await scanQueue.run(toScan);
});
```

> Import `loadAllFolders` from `./commands/bookmark-loaders`, `composeFileHiddenPredicate` from `./commands/bookmark-loaders-helpers`, and `collectVisibleBookmarkedFiles` from `./commands/bookmark-bulk-open-helpers` — the same imports `bookmark-bulk-open.ts` uses. If wiring gets verbose, factor the target-collection into an exported helper in `bookmark-bulk-open.ts` and reuse it (DRY) rather than duplicating.

**Step 4: Verify**

Run: `pnpm typecheck`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/extension/src/extension.ts
git commit -m "feat(scan): wire ScanQueue + scanAll command + coverage feed"
```

---

## Task 12: Feed action-row state into the provider

Provide the provider's `getActionRowState` and keep the broken count frozen while the repair queue is busy.

**Files:**
- Modify: `packages/extension/src/extension.ts`

**Step 1: Maintain a frozen broken count**

Add module-local state near the provider construction:

```typescript
import { readBrokenAnchorsCache, getCacheDir, getBookmarksDataRoot } from '@agentic-bookmarks/core';
import { countBroken } from './brokenCount';
// ...
let lastBrokenCount = 0;

async function recomputeBrokenCount(): Promise<void> {
  // Only update when repair queue is idle, so the number doesn't flicker mid-repair.
  if (repairQueue && !repairQueue.isIdle()) return;
  let total = 0;
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    try {
      const reg = await readRegistry(folder.uri.fsPath);
      const cacheDir = getCacheDir(folder.uri.fsPath, getBookmarksDataRoot(reg));
      const cache = await readBrokenAnchorsCache(cacheDir);
      total += countBroken(cache.entries);
    } catch { /* ignore folders without a cache */ }
  }
  lastBrokenCount = total;
}
```

> `readRegistry` is already imported/available in extension.ts (the provider uses it). Match the existing import. `getCacheDir`/`getBookmarksDataRoot`/`readBrokenAnchorsCache` come from core; confirm export names against `brokenAnchorsSync.ts`, which imports `getCacheDir`, `getBookmarksDataRoot`, and `brokenAnchorsCache`.

**Step 2: Recompute at the right moments**

Call `void recomputeBrokenCount().then(() => provider.refresh())`:
- once after activation's initial decoration pass;
- inside the repair queue's `refreshUI` (it already runs `provider.refresh()` — extend it):

```typescript
refreshUI: () => { void recomputeBrokenCount().then(() => provider.refresh()); debouncedCacheSync(); },
```

- and after a scan run completes (the ScanQueue's `onProgress` fires on finish; piggyback there or call it once after `await scanQueue.run(...)` in Task 11's command).

**Step 3: Pass `getActionRowState` to the provider**

Update the `new BookmarksProvider(...)` call to pass the new arg. Because the provider is constructed *before* `scanQueue`/`repairQueue` exist, pass a thunk that reads them lazily:

```typescript
const provider = new BookmarksProvider(
  paths, workspaceRoot, defaultIconPath, getUIState, isFileHidden, context, orderingService,
  () => ({
    scanRunning: scanQueueRef?.isRunning() ?? false,
    scanned: countValidatedAmong(currentBookmarkedFsPaths()),
    brokenCount: lastBrokenCount,
  }),
);
```

> Two wrinkles to resolve cleanly:
> 1. `scanQueue` is created later — use a `let scanQueueRef: ScanQueue | null = null;` declared before the provider, assigned when you build the queue in Task 11 (`scanQueueRef = scanQueue`). The thunk reads it lazily so order doesn't matter at call time.
> 2. `countValidatedAmong` needs the *current* set of bookmarked fsPaths, but that set is computed inside `getChildren`. Simplest: have the provider compute `scanned` itself. **Preferred refactor:** instead of passing `scanned` in, pass `getValidatedFiles: () => Set<string>` (i.e. expose the coverage set) OR move the `scanned = countValidatedAmong(bookmarkedFsPaths)` computation *inside* the provider using an injected `isFileValidated(fsPath)` predicate. Adjust Task 10 accordingly: inject `isFileValidated` + `scanRunning` + `brokenCount`, and let the provider count `scanned` against the `bookmarkedFsPaths` set it already builds. Use this version — it removes the awkward `currentBookmarkedFsPaths()` shim.

**Revised provider deps (apply to Task 10 + here):**

```typescript
// constructor param:
private readonly getActionRowState: () => { scanRunning: boolean; brokenCount: number },
private readonly isFileValidated: (fsPath: string) => boolean,
// in getChildren, compute scanned locally:
let scanned = 0;
for (const p of bookmarkedFsPaths) if (this.isFileValidated(p)) scanned++;
const st = this.getActionRowState();
const scan = scanRowDescriptor({ scanned, total: bookmarkedFsPaths.size, running: st.scanRunning });
// repair uses st.brokenCount as before
```

and the construction:

```typescript
const provider = new BookmarksProvider(
  paths, workspaceRoot, defaultIconPath, getUIState, isFileHidden, context, orderingService,
  () => ({ scanRunning: scanQueueRef?.isRunning() ?? false, brokenCount: lastBrokenCount }),
  (fsPath: string) => isFileValidated(fsPath),
);
```

(`isFileValidated` imported from `./scanCoverage`.)

**Step 4: Register the agent-repair commands**

Add to `context.subscriptions.push(...)`:

```typescript
import { registerAgentRepairCommands } from './commands/agent-repair-launch';
// ...
...registerAgentRepairCommands({ context, workspaceRoot, log }),
```

**Step 5: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS across the workspace.

**Step 6: Commit**

```bash
git add packages/extension/src/extension.ts packages/extension/src/treeProvider.ts
git commit -m "feat(view): feed scan/broken state into rows; register repair commands"
```

---

## Task 13: Build, package, and manual verification

Pure-helper behavior is covered by unit tests; the VS Code integration needs a real run. Use **@superpowers:verification-before-completion** — do not claim done until these pass and you've observed the behavior.

**Step 1: Full workspace gates**

Run:
```bash
pnpm typecheck
pnpm lint
pnpm test
```
Expected: all PASS. Paste the failing output verbatim if any fail; fix before continuing.

**Step 2: Package + install**

Run:
```bash
pnpm package:install   # build + vsce package + code --install-extension --force
```
Expected: a `.vsix` built to `dist/agentic-bookmarks.vsix` and installed. (Reload the VS Code window after install.)

**Step 3: Manual checklist** (in a workspace with bookmarks, including at least one deliberately-broken anchor — e.g. delete the anchored lines in a closed file)

- [ ] All Bookmarks view shows **Scan All** and **Repair All** rows directly below the filter row (and at the top when filtering is off).
- [ ] Scan All shows `X/Y scanned`; clicking it animates to `Scanning… n/Y`, then settles. No editor tabs open during scan.
- [ ] Files opened normally count toward `scanned` without a scan.
- [ ] With a broken anchor present, Repair All shows red `$(error)` + `n/Total broken`. With none, green `$(pass-filled)` + "no errors".
- [ ] During/after a scan that triggers auto-repair, the broken count doesn't flicker — it updates once after the repair queue settles.
- [ ] Repair All click, first time ever: shows the consent modal; on accept persists consent (second click skips it).
- [ ] Repair All with one connected agent (Claude): opens a terminal in the workspace root running `claude "Please use the agentic-bookmarks MCP to repair all broken bookmarks."`.
- [ ] Repair All with no agent connected: offers the connect quick pick → routes to `setupClaude/Codex/Cursor`.
- [ ] Repair All with 2+ agents and no default: prompts to choose, then remembers the choice (gear shows the `$(check)`).
- [ ] Gear on the Repair row opens the settings quick pick (change default / connect another).
- [ ] Cursor selected → "prompt copied to clipboard" toast instead of a terminal.

**Step 4: Commit any fixes from manual testing, then finalize**

```bash
git add -A
git commit -m "fix(scan-repair): address manual-testing findings"
```

Then use **@superpowers:finishing-a-development-branch** to decide merge/PR.

---

## Notes / deferred

- **Cursor launch** is clipboard-only until its headless story is tested (design out-of-scope).
- **Warnings** are not counted in Repair All (broken only); revisit if users want a combined indicator.
- **Multi-root**: broken count sums across folders; scan uses the primary `workspaceRoot` target collection (matches existing `scanAllFiles`). If multi-root scan coverage matters later, generalize `collectVisibleBookmarkedFiles` across folders.
- The stale root `tsconfig.json` `references` entry to `./packages/core` is pre-existing — ignore unless you're already editing tsconfigs.
```
