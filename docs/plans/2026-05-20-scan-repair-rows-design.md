# Scan All & Repair All rows — design

**Status:** Design (approved for implementation)
**Date:** 2026-05-20
**Scope:** `packages/extension` (tree view, a new throttled scan queue, an agent-repair
launch flow). Touches `packages/extension/package.json` contributions and existing
state/install helpers. No core (`agentic-bookmarks-core`) changes anticipated.

---

## Summary

Add two independent action rows to the top of the **All Bookmarks** tree view, rendered
directly below the existing `filterInfo` row:

- **Scan All** — validates every bookmarked file (without opening tabs) so the extension's
  knowledge of broken anchors is complete, and shows coverage as `scanned / total`.
- **Repair All** — reflects the current set of known-broken anchors, and on click launches
  an **agent-driven** repair session (these are the anchors auto-repair could not fix, so
  they need an LLM agent).

The two rows work independently. Scan is about *discovering* problems (and letting cheap
local auto-repair fix what it can); Repair All is about *escalating* the residue to an agent.

---

## Background / why this fits the existing code

- **Non-disruptive scanning already exists.** `agenticBookmarks.scanAllFiles`
  (`packages/extension/src/commands/bookmark-bulk-open.ts`) loads each bookmarked file via
  `vscode.workspace.openTextDocument` — which does **not** open a tab; only
  `showTextDocument` does. It triggers anchor resolution as a side effect. What it lacks is
  throttling and any feedback of counts into the view.
- **The `filterInfo` row is the precedent.** It is a non-bookmark root-level `TreeItem`
  (`contextValue: 'filterInfo'`) with inline action buttons declared via `view/item/context`
  menu groups in `package.json`. The two new rows reuse exactly this mechanism.
- **The repair queue gives us the "busy" signal for free.** `AnchorRepairQueue`
  (`packages/extension/src/repairQueue.ts`) already tracks `pending` / `pendingDeepFlex`
  sets and a `processing` flag. Exposing an idle check lets the rows freeze their counts
  while auto-repair drains.
- **Broken counts already live in a cache.** `broken-anchors.json` plus the in-memory
  `anchorState` map (`packages/extension/src/anchorState.ts`) track broken/warning status
  per bookmark and `lastValidatedAt` per file. Both `X/Y broken` and "which files have we
  validated this session" are computable from existing data.
- **Agent MCP connection state already exists.** `mcp-install-state.ts` records
  `claude` / `cursor` / `codex` installs (scope + version) in global/workspace state, with
  `getMcpInstallRecords(context)`. The Claude setup command already demonstrates the
  terminal-launch pattern (`createTerminal` + `sendText`).

---

## The two tree rows (`treeProvider.ts` + `package.json`)

Both are root-level `TreeItem`s prepended after `filterInfo`, with their own
`contextValue`s and inline buttons via `view/item/context` groups (mirroring how
`filterInfo` / `subSearch` declare their inline actions).

### Scan All row

- **Icon:** `$(search)` at rest, `$(sync~spin)` while a scan is running.
- **Label / count (coverage):**
  - At rest: `Scan All — 3/43 scanned`
  - Running: `Scanning… 18/43`
  - Complete: `Scan All — 43/43 scanned`
- **Meaning of the count:** `Y` = number of files that contain bookmarks; `X` = number of
  those files we have actually validated this session (have an `anchorState` entry). At
  startup only open files count; after a scan, `X` approaches `Y`. The number communicates
  how complete the extension's knowledge is.
- **Click:** runs the scan (see *Scan engine*).

### Repair All row

- **Zero broken:** icon `$(pass-filled)` (green), label `Repair All — no errors`. Not
  actionable on click.
- **Some broken:** icon `$(error)` (red), label `Repair All — X/Y broken` (`Y` = total
  bookmarks, `X` = known broken). Click → launch agent repair (see *Repair launch flow*).
- **Inline gear** `$(gear)`: opens the preferences quick pick (current default agent / change
  it / connect a new MCP).

---

## Scan engine (new throttled queue)

