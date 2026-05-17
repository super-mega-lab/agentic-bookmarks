export const RANK_STEP = 100;
const MIN_GAP = 2;

/**
 * Return a new rank that sorts between `prev` and `next`. Either may be null
 * (append/prepend/empty). Caller is responsible for ensuring there is room —
 * if the caller routes through `ensureRanksAround` first, gap-collapse will
 * have been rebalanced before this is called.
 */
export function assignRankBetween(prev: number | null, next: number | null): number {
  if (prev == null && next == null) return RANK_STEP;
  if (next == null) return prev! + RANK_STEP;
  if (prev == null) return next - RANK_STEP;
  return Math.floor((prev + next) / 2);
}

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
  let leftIdx = Math.max(-1, insertIdx - 1);
  while (leftIdx >= 0 && getRank(siblings[leftIdx]) == null) leftIdx--;
  // Walk right from insertIdx to find right anchor.
  let rightIdx = insertIdx;
  while (rightIdx < siblings.length && getRank(siblings[rightIdx]) == null) rightIdx++;

  const leftRank  = leftIdx  >= 0              ? getRank(siblings[leftIdx])  : null;
  const rightRank = rightIdx < siblings.length ? getRank(siblings[rightIdx]) : null;

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
