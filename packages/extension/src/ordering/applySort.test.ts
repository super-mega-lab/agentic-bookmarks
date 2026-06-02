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
    has: (_k: string, id: string, _c: string) => ranks.has(id),
    get: (_k: string, id: string, _c: string) => ranks.get(id),
  } as const;

  it('default mode delegates to defaultCmp', () => {
    const out = applySort(items, 'default', 'a', svc as never, defaultCmp);
    expect(out.map(i => i.id)).toEqual(['B', 'C', 'A']);
  });

  it('recent mode sorts by updatedAt descending', () => {
    const out = applySort(items, 'recent', 'a', svc as never, defaultCmp);
    expect(out.map(i => i.id)).toEqual(['A', 'C', 'B']);
  });

  it('user mode puts ranked items first (by rank asc), then unranked via defaultCmp', () => {
    const out = applySort(items, 'user', 'a', svc as never, defaultCmp);
    // ranked: C(100), A(200). unranked: B → default
    expect(out.map(i => i.id)).toEqual(['C', 'A', 'B']);
  });

  it('user mode breaks rank ties with defaultCmp (deterministic, not input order)', () => {
    // A and C share rank 100; the tie must resolve via defaultCmp
    // (defaultKey: C='02' before A='03'), not by their order in `items`.
    const tied = new Map<string, number>([['A', 100], ['C', 100]]);
    const tieSvc = {
      has: (_k: string, id: string, _c: string) => tied.has(id),
      get: (_k: string, id: string, _c: string) => tied.get(id),
    } as const;
    const out = applySort(items, 'user', 'a', tieSvc as never, defaultCmp);
    // ranked A,C (both 100) → defaultCmp orders C before A; unranked B last.
    expect(out.map(i => i.id)).toEqual(['C', 'A', 'B']);
  });

  it('user mode falls back to defaultCmp when nothing is ranked', () => {
    // Switch to a ctx where no ranks exist by faking a no-op service.
    const empty = { has: () => false, get: () => undefined } as const;
    const out = applySort(items, 'user', 'g', empty as never, defaultCmp);
    expect(out.map(i => i.id)).toEqual(['B', 'C', 'A']);
  });
});