A new small queue following the same building blocks documented in
`../agentic-bookmarks-core/docs/extension/work-queues.md` (a `Set` of pending URIs +
`setTimeout` throttling) — there is intentionally no central scheduler; each subsystem owns
its own.

- **Work items:** bookmarked-file URIs, collected with the same visibility scope as the
  existing `scanAllFiles` (honoring filters / hidden groups / hidden files / searches).
- **Per item:** `vscode.workspace.openTextDocument(uri)` — no tab. This rides the existing
  resolution path, which populates `anchorState` and, when anchors are broken, auto-feeds the
  existing `AnchorRepairQueue`. **No new repair wiring is needed.**
- **Throttle:** yield ~200ms every 5 files (e.g. process in batches of 5, then
  `await setTimeout(200)`), keeping CPU friendly and the UI responsive. Cancellable.
- **Skip already-open files:** they are already validated live, so scanning them is wasted
  work.
- **Auto-repair during scan is desired.** If the user has `autoRepair` on (the default),
  scanning naturally lets auto-repair fix what it can. This is cheaper than escalating to an
  LLM agent later, and the user has already accepted that auto-repair runs in general.

### Refresh timing (avoid flicker)

After the scan queue drains, **wait for `AnchorRepairQueue` to be idle** (`pending` empty,
`pendingDeepFlex` empty, and not `processing`) before refreshing the counts on *both* rows.
This prevents the broken count from flickering while auto-repair is mid-flight.

Add to `AnchorRepairQueue`:

- `isIdle(): boolean` — true when both queues are empty and `processing` is false.
- a way to be notified when it next becomes idle (e.g. an `onIdle` emitter, or a small poll
  loop the scan flow awaits). The scan flow refreshes once on idle.

---

## Repair launch flow (new reusable function)

A new "launch agent repair" function, callable from the Repair All click now and reusable
from other call sites later. It is mostly glue over flows that already exist.

### New persisted state

- `agenticBookmarks.repairAgentDefault` (**globalState**): the user's chosen default agent
  (`'claude' | 'codex' | 'cursor'`), or unset.
- `agenticBookmarks.agentRepairConsentV1` (**globalState**): one-time consent flag, mirroring
  the `gitignoreNudgeShownV1` pattern.

### Agent selection

Read connected agents via `getMcpInstallRecords(context)`:

1. **0 connected** → quick pick offering to connect, routing to the existing
   `setupClaude` / `setupCursor` / `setupCodex` commands. (Abort the repair launch; the user
   can click again after connecting.)
2. **Default preference set** → use it.
3. **No preference, exactly 1 connected** → use that one.
4. **No preference, 2+ connected** → quick pick to choose; **save the choice** as
   `repairAgentDefault`.

### First-ever consent

On the first launch ever (no `agentRepairConsentV1`), show a notification explaining:

- the repair runs a **local agent of your choice**, and you'll see it run;
- it draws on **your agent's own billing** — this is not a cloud feature;
- **no code or telemetry is sent to the cloud** by Agentic Bookmarks.

On accept, persist `agentRepairConsentV1` and proceed. On decline, do nothing.

### Launch

