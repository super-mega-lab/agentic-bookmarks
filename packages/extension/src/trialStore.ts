import type { TrialRecord } from '@agentic-bookmarks/licensing';

// Legacy globalState key retained for compatibility — renaming this would
// orphan any active trial records in users' VS Code global storage.
const KEY = 'bookmarks.licensing.trial';

export interface GlobalStateLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

export interface MirrorIO {
  read(): Promise<TrialRecord | undefined>;
  write(record: TrialRecord): Promise<void>;
  clear(): Promise<void>;
}

export class TrialStore {
  constructor(
    private readonly globalState: GlobalStateLike,
    private readonly mirror: MirrorIO,
  ) {}

  async read(): Promise<TrialRecord | undefined> {
    const fromState = this.globalState.get<TrialRecord>(KEY);
    if (fromState) return fromState;
    const fromMirror = await this.mirror.read();
    if (fromMirror) {
      await this.globalState.update(KEY, fromMirror);
      return fromMirror;
    }
    return undefined;
  }

  async write(record: TrialRecord): Promise<void> {
    await this.globalState.update(KEY, record);
    try {
      await this.mirror.write(record);
    } catch {
      // Mirror is best-effort. globalState is authoritative.
    }
  }

  async clear(): Promise<void> {
    await this.globalState.update(KEY, undefined);
    try {
      await this.mirror.clear();
    } catch {
      // Best-effort.
    }
  }
}
