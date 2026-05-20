# Welcome-page ".gitignore" banner — retroactive plan

> **Status:** Shipped 2026-05-20. This is a paper trail written after the work; tested working in the Extension Development Host.

**Goal:** Add a dynamic helper to the welcome view that detects when machine-local
bookmark state isn't gitignored and offers a one-click fix. When `.bookmarks/local/`
exists on disk but `.gitignore` doesn't ignore it, show a banner near the top (after
the hero, before the Learn section) with an **"Add Agentic Bookmarks to .gitignore"**
button. Clicking it appends the canonical line and the banner clears.

**Scope discipline:** Reuse the existing gitignore tech rather than reinventing it.
The welcome view's no-folder state stays a strict no-op — all detection happens only
once a workspace folder is loaded, matching how the rest of the welcome content behaves.

**Relationship to the activation nudge (SML-1335):** This is a complementary surface,
not a replacement. The toast nudge (`gitignore-nudge.ts`) is once-per-workspace and
gated on files *tracked in git*. This banner is persistent and gated purely on
`.gitignore` content + the local dir existing. Both call the same idempotent append.

## What existed already

- `@agentic-bookmarks/core` (`gitignore-check.ts`): `BOOKMARKS_LOCAL_GITIGNORE_LINE`
  (`.bookmarks/local/`), idempotent `appendGitignoreLine(root, line)` →
  `created|appended|already-present`, and `listTrackedLocalFiles()`. The presence
  matcher (`containsEquivalentLine`) was private — no exported "is this line present?".
- Welcome view: `welcomeView.ts` (sync `render()`), `welcomeHtml.ts` (pure HTML),
  links via `command:` URIs (`enableCommandUris: true`).

## Implementation (test-driven, 3 units + thin wiring)

### Unit 1 — core presence check
- **Files:** core `src/gitignore-check.ts`, `src/index.ts` (+ `gitignore-check.test.ts`).
- Add and export `gitignoreContainsLine(workspaceRoot, line): Promise<boolean>`,
  reusing `containsEquivalentLine` (slash/anchor variants match; commented lines don't;
  missing file → `false`). 6 new tests.

### Unit 2 — banner rendering
- **Files:** `views/welcome/welcomeHtml.ts` (+ `welcomeView.test.ts`).
- Add optional `needsGitignore` to `WelcomeHtmlOptions`, honored **only when
  `hasFolder`**. Renders a `.banner` section before Learn with a button wired to
  `command:agenticBookmarks.addLocalToGitignore`. 4 new tests (shown / hidden /
  no-folder / ordering before Learn).

### Unit 3 — "should we show it?" helper
- **Files:** new `views/welcome/needsGitignore.ts` (+ `needsGitignore.test.ts`).
- `shouldOfferGitignoreLine(root, deps?) = localDirExists && !gitignoreContainsLine(...)`.
  Dependency-injected (like the nudge) for testability; never throws (errors → `false`);
  skips the `.gitignore` check when the local dir is absent. 5 new tests.

### Wiring (composes the tested pieces)
- `welcomeView.ts`: `render()` is now async — computes `needsGitignore` only when a
  folder is loaded; added public `refresh()` and a post-await disposal re-check.
- `extension.ts`: register `agenticBookmarks.addLocalToGitignore` (agnostic phase) —
  appends via core, shows a confirmation only when it actually wrote, logs, then
  `welcomeProvider.refresh()` in `finally`.
- `package.json`: declare the command (palette title "Add .bookmarks/local/ to .gitignore").

## Cross-repo gotcha

Core change requires a rebuild **and** `pnpm install` at the extension repo root — the
`file:` dep is copied into the pnpm store, not live-symlinked, so a new export isn't
visible to the extension's typecheck until reinstall.

## Verification

- Core suite: 811 passed. Extension/server/licensing: 545 passed.
- `pnpm typecheck` clean · `pnpm lint` 0 errors · `pnpm build` clean bundle.
- Manually confirmed working in the editor.
