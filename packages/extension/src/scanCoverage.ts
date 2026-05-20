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
