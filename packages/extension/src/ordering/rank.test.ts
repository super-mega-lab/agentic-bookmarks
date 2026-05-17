import { describe, it, expect } from 'vitest';
import { assignRankBetween, ensureRanksAround, rebalance, RANK_STEP } from './rank';

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
