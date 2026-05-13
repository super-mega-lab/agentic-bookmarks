import {
  checkFeature as checkFeatureCore,
  createLicenseChecker,
  effectiveVisibility,
  startTrial as mintTrial,
  systemClock,
  type Clock,
  type FeatureAccess,
  type FeatureName,
  type LicenseStatus,
  type RepoVisibility,
  type Tier,
  type TrialRecord,
} from '@agentic-bookmarks/licensing';
import { openSourceDetection } from '@agentic-bookmarks/core';

type DetectFn = typeof openSourceDetection.detectWorkspaceVisibility;
type WorkspaceVisibilityResult = Awaited<ReturnType<DetectFn>>;

export interface LicensingServiceDeps {
  /** Reads the bookmarks.licensing.testTier setting. */
  getTierSetting: () => string | undefined;
  /** Reads the bookmarks.licensing.testVisibility setting. */
  getVisibilitySetting: () => string | undefined;
  /** Calls VS Code's setContext command for a given key. Used by pushContext(). */
  setContextKey: (key: string, value: unknown) => void;
  /** Snapshot of current workspace folder paths. */
  getWorkspaceFolders: () => readonly string[];
  /** Detector function — defaults to openSourceDetection.detectWorkspaceVisibility. */
  detectWorkspaceVisibility?: DetectFn;
  /** Read the persisted trial record (globalState + JSON mirror). Optional in tests. */
  readTrialRecord?: () => Promise<TrialRecord | undefined>;
  /** Persist a trial record. Optional in tests. */
  writeTrialRecord?: (record: TrialRecord) => Promise<void>;
  /** Clear the persisted trial record. Optional in tests. */
  clearTrialRecord?: () => Promise<void>;
  /** Stable per-machine identifier — vscode.env.machineId in production. */
  machineId?: string;
  /** Injected clock for deterministic time. Defaults to systemClock. */
  clock?: Clock;
}

type Listener = () => void;

class TinyEmitter {
  private readonly listeners = new Set<Listener>();
  readonly event = (listener: Listener): { dispose: () => void } => {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  };
  fire(): void {
    for (const l of this.listeners) l();
  }
}

const VALID_VISIBILITY = new Set<RepoVisibility>(['public', 'private', 'local']);
const VALID_TIER = new Set<Tier>(['free', 'pro', 'trial']);

export class LicensingService {
  private readonly getLicenseStatus: () => LicenseStatus;
  private readonly getTierSetting: () => string | undefined;
  private readonly getVisibilitySetting: () => string | undefined;
  private readonly setContextKey: (key: string, value: unknown) => void;
  private readonly getWorkspaceFolders: () => readonly string[];
  private readonly detectFn: DetectFn;
  private readonly visibilityCache = new openSourceDetection.VisibilityCache();
  private readonly _onDidChange = new TinyEmitter();
  readonly onDidChange = this._onDidChange.event;

  private readonly readTrial: () => Promise<TrialRecord | undefined>;
  private readonly writeTrial: (r: TrialRecord) => Promise<void>;
  private readonly clearTrial: () => Promise<void>;
  private readonly machineId: string;
  private readonly clock: Clock;
  private cachedTrialRecord: TrialRecord | undefined;

  /**
   * Cached repo visibility from the most recent detection. Defaults to 'private'
   * before first detection completes — safe gating choice (pro features stay
   * gated until proven open). Updated by detect().
   */
  private cachedVisibility: RepoVisibility = 'private';

  /**
   * Tracks an in-flight detection so concurrent calls coalesce into one run.
   */
  private detectInFlight: Promise<WorkspaceVisibilityResult | null> | null = null;

  /**
   * The most recent raw detector output, kept for diagnostics. `null` until the
   * first non-overridden detect() completes (or stays null as long as the test
   * override is active, since detect() short-circuits in that case).
   */
  private lastDetection: WorkspaceVisibilityResult | null = null;

  constructor(deps: LicensingServiceDeps) {
    this.getTierSetting = deps.getTierSetting;
    this.getVisibilitySetting = deps.getVisibilitySetting;
    this.setContextKey = deps.setContextKey;
    this.getWorkspaceFolders = deps.getWorkspaceFolders;
    this.detectFn = deps.detectWorkspaceVisibility ?? openSourceDetection.detectWorkspaceVisibility;

    this.readTrial = deps.readTrialRecord ?? (async () => undefined);
    this.writeTrial = deps.writeTrialRecord ?? (async () => {});
    this.clearTrial = deps.clearTrialRecord ?? (async () => {});
    this.machineId = deps.machineId ?? 'unknown-machine';
    this.clock = deps.clock ?? systemClock;

    const checker = createLicenseChecker({
      getProLicense: () => undefined,
      getTrialRecord: () => this.cachedTrialRecord,
      clock: this.clock,
    });
    this.getLicenseStatus = () => {
      const override = this.readTierOverride();
      if (override) return { tier: override, valid: true };
      return checker();
    };
  }

