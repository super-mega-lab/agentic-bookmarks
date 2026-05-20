# Multi-root primary-folder rebind — known limitation

**Status:** Problem statement only (no solution yet)
**Date:** 2026-05-20
**Surfaced by:** SML-1394 (which intentionally does not fix this)

## The limitation

The extension's data layer (in the sibling `@agentic-bookmarks/core` repo) is
genuinely multi-root aware: each workspace folder has its own
`.bookmarks/local/bookmarks.registry.json`; the primary registry tracks the
multi-root set via `loadedWorkspaceFolders`
(`schema_v2.ts` `zWorkspaceRegistryV1`); and there are dispatch primitives like
`findWorkspaceForUri` (`paths.ts`) and `setLoadedWorkspaceFolders` /
`syncLoadedWorkspaceFoldersAcrossRegistries` for routing per workspace.

The **extension activation**, however, under-uses this. `activate()` captures a
single primary root once:

```ts
const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath; // extension.ts
```

That `workspaceRoot` is then closed over by every provider, watcher, command,
the repair queue, decorations, sticky handler, ordering service, and the MCP
registration. After SML-1394 this capture happens inside `activateForWorkspace()`
and still runs only once.

## What breaks

When the multi-root folder set changes *after* the scoped phase has run, the
captured `workspaceRoot` is never updated. Concretely:

- **Primary folder removed** (`workspaceFolders[0]` pulled out while other
  folders remain): all providers/watchers keep pointing at the removed folder's
  path until the user reloads the window.
- **Primary folder swapped / reordered** (a different folder becomes index 0):
  same staleness — the extension keeps operating against the old primary.
- **Drop to zero folders** (last folder closed): scoped state stays live, bound
  to a folder that no longer exists. SML-1394 explicitly does not tear this down.

Today (pre-SML-1394) a handful of listeners already react to
`onDidChangeWorkspaceFolders` (licensing detection, status bar text, the
`hasMultipleWorkspaces` context key, `syncLoadedWorkspaceFoldersAcrossRegistries`),
so the *data* registries stay roughly in sync — but the *VS Code-side wiring*
(providers, watchers, command closures) does not rebind. This is a pre-existing
bug, not a regression introduced by SML-1394.

## Possible directions (not chosen, for whoever picks this up)

1. **Track scoped disposables + teardown/re-run.** Collect every disposable
   created in `activateForWorkspace()` into a dedicated array (separate from
   `context.subscriptions`). On `workspaceFolders[0]` change or drop-to-zero,
   dispose them all and re-run the scoped phase against the new primary. Needs
   an audit of every long-lived object for a safe `dispose()` path
   (provider, filesGroups, settingsProvider, watchers, sticky, repairQueue,
   OrderingService, MCP registration, etc.).
2. **Stop capturing a single `workspaceRoot`.** Make consumers resolve the
   active root lazily (e.g. read `workspaceFolders[0]` on demand, or route per
   URI via `findWorkspaceForUri`). Larger refactor; arguably the "correct"
   end state but touches a lot of call sites.

Option 1 is the smaller, more contained step and aligns with the disposable-
tracking infrastructure that a teardown-on-close change would need anyway.

## Validation notes (whenever this is taken on)

Multi-root churn has many edge cases — add at index 0, remove index 0, reorder,
drop to zero then re-add. Each needs an Extension Development Host check, since
this path can't be exercised without a VS Code host.