- **Claude / Codex** → `vscode.window.createTerminal({ cwd: workspaceRoot, name: … })`
  (cwd = workspace root so the agent's MCP stdio discovery finds `.bookmarks`),
  `terminal.sendText(<cmd>, true)`, `terminal.show()`. Same pattern as `applyClaudeSetup`.
  - `claude "<prompt>"`
  - `codex "<prompt>"`
- **Cursor** (and any future agent without a headless prompt CLI) → copy the prompt to the
  clipboard and show a toast ("repair prompt copied — paste it into your agent"). Improve
  per-agent later.

### Prompt

```
Please use the agentic-bookmarks MCP to repair all broken bookmarks.
```

### Gear preferences quick pick

Inline gear on the Repair All row opens a quick pick that is pure glue over the above:

- shows the current default (or "not set");
- lets the user change the default agent;
- lets the user connect a new MCP (routes to the `setup*` commands) when none/few are
  connected.

---

## Implementation risks to resolve during the plan

1. **Coverage persistence.** Verify that documents opened via `openTextDocument` but never
   shown do **not** get their `anchorState` cleared by `onDidCloseTextDocument` (which the
   extension uses via `clearStateForFile`). If they do, the "scanned" coverage would undercount
   — in that case track scanned file ids in a separate session-scoped `Set` rather than
   inferring coverage from `anchorState` membership.
2. **Count sources / de-dupe.** Pin down whether the broken count is read from the persisted
   `broken-anchors.json` cache or live in-memory `anchorState`, and how `warning` vs `broken`
   entries are counted (Repair All should count genuinely broken; decide whether warnings are
   included or shown separately).

---

## Out of scope (v1)

- Improved Cursor launch (no headless prompt CLI today) — clipboard fallback for now.
- Per-agent prompt tuning beyond the single shared prompt.
- Surfacing the broken set as an expandable triage tree under Repair All — the row launches
  the agent; the existing per-bookmark broken nodes already provide drill-down.

---

## Revision 2 — Scan reliability rework (2026-05-20)

Integration testing (`agentic-bookmarks-core/docs/plans/scan-reliability-issues.md`)
exposed three problems with the v1 scan, which rode the open-document pipeline:

1. **Missing/deleted target files were never counted as broken** — a deleted file
   can't be opened, so its bookmarks were structurally invisible.
2. **A single "scan all" under-reported and was non-monotonic** — resolution runs
   in the async `onDidOpenTextDocument` handler (not awaited by the scan), the
   broken cache is written on a 1000ms debounce, and never-shown docs can be
   evicted. Reading the cache after the scan caught only what had flushed; repeated
   runs let more flush in, so the count climbed (and sometimes regressed).
3. **The Repair All panel lagged / showed stale "no errors"** — downstream of the
   cache-timing race plus an over-conservative idle gate.

### New architecture: validate from disk, in three phases

Scan no longer depends on `openTextDocument` for correctness. Each phase:

1. **Classify (disk).** Read every **enabled registered** file's bytes and call core
   `resolveAnchors(anchors, fileLines)` directly (the server's `handleAnchorValidate`
   is the template). If the target file is missing on disk, emit a broken result with
   error code **`file_missing`** for each of its bookmarks. Throttled (batched
   `await readFile` + ~200ms sleep every 5 files) so the extension host never hangs.
   Write the broken/warning set to the cache **authoritatively** (see below). Update
   coverage + count.
2. **Finalize (only when `agenticBookmarks.autoRepair` is enabled).** Status flips to
   **"Finalizing…"**. Open *just the broken-subset* of files (throttled) to trigger
   the existing `AnchorRepairQueue`, then wait for it to drain (`isIdle()`).
3. **Reconcile (disk).** Re-validate that broken subset from disk and rewrite the
   authoritative cache, so the final count reflects post-auto-repair truth.

The open pipeline is used **only** to trigger auto-repair side effects; the count is
always read back from deterministic disk validation, so it is complete and monotonic
regardless of pipeline races, debounces, or doc eviction.

### Authoritative cache write

A scan owns the truth for every file it validated:

```
cache = (existing entries for files OUTSIDE scan scope, untouched)
      + (fresh results for every file the scan validated)
```

`discoveredAt` is preserved for entries that remain broken. A file that is now clean
has its stale entry dropped. Because scan covers all enabled registered files, this
clears lingering stale entries and resets a wrong "no errors"/stale-count panel.

### Issue 1 resolves the MCP view too

`anchor_listBroken` and the Repair All count both read the same
`.bookmarks/local/.cache/broken-anchors.json`. Writing `file_missing` entries during
scan fixes **both** at once — they are not separate work. `countBroken` already counts
`status==='broken'`, which includes `file_missing`. The only genuinely separate (and
deferred) item is `anchor_validate`, which validates live and hard-errors on a missing
file; making it return a structured `file_missing` broken result is minor server polish.

### Scope note

Scan validates **all enabled registered files** (not visibility-filtered), so the count
matches ground truth. The Scan row's `total` reflects that same all-enabled set; the
filter row continues to show filtered counts separately.
