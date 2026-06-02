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
      // Secondary tiebreaker keeps ordering deterministic if two ranks are
      // equal (e.g. duplicate ranks already persisted in ordering.json).
      ranked.sort((a, b) =>
        (service.get(a.kind, a.id, ctx)! - service.get(b.kind, b.id, ctx)!) || defaultCmp(a, b));
      unranked.sort(defaultCmp);
      return [...ranked, ...unranked];
    }
  }
}
