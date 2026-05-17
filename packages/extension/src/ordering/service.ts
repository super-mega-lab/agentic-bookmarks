import { loadOrderingCache, saveOrderingCache } from './store';
import { type ContextKey, type EntityKind, type OrderingCache } from './types';

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
  /** Chain of in-flight writes — serialized so we don't race fs.writeFile calls. */
  private inflight: Promise<void> = Promise.resolve();

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
    this.timer = setTimeout(() => {
      this.timer = null;
      this.inflight = this.inflight.then(() => this.writeOnce());
    }, DEBOUNCE_MS);
  }

  private async writeOnce(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    await saveOrderingCache(this.cacheDir, this.cache);
  }

  /** Flush any pending or in-flight write. Safe to call any time. */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    // Tack a final writeOnce onto the chain — runs after any in-flight write.
    this.inflight = this.inflight.then(() => this.writeOnce());
    await this.inflight;
  }

  async dispose(): Promise<void> {
    await this.flush();
  }
}

function pruneUnknown(cache: OrderingCache, known: KnownIds): OrderingCache {
  const pruneMap = (m: Record<string, unknown>, keep: Set<string>) => {
    for (const id of Object.keys(m)) if (!keep.has(id)) delete m[id];
  };
  pruneMap(cache.bookmarks,     known.bookmarks);
  pruneMap(cache.files,         known.files);
  pruneMap(cache.groups,        known.groups);
  pruneMap(cache.bookmarkFiles, known.bookmarkFiles);
  return cache;
}
