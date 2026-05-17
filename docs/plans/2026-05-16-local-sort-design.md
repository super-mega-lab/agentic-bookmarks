# Local sorting for All Bookmarks and Files & Groups

Date: 2026-05-16
Branch: `user-sorting`

## Goal

Let users reorder elements in the two trees (`All Bookmarks`, `Files & Groups`) by drag-and-drop, with a per-view sort mode setting (`default` / `user` / `recent`). Persist user-assigned ranks to a per-workspace cache file that is *not* checked in.

## Design principles

- **Index scheme is swappable.** Sparse integers today, but every rank read/write goes through `ordering/rank.ts` so we can pivot to fractional indexing or string keys without touching providers or drop handlers.
- **Promote on touch, locally.** A drop only assigns ranks to the dropped item and any unranked neighbors immediately adjacent to the insert point — never the entire sibling list. This gives the user "what I see is what stays put" without rewriting hundreds of entries per drag.
- **Validation is a pure table.** All invalid drag/drop combinations live in one place (`dnd-validation.ts`) and silently no-op. Future move-to-group / move-to-file / move-across-workspace commands have `// TODO` markers at the exact ignore site.
- **Cache is rebuildable.** Ordering data lives under `getCacheDir(workspaceRoot, dataRoot)`. Corruption or loss degrades to "items revert to default sort" — nothing user-authored is lost.

## Module layout

```
packages/extension/src/ordering/
  types.ts            ContextKey, EntityKind, RankRecord, OrderingCache
  rank.ts             assignRankBetween, ensureRanksAround, rebalance — the swap point
  store.ts            load/save ordering.json with .bak recovery
  service.ts          OrderingService: in-memory state + debounced writes
  applySort.ts        pure: (items, mode, ctx, service) → items
  dnd-validation.ts   pure: canReorder({src, tgt, view, toggles}) → boolean
  dnd-controller.ts   shared TreeDragAndDropController helpers
  *.test.ts           vitest, one per module
```

## Data model

Four maps, three context keys:

```ts
type ContextKey = 'a' | 'f' | 'g';   // all | within-file | within-group
type EntityKind = 'bookmark' | 'file' | 'group' | 'bookmarkFile';
type RankRecord = Partial<Record<ContextKey, number>>;

interface OrderingCache {
  bookmarks:     Record<string, RankRecord>;  // 'a' | 'f' | 'g'
  files:         Record<string, RankRecord>;  // 'a' only
  groups:        Record<string, RankRecord>;  // 'f' only
  bookmarkFiles: Record<string, RankRecord>;  // 'f' only (per-workspace)
}
```

**Why four maps, not three.** "Files" in All Bookmarks (user code files) and "bookmark-files" in Files & Groups (the metadata files that *contain* bookmarks) are conceptually distinct even though IDs may overlap — they live in different views with different semantics. Keeping them separate prevents accidental cross-contamination.

### On-disk format

`<getCacheDir(workspaceRoot, dataRoot)>/ordering.json`:

```jsonc
{
  "v": 1,
  "bookmarks":     [{ "id": "B7x2", "ranks": { "f": 200, "a": 100 } }, ...],
  "files":         [{ "id": "fAbC", "ranks": { "a": 300 } }, ...],
  "groups":        [{ "id": "gDef", "ranks": { "f": 100 } }, ...],
  "bookmarkFiles": [{ "id": "fGhI", "ranks": { "f": 200 } }, ...]
}
```

Stored as arrays (sorted by id for stable diffs) and rehydrated into `Record` maps in memory. Not checked into git — the file lives under `.bookmarks/local/.cache/` which is already gitignored.

### Backup (`.bak`)

`store.ts` mirrors core's `store_v2.ts` recipe inline (no shared helper — overkill for a single-process cache):

- Before write: if `ordering.json` exists, `copyFile` it to `ordering.json.bak`.
- On read: if main file is missing → empty cache. If main file fails to parse → try `.bak`; if that parses, restore main from bak and log a warning. If both fail → empty cache, log loudly.

Future extraction: if a second caller wants the same pattern, lift `withBackup(path, writer)` into `core/utils/`.

## Index scheme: sparse integers

`rank.ts` is the only file that knows numbers vs. strings vs. floats. Public API:

```ts
assignRankBetween(prev: number | null, next: number | null): number
ensureRanksAround(siblings, insertIdx, ctx, service): void   // promotes unranked locals
rebalance(siblings, ctx, service): void                      // re-spaces a parent's siblings
```

**Spacing.** New items use multiples of 100 (`100, 200, 300, ...`). `assignRankBetween(a, b)` returns the midpoint. When the gap collapses (`b - a < 2`), `assignRankBetween` calls `rebalance` on the parent's siblings first, then returns the midpoint of the freshly-spaced neighbors. Both code paths route through the same gap check.

