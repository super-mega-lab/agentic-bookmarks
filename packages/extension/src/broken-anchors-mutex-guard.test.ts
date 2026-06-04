// ABOUTME: Guard for the broken-anchors.json cross-process lost-update fence (SML-1534/SML-1569) —
// ABOUTME: a source-scan tripwire pinning both writers (debouncedCacheSync + writeAuthoritativeScanCache)
// ABOUTME: to the one shared brokenAnchorsCacheMutex. The mutex's serialization itself is covered by
// ABOUTME: asyncMutex.test.ts (incl. the broken-anchors lost-update regression), so it isn't re-tested here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const extensionSrc = readFileSync(join(__dirname, 'extension.ts'), 'utf8');

// Brace-match a function body starting at its declaration so we can assert about
// that specific writer (the bodies are large and the precedent guard test —
// revalidate-invariant-guard.test.ts — scans source the same pragmatic way).
function bodyOf(src: string, declRegex: RegExp): string | null {
  const m = declRegex.exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index);
  if (open < 0) return null;
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, j + 1);
    }
  }
  return null;
}

describe('broken-anchors shared-mutex guard (SML-1534/SML-1569)', () => {
  it('both writers route their read-merge-write through the one shared brokenAnchorsCacheMutex', () => {
    // The lost-update window (read → await → write interleaving) is fenced only if
    // BOTH writers serialize on the SAME mutex instance. If a future edit drops the
    // mutex from either writer, or introduces a second mutex, this fails — move the
    // site back onto the shared brokenAnchorsCacheMutex.
    const debouncedBody = bodyOf(extensionSrc, /function debouncedCacheSync\s*\(/);
    const writeBody = bodyOf(extensionSrc, /function writeAuthoritativeScanCache\s*\(/);

    expect(debouncedBody).toBeTruthy();
    expect(writeBody).toBeTruthy();
    expect(debouncedBody).toContain('brokenAnchorsCacheMutex.runExclusive');
    expect(writeBody).toContain('brokenAnchorsCacheMutex.runExclusive');

    // Exactly one shared instance backs both writers.
    const decls = extensionSrc.match(/brokenAnchorsCacheMutex\s*=\s*new AsyncMutex\(\)/g) ?? [];
    expect(decls).toHaveLength(1);
  });
});
