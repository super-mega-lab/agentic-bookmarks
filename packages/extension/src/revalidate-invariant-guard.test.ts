// ABOUTME: Source-scan tripwire (SML-1499) — fails if extension.ts hand-rolls a
// ABOUTME: re-resolve (onFileOpened/revalidateOpenDocuments) paired with a bare
// ABOUTME: updateDecorations() outside the createRevalidateAndRepaint helper.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const extensionSrc = readFileSync(join(__dirname, 'extension.ts'), 'utf8');

// The one legitimate place the resolve fns and updateDecorations co-occur is the
// helper construction, where they are passed in as deps. Strip it before scanning
// so it does not count as a hand-rolled pairing.
const withoutHelperConstruction = extensionSrc.replace(
  /createRevalidateAndRepaint\(\{[\s\S]*?\}\);/,
  '/* createRevalidateAndRepaint(...) */',
);

describe('revalidate→decorate invariant guard (SML-1499)', () => {
  it('extension.ts never pairs a re-resolve with a bare updateDecorations() outside the helper', () => {
    // The anti-pattern this ticket exists to prevent: a resolve call
    // (onFileOpened / revalidateOpenDocuments) followed shortly by a standalone
    // updateDecorations() call — the hand-rolled sequence whose wrong order
    // reintroduces the SML-1491 stale-"!" bug. Such sites must instead route
    // through repaintAfter / openAndRepaint / revalidateAndRepaint, which own
    // the order and the guards. If this fails, move the new site onto the helper.
    const antiPattern =
      /\b(?:onFileOpened|revalidateOpenDocuments)\([^)]*\)[\s\S]{0,200}?\bupdateDecorations\(\)/;
    expect(antiPattern.test(withoutHelperConstruction)).toBe(false);
  });

  it('the migrated sites route through the invariant helper', () => {
    // Sanity tripwire that the SML-1499 migration is actually in place.
    expect(extensionSrc).toMatch(/\brepaintAfter\(/); // init-loop + active-editor
    expect(extensionSrc).toMatch(/\bopenAndRepaint\(/); // save site
  });
});