**Promote-on-touch.** `ensureRanksAround(siblings, insertIdx, ctx)`:
1. Walk left from `insertIdx` until you hit a ranked sibling (or the start).
2. Walk right from `insertIdx` until you hit a ranked sibling (or the end).
3. Distribute evenly-spaced sparse integers across the unranked stretch between (and including) the boundary items, anchored to existing ranks if present, falling back to fresh `100, 200, ...` if both boundaries are null.

This bounds writes to "the local neighborhood" — a drop near the top doesn't promote the bottom 500 bookmarks.

## Sort application

Both providers call `applySort(items, mode, ctx, service)` from their `getChildren`:

```ts
switch (mode) {
  case 'default': return defaultSort(items);              // existing behavior
  case 'recent':  return recentSort(items);               // by updatedAt desc
  case 'user': {
    const ranked   = items.filter(i => service.has(i.kind, i.id, ctx));
    const unranked = items.filter(i => !service.has(i.kind, i.id, ctx));
    ranked.sort((a, b) => service.get(a.kind, a.id, ctx)! - service.get(b.kind, b.id, ctx)!);
    return [...ranked, ...defaultSort(unranked)];
  }
}
```

Unranked items always sort to the tail in deterministic order, so toggling view options (`showFilesInAllBookmarks`, `showBookmarksInFilesAndGroups`) is safe — newly-visible items just appear at the bottom, previously-ranked items keep their rank if visible.

**`recent` for files / groups.** Files and groups have no `updatedAt` field. Derive as `max(child.updatedAt)`. Add a one-line comment at the helper.

## Drag-and-drop flow

VS Code passes drag/drop via `TreeDragAndDropController`. Both providers register one through a shared helper in `dnd-controller.ts`.

**Per-drop:**

1. **Read sources** from the data transfer. Each carries `{kind, id, ctx, parentId}` where `parentId` scopes "siblings" (fileId for `f`, groupId for `g`, null for `a`).
2. **Validate** each (src, tgt) pair against the table below. Invalid drops are dropped silently — no error, no toast.
3. **Materialize sibling list** in current visual order via the same path `getChildren` uses.
4. **For each surviving source** (in original visual order):
   - `ensureRanksAround(siblings, insertIdx, ctx)` to promote local neighbors.
   - `newRank = assignRankBetween(rank(prev), rank(next))`.
   - `service.set(kind, id, ctx, newRank)`.
   - Advance `prev` to the just-placed item for the next iteration.
5. **Fire** `_onDidChangeTreeData()` on the affected provider.
6. **Persist** (debounced ~250ms via the service).

### Validation table

| Src kind          | Tgt kind          | View / toggle state                           | Result                                              |
| ----------------- | ----------------- | --------------------------------------------- | --------------------------------------------------- |
| bookmark→bookmark | same parent       | any                                           | OK; ctx = current view's ctx                        |
| bookmark→bookmark | different file    | All Bookmarks, `showFiles=true`               | **ignored** (cross-file)                            |
| bookmark→bookmark | different group   | Files & Groups, `showBookmarks=true`          | **ignored** (`// TODO: future move-to-group`)       |
| group→group       | same file         | Files & Groups                                | OK; ctx = `f`                                       |
| group→group       | different file    | Files & Groups                                | **ignored** (`// TODO: future move-group`)          |
| file→file         | —                 | All Bookmarks                                 | OK; ctx = `a`                                       |
| bookmarkFile→bookmarkFile | same workspace | Files & Groups                            | OK; ctx = `f`                                       |
| bookmarkFile→bookmarkFile | different workspace | Files & Groups                       | **ignored** (`// TODO: cross-workspace move`)       |
| any cross-tree    | —                 | —                                             | **ignored** (each tree uses its own mime type)      |

### Multi-select drag (dev setting)

`agenticBookmarks.dev.enableMultiSelectDrag` (boolean, default `false`, not shown in settings panel) gates `canSelectMany` on `createTreeView`. The drop flow handles N items natively: invalid sources are filtered, survivors are placed in original visual order, each `assignRankBetween` advances `prev` to the just-placed item. Mixed-kind selections (e.g. a group + a bookmark in F&G) are fine — the validator runs per pair, so some items reorder and others are silently dropped.

## Settings

Two new per-view settings in `package.json` contributions:

```jsonc
"agenticBookmarks.sortMode.allBookmarks":   {
  "type": "string", "enum": ["default", "user", "recent"], "default": "user"
},
"agenticBookmarks.sortMode.filesAndGroups": {
  "type": "string", "enum": ["default", "user", "recent"], "default": "user"
},
"agenticBookmarks.dev.enableMultiSelectDrag": {
  "type": "boolean", "default": false,
  "description": "Internal: enable multi-select drag in the bookmark trees."
}
```

