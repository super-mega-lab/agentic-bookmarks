// ABOUTME: Phased scan orchestrator — (1) validate every file from disk and write
// ABOUTME: an authoritative cache, (2) optionally finalize via auto-repair, (3) reconcile.
import type { ScanResultEntry } from './scanValidate';
import type { ScanPhase } from './views/action-rows';

/** One file the scan validates: its absolute path and workspace-relative target URI. */
export interface ScanTarget {
  fsPath: string;
  uri: string;
}

/** Result of validating a single file from disk. */
export interface ScanFileValidation {
  /** True when the target file does not exist on disk. */
  missing: boolean;
  /** Per-bookmark outcomes for this file. */
  entries: ScanResultEntry[];
}

export interface ScanQueueDeps {
  /** Read + resolve one file from disk (or detect that it's missing). */
  validateFile: (target: ScanTarget) => Promise<ScanFileValidation>;
  /** Write the authoritative cache for the given scanned URIs + their entries. */
  writeAuthoritativeCache: (scannedUris: Set<string>, entries: ScanResultEntry[]) => Promise<void>;
  /** Record a file as validated (Scan coverage). */
  markValidated: (fsPath: string) => void;
  /** Whether agenticBookmarks.autoRepair is enabled. */
  autoRepairEnabled: () => boolean;
  /** Open a file to trigger the existing auto-repair queue (broken subset only). */
  triggerRepair: (target: ScanTarget) => Promise<void>;
  /** Whether the auto-repair queue is idle (drained). */
  isRepairIdle: () => boolean;
  /** Notify of phase/progress changes (drives a tree refresh). */
  onPhaseChange: (phase: ScanPhase, scanned: number, total: number) => void;
  /** Sleep helper — injected so tests don't use real timers. */
  delay: (ms: number) => Promise<void>;
  log: (msg: string) => void;
  /** Files per batch before sleeping. Default 5. */
  batchSize?: number;
  /** Sleep between batches, ms. Default 200. */
  sleepMs?: number;
}

const MAX_IDLE_POLLS = 60; // ~9s at 150ms; bounds the post-repair idle wait.

export class ScanQueue {
  private currentPhase: ScanPhase = 'idle';
  private cancelled = false;
  private scanned = 0;
  private total = 0;

  constructor(private readonly deps: ScanQueueDeps) {}

  phase(): ScanPhase { return this.currentPhase; }
  isRunning(): boolean { return this.currentPhase !== 'idle'; }
  scannedThisRun(): number { return this.scanned; }
  totalThisRun(): number { return this.total; }

  cancel(): void { this.cancelled = true; }

  private setPhase(p: ScanPhase): void {
    this.currentPhase = p;
    this.deps.onPhaseChange(p, this.scanned, this.total);
  }

  /**
   * Full scan: classify every target from disk → write authoritative cache; then,
   * if auto-repair is enabled and real breakage exists, open the broken subset to
   * drive the repair queue, wait for it to drain, and reconcile from disk.
   */
  async run(targets: ScanTarget[]): Promise<void> {
    if (this.isRunning()) return;
    this.cancelled = false;
    this.scanned = 0;
    this.total = targets.length;
    const batchSize = this.deps.batchSize ?? 5;
    const sleepMs = this.deps.sleepMs ?? 200;
    this.setPhase('scanning');

    try {
      // --- Phase 1: classify from disk ---
      const allEntries: ScanResultEntry[] = [];
      const scannedUris = new Set<string>();
      const brokenTargets: ScanTarget[] = [];

      let inBatch = 0;
      for (const target of targets) {
        if (this.cancelled) break;
        let v: ScanFileValidation;
        try {
          v = await this.deps.validateFile(target);
        } catch (err) {
          this.deps.log(`[scan] validate failed for ${target.fsPath}: ${(err as Error)?.message ?? err}`);
          v = { missing: false, entries: [] };
        }
        this.deps.markValidated(target.fsPath);
        scannedUris.add(target.uri);
        allEntries.push(...v.entries);
        // Only non-missing files with real breakage are repair candidates.
        if (!v.missing && v.entries.some((e) => e.status === 'broken')) {
          brokenTargets.push(target);
        }
        this.scanned++;
        this.deps.onPhaseChange(this.currentPhase, this.scanned, this.total);
        if (++inBatch >= batchSize) { inBatch = 0; await this.deps.delay(sleepMs); }
      }

      await this.deps.writeAuthoritativeCache(scannedUris, allEntries);

      // --- Phase 2: finalize via auto-repair (gated) ---
      if (!this.cancelled && this.deps.autoRepairEnabled() && brokenTargets.length > 0) {
        this.setPhase('finalizing');

        inBatch = 0;
        for (const target of brokenTargets) {
          if (this.cancelled) break;
          try {
            await this.deps.triggerRepair(target);
          } catch (err) {
            this.deps.log(`[scan] triggerRepair failed for ${target.fsPath}: ${(err as Error)?.message ?? err}`);
          }
          if (++inBatch >= batchSize) { inBatch = 0; await this.deps.delay(sleepMs); }
        }

        // Wait (bounded) for the repair queue to drain.
        for (let i = 0; i < MAX_IDLE_POLLS && !this.deps.isRepairIdle() && !this.cancelled; i++) {
          await this.deps.delay(150);
        }

        // --- Phase 3: reconcile the broken subset from disk ---
        const reEntries: ScanResultEntry[] = [];
        const reUris = new Set<string>();
        for (const target of brokenTargets) {
          if (this.cancelled) break;
          try {
            const v = await this.deps.validateFile(target);
            reUris.add(target.uri);
            reEntries.push(...v.entries);
          } catch (err) {
            this.deps.log(`[scan] reconcile failed for ${target.fsPath}: ${(err as Error)?.message ?? err}`);
          }
        }
        if (reUris.size > 0) await this.deps.writeAuthoritativeCache(reUris, reEntries);
      }
    } finally {
      this.setPhase('idle');
    }
  }
}