  private readTierOverride(): Tier | null {
    const t = this.getTierSetting();
    return t && VALID_TIER.has(t as Tier) ? (t as Tier) : null;
  }

  status(): LicenseStatus { return this.getLicenseStatus(); }

  visibility(): RepoVisibility {
    const override = this.readVisibilityOverride();
    if (override) return override;
    return effectiveVisibility(this.cachedVisibility, this.clock);
  }

  check(name: FeatureName): FeatureAccess {
    return checkFeatureCore(name, {
      getLicenseStatus: this.getLicenseStatus,
      getRepoVisibility: () => this.visibility(),
    });
  }

  /**
   * Run repo-visibility detection against the current workspace folders.
   * Updates the cached value and fires onDidChange. Coalesces concurrent calls.
   *
   * No-ops when bookmarks.licensing.testVisibility is set to a valid value —
   * the override fully short-circuits detection. Pre-launch we will likely
   * remove this dev override.
   *
   * @param force when true, bypasses in-flight coalescing and the detector's
   *   internal TTL cache (forceRefresh).
   * @returns the raw detector result, or null when the override is active.
   */
  async detect(force = false): Promise<WorkspaceVisibilityResult | null> {
    if (this.readVisibilityOverride()) return null;
    if (this.detectInFlight && !force) return this.detectInFlight;

    const roots = [...this.getWorkspaceFolders()];
    let run!: Promise<WorkspaceVisibilityResult>;
    run = (async () => {
      try {
        const result = await this.detectFn(roots, {
          cache: this.visibilityCache,
          forceRefresh: force,
        });
        // Map workspace 'mixed' → 'private' for the licensing model.
        // The detector already maps {public, local} → 'public' (public wins),
        // so 'mixed' only occurs with {private, local} combos where conservative
        // gating is correct. Per-folder gating is a future refinement.
        const mapped: RepoVisibility =
          result.visibility === 'mixed' ? 'private' : result.visibility;
        this.cachedVisibility = mapped;
        this.lastDetection = result;
        this._onDidChange.fire();
        return result;
      } finally {
        if (this.detectInFlight === run) this.detectInFlight = null;
      }
    })();
    this.detectInFlight = run;
    return run;
  }

  /** Most recent raw detector result, or null if no detection has run (or override is active). */
  getLastDetection(): WorkspaceVisibilityResult | null {
    return this.lastDetection;
  }

  /** Current workspace folder paths as the service sees them. Useful for diagnostics. */
  getWorkspaceFolderPaths(): readonly string[] {
    return this.getWorkspaceFolders();
  }

  /** Returns the override value if set to a valid visibility, otherwise null. */
  getOverride(): RepoVisibility | null {
    return this.readVisibilityOverride();
  }

  /**
   * Load the persisted trial record into the in-memory cache. Call once during
   * activation, before pushContext(). Subsequent calls re-read.
   */
  async hydrate(): Promise<void> {
    this.cachedTrialRecord = await this.readTrial();
  }

  /**
   * Idempotent — if a trial is already recorded (active or expired), the
   * existing record is returned unchanged. Otherwise a new record is minted
   * at the current clock time, persisted, and onDidChange fires.
   */
  async startTrial(): Promise<TrialRecord> {
    if (this.cachedTrialRecord) return this.cachedTrialRecord;
    const record = mintTrial({
      existing: undefined,
      clock: this.clock,
      machineId: this.machineId,
    });
    await this.writeTrial(record);
    this.cachedTrialRecord = record;
    this._onDidChange.fire();
    return record;
  }

  /** Dev-only. Clears the persisted and cached trial record. */
  async resetTrial(): Promise<void> {
    await this.clearTrial();
    this.cachedTrialRecord = undefined;
    this._onDidChange.fire();
  }

  /** Dev-only. Replaces the trial record (for simulate* commands). */
  async setTrialRecordForTesting(record: TrialRecord | undefined): Promise<void> {
    if (record) await this.writeTrial(record);
    else await this.clearTrial();
    this.cachedTrialRecord = record;
    this._onDidChange.fire();
  }

  /** Current cached trial record. Useful for diagnostics. */
  getTrialRecord(): TrialRecord | undefined {
    return this.cachedTrialRecord;
  }

  /** Push the current state into VS Code context keys. Idempotent. */
  pushContext(): void {
    const s = this.status();
    const v = this.visibility();
    this.setContextKey('agenticBookmarks.tier', s.tier);
    this.setContextKey('agenticBookmarks.repoVisibility', v);
  }

  /** Call from a config-change listener. Re-pushes context and notifies UI. */
  notifyChanged(): void {
    this.pushContext();
    this._onDidChange.fire();
  }

  private readVisibilityOverride(): RepoVisibility | null {
    const v = this.getVisibilitySetting();
    return v && VALID_VISIBILITY.has(v as RepoVisibility) ? (v as RepoVisibility) : null;
  }
}