Default of `"user"` is safe — it behaves identically to `"default"` when no ranks exist, and the first drag "just works" without a settings trip.

**Settings view rows** in `settingsProvider.ts`: two combo-style rows alongside the existing toggles. Clicking opens a `QuickPick` with the three modes. Two new commands back the QuickPick clicks and allow keybindings:

```
agenticBookmarks.setSortModeAllBookmarks       // arg: 'default' | 'user' | 'recent'
agenticBookmarks.setSortModeFilesAndGroups
```

Both providers listen to `onDidChangeConfiguration` and refire `_onDidChangeTreeData` when their mode changes.

## Activation wiring

```ts
const orderingService = await OrderingService.load(workspaceRoot, dataRoot, registry);
ctx.subscriptions.push(orderingService);   // flushes pending writes on dispose

const bookmarksProvider   = new BookmarksProvider(..., orderingService);
const filesGroupsProvider = new FilesGroupsProvider(..., orderingService);

const enableMulti = vscode.workspace.getConfiguration('agenticBookmarks')
                          .get('dev.enableMultiSelectDrag', false);

const bookmarksTree = vscode.window.createTreeView('agenticBookmarks.all', {
  treeDataProvider: bookmarksProvider,
  dragAndDropController: bookmarksProvider.dnd,
  canSelectMany: enableMulti,
});
const filesGroupsTree = vscode.window.createTreeView('agenticBookmarks.filesGroups', {
  treeDataProvider: filesGroupsProvider,
  dragAndDropController: filesGroupsProvider.dnd,
  canSelectMany: enableMulti,
});
```

`OrderingService.load` takes the registry so it can prune unknown IDs at load time — keeps the cache from growing indefinitely as bookmarks are deleted.

`dispose()` flushes any pending debounced write synchronously.

## Tests (vitest, matching existing patterns)

- `rank.test.ts` — `assignRankBetween` midpoint, gap-collapse triggers rebalance; `ensureRanksAround` left/right walks, both-boundaries-null, fully-ranked stretch is a no-op.
- `applySort.test.ts` — `user` mode produces `[...ranked-by-rank, ...default(unranked)]`; `default` and `recent` unchanged for ranked-but-different-mode inputs.
- `dnd-validation.test.ts` — every row of the validation table.
- `store.test.ts` — round-trip load/save; missing file → empty cache; malformed main file → recovers from `.bak`; both corrupt → empty cache + warning; backup is written before each successful save.
- `ordering-service.test.ts` — `set`/`get`/`has`/`delete`; debounced persistence with fake timers; `dispose()` flushes; load-time prune drops unknown IDs.

UI / drag interactions are not unit-testable in this harness. Manual smoke after implementation:

1. Drag a bookmark within a file in All Bookmarks; reload; order persists.
2. Toggle `showFilesInAllBookmarks` off; the same bookmark falls to the unranked tail (since `a`-ctx is empty); on again, it returns to its `f`-ctx position.
3. Drag a bookmark across files in All Bookmarks (with files visible): silently ignored.
4. Drag a group within a file in F&G; persists. Drag a group across files: ignored.
5. Drag a bookmark-file within a workspace in F&G; persists. Across workspaces: ignored.
6. Flip sort mode to `recent`: ordering changes to updatedAt-desc; flip back to `user`: ranks restored.
7. With `dev.enableMultiSelectDrag=true`, multi-select two bookmarks in the same file and drag — both reorder, preserving their relative order at the target.

## Risks tracked

- **Stale IDs in cache.** Mitigated by load-time prune against the registry.
- **`updatedAt` derivation for files/groups.** Comment at the helper; `recent` semantics differ slightly between leaves and containers.
- **Gap collapse under heavy reordering.** `assignRankBetween` routes through `rebalance` via a shared gap check — single code path, hard to forget.
- **Debounced writes vs. shutdown.** `dispose()` flushes synchronously; covered by test.
- **No drag primer in this repo.** The referenced primer lives in `agentic-bookmarks-core`; re-read before implementation to catch any VS Code drag-API gotchas the design missed.

## Out of scope (deferred)

- Move-to-group, move-to-file, move-across-workspace commands (have `// TODO` markers at the exact ignore sites).
- Cross-tree drag.
- Shared `withBackup(path, writer)` helper in core (extract if a second caller appears).
- Surfacing `dev.enableMultiSelectDrag` in the settings panel.
- Audit and update right-click / context menu commands to handle multi-select selections (e.g. delete, jump, edit-label). Required follow-up before shipping `dev.enableMultiSelectDrag` to users, but separable from the sort feature itself — drag/drop works correctly with multi-select regardless of menu state.
