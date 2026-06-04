import { describe, it, expect } from 'vitest';
import { assignRankBetween, ensureRanksAround, rankForInsert, rebalance, RANK_STEP } from './rank';

// Minimal "sibling" shape — id + getRank/setRank callbacks let us test rank.ts
// without instantiating OrderingService.
type Sib = { id: string; rank: number | null };

function siblings(...ids: Array<[string, number | null]>): Sib[] {
  return ids.map(([id, rank]) => ({ id, rank }));
}

const getRank = (s: Sib) => s.rank;
const setRank = (s: Sib, r: number) => { s.rank = r; };

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

describe('rankForInsert', () => {
  it('returns a rank strictly between two ranked neighbors when room exists', () => {
    const sibs = siblings(['a', 100], ['b', 300]);
    const rank = rankForInsert(sibs, 1, getRank, setRank);
    expect(rank).toBeGreaterThan(100);
    expect(rank).toBeLessThan(300);
  });

  it('rebalances and recomputes when the midpoint is exhausted', () => {
    // prev=100, next=101: floor((100+101)/2)=100 would collide with prev.
    const sibs = siblings(['a', 100], ['b', 101]);
    const rank = rankForInsert(sibs, 1, getRank, setRank);
    // Neighbors are re-spaced and the new rank lands strictly between them,
    // so the dropped item keeps its intended position instead of colliding.
    expect(sibs[0].rank).not.toBe(sibs[1].rank);
    expect(rank).toBeGreaterThan(sibs[0].rank!);
    expect(rank).toBeLessThan(sibs[1].rank!);
  });

  it('appends past the last sibling without colliding', () => {
    const sibs = siblings(['a', 100]);
    const rank = rankForInsert(sibs, 1, getRank, setRank);
    expect(rank).toBeGreaterThan(100);
  });

  it('prepends before the first sibling without colliding', () => {
    const sibs = siblings(['a', 100]);
    const rank = rankForInsert(sibs, 0, getRank, setRank);
    expect(rank).toBeLessThan(100);
  });

  it('never collides under repeated reorders into the same gap (exhaustion stress) (SML-1542)', () => {
    const sibs = siblings(['a', 100], ['b', 200]);
    // Repeatedly drop a fresh item into the slot just after 'a'. Each drop narrows the
    // gap until the midpoint is exhausted and a rebalance must fire — without the
    // rebalance guard the ~7th drop returns 100, colliding with 'a'.
    for (let i = 0; i < 12; i++) {
      const rank = rankForInsert(sibs, 1, getRank, setRank);
      const prev = sibs[0].rank!;
      const next = sibs[1].rank!;
      expect(rank).toBeGreaterThan(prev);
      expect(rank).toBeLessThan(next);
      sibs.splice(1, 0, { id: `n${i}`, rank });
    }
    // The whole list is strictly ordered with no duplicate ranks.
    const ranks = sibs.map(s => s.rank!);
    const sorted = [...ranks].sort((x, y) => x - y);
    expect(ranks).toEqual(sorted);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('restores RANK_STEP-spaced neighbors after a midpoint-exhaustion rebalance (SML-1542)', () => {
    // a=100, b=101: no integer strictly between, so assignRankBetween floors to 100 and
    // collides with prev, forcing a full rebalance of the sibling list.
    const sibs = siblings(['a', 100], ['b', 101]);
    const rank = rankForInsert(sibs, 1, getRank, setRank);
    // Rebalance restored a clean RANK_STEP gap between the bounding siblings...
    expect(sibs[1].rank! - sibs[0].rank!).toBe(RANK_STEP);
    // ...and the inserted rank is the midpoint of that restored gap.
    expect(rank).toBe(sibs[0].rank! + Math.floor(RANK_STEP / 2));
    expect(rank).toBeGreaterThan(sibs[0].rank!);
    expect(rank).toBeLessThan(sibs[1].rank!);
  });
});
