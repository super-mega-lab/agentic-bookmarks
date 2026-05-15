# @agentic-bookmarks/licensing

Feature-gating package. Pure TypeScript, no VS Code dependency.

## Surface

- `checkFeature(name, deps)` — central gate. Pure function over injected `getLicenseStatus` / `getRepoVisibility`.
- `PRO_FEATURES`, `FREE_FEATURES`, `FeatureName` — registries and union type.
- `createStubLicenseChecker(getConfig)`, `createStubRepoVisibility(getConfig)` — settings-driven stubs (still used as a dev override for visibility; see below).

## Decision logic

```
checkFeature(name)
  └─ free feature?              → allowed
  └─ public or local repo?      → allowed
  └─ valid pro or trial tier?   → allowed
  └─ otherwise                  → denied (reason: pro-required)
```

Trial is treated equivalent to pro for gating.

## Visibility detection (SML-1338)

Real workspace visibility comes from `@agentic-bookmarks/core`'s `openSourceDetection` module, wired through `LicensingService.detect()` in the extension. The detector parses git remotes, runs HTTPS HEAD probes against the canonical platform URL, and caches results in-memory for the session (24h public TTL / 6h private TTL).

`LicensingService.visibility()` stays sync — it returns the most recently cached value. `detect()` is async and refreshes the cache in the background; `onDidChange` fires after each refresh so consumers (settings tree, context keys) update without polling.

### Initial state

Before the first detection completes, `visibility()` returns `'private'`. This is the safe gating default — any pro feature stays gated until we've proved the repo is public/local. Detection is fast in the common case (single git remote, ~100-500ms cold) so this transitional state is rarely user-visible.

### Workspace 'mixed' handling

Multi-root workspaces with heterogeneous visibility get mapped:

- The detector promotes `'public'` whenever any root is public — so `{public, local}` already comes back as `'public'`.
- The detector returns `'mixed'` only when `{private, local}` are mixed (no public root).
- The licensing layer maps `'mixed'` → `'private'` for gating, since whole-workspace conservative gating is the safe default.

Future refinement: per-folder gating, where `checkFeature(name, document)` looks up the folder for the active document. Out of scope for SML-1338.

### Multi-remote on a single root: any-public-wins

Within a single workspace folder, a repo with multiple git remotes classifies as `'public'` if **any** remote probes public. This is intentional and product-driven, not a bug.

The motivating workflow: a contributor to an open-source project keeps the upstream public remote (e.g. `openBCIofficial → https://github.com/OpenBCI/OpenBCI_GUI.git`) alongside a private fork they push their own commits to (e.g. `origin → git@github.com:user/fork.git`). The detector reports:

```
openBCIofficial → public  [http=200]
origin          → private [http=404]
```

…and aggregates to `'public'`, so pro features unlock. Treating this case as private would gate tools for legitimate OSS contributors with private dev forks — a much more common scenario than the bypass case, and a hostile UX choice.

The bypass case is real but low-value: someone could add a fake public remote to a private project to unlock pro features. We accept this — anyone willing to manipulate git config to launder licensing isn't a paying customer.

Hardening alternatives we evaluated and rejected:

- **All remotes must be public** — breaks every legit forked-OSS workflow.
- **Honor only `origin`** — backwards from the OpenBCI case, where `origin` is the private fork.
- **Track a "primary remote"** — git has no canonical signal for this.

If a future ticket revisits this, the rationale lives here so we don't quietly tighten the rule and break OSS contributors.

### Dev override

The `agenticBookmarks.licensing.testVisibility` setting works as a dev override. The default `"auto"` defers to real detection. Setting it to `public`/`private`/`local` fully short-circuits detection — `detect()` becomes a no-op and `visibility()` returns the override. Useful for testing gate behavior without manipulating git remotes.

### Refresh triggers

- Extension activation (one-shot fire-and-forget).
- `onDidChangeWorkspaceFolders` (force re-detect).
- `Agentic Bookmarks: Dev: Refresh Repo Visibility` palette command (dev-mode only).
- `Agentic Bookmarks: Dev: Diagnose License Status` palette command or right-click on the License row in the Settings tree (dev-mode only). Force re-runs detection and dumps a verbose report to the Agentic Bookmarks output channel — see "Testing and diagnosis" below.

## Testing and diagnosis

### Enabling the dev commands

The `Agentic Bookmarks: Dev: *` palette commands and the right-click menu on the License row are gated by the `agenticBookmarks.isDevelopment` context key, which is `true` when:

1. The extension runs under F5 dev host (`extensionMode !== Production`), **or**
2. The `agenticBookmarks.licensing.devCommandsEnabled` setting is `true`.

To turn them on for a packaged install, add to user `settings.json`:

```json
{
  "agenticBookmarks.licensing.devCommandsEnabled": true
}
```

…then ⌘⇧P → "Developer: Reload Window".

### Available dev commands

- **Agentic Bookmarks: Dev: Test Feature Gate…** — QuickPick (`test-pro` / `test-free`), runs `checkFeature` against current state, toasts the result.
- **Agentic Bookmarks: Dev: Show Intercept Dialog** — exercises the "Smart Anchors require Pro for private repos" intercept UX with the three button actions (each toasts its action name; no real flow yet).
- **Agentic Bookmarks: Dev: Show Licensing State** — modal info message with current tier, visibility, and feature counts.
- **Agentic Bookmarks: Dev: Refresh Repo Visibility** — force-runs detection and toasts the resolved visibility.
- **Agentic Bookmarks: Dev: Diagnose License Status** — verbose detection report to the Agentic Bookmarks output channel. Also surfaced as a right-click action on the License row in the Settings tree (inline icon + context menu).

### Diagnose report format

The diagnose command writes a block like this to the output channel:

```
═══════════════════════════════════════════════════════════════
License diagnosis @ 2026-04-30T00:27:12.839Z
═══════════════════════════════════════════════════════════════
Workspace folders (1):
  - /Users/afoster/Documents/otherproj/bcigui

Test override: not set
Running detection (force=true, bypassing TTL cache)...
Workspace visibility (raw):    public
Workspace visibility (mapped): public

Per-root breakdown (1):
  /Users/afoster/Documents/otherproj/bcigui
    visibility:    public
    graceFallback: false
    remotes (2):
      openBCIofficial → public [source=probe, platform=github, http=200]
        url: https://github.com/OpenBCI/OpenBCI_GUI.git
        probe: https://github.com/openbci/openbci_gui
      origin → private [source=probe, platform=github, http=404, reason=http-404]
        url: git@github.com:afostr/bcigui.git
        probe: https://github.com/afostr/bcigui

Resolved licensing state:
  tier:       free
  visibility: public

Gate checks:
  checkFeature('test-pro')  → ALLOWED
  checkFeature('test-free') → ALLOWED
═══════════════════════════════════════════════════════════════
```

### Reading the report

- **Workspace visibility (raw)** — what the detector returned (`public`/`private`/`local`/`mixed`).
- **Workspace visibility (mapped)** — what the licensing layer applies (`mixed` → `private`).
- **Per-root breakdown** — one entry per workspace folder.
  - `visibility` — that folder's aggregated visibility across its remotes.
  - `graceFallback: true` — network failure path; the value is the conservative `'private'` grace result, not a real probe.
  - **remotes** — per-remote rows showing what was probed and the response.
    - `source=probe` — fresh HTTPS HEAD result.
    - `source=cache` — cache hit within TTL.
    - `source=fallback` — TTL-expired cache returned because the live probe failed.
    - `source=unknown-platform` — host wasn't github/gitlab/bitbucket; short-circuits to `private`.
    - `source=no-remotes` — no git remote configured on this root.
    - `http=200` — repo exists publicly.
    - `http=404` — GitHub returns 404 to anonymous HEAD on a private repo. Canonical "private" signal.
    - `stale` flag — entry came from a TTL-expired cache via fallback.
- **Gate checks** — the actual `checkFeature` decisions for the two test fixtures, given the resolved state.

### Suggested smoke-test sequence

After a build + install, exercise:

1. **Public repo** (any open-source repo with a public remote) → `visibility=public`, `test-pro=ALLOWED`.
2. **Private repo** → `visibility=private`, `test-pro=DENIED (reason=pro-required)`.
3. **Local repo** (no `git remote` configured) → `visibility=local`, `test-pro=ALLOWED`.
4. **Multi-remote with one public + one private** → `visibility=public`, `test-pro=ALLOWED` (any-public-wins; see above).
5. **Override path** — set `agenticBookmarks.licensing.testVisibility: "private"` → `Test override: private`, detection skipped, `test-pro=DENIED`. Reset to `"auto"` to confirm detection resumes.
6. **Tier path** — set `agenticBookmarks.licensing.testTier: "pro"` on a private repo → `test-pro=ALLOWED` (pro tier overrides private gating).

## Settings

- `agenticBookmarks.licensing.testTier` → `auto` | `free` | `pro` | `trial`. Default `auto` defers to the real license check (currently a Phase 1 stub returning `'free'`); replaced by SML-1300.
- `agenticBookmarks.licensing.testVisibility` → `auto` | `public` | `private` | `local`. Default `auto` defers to the real workspace visibility detector. Set explicitly to override.
- `agenticBookmarks.licensing.devCommandsEnabled` → boolean. Default `false`. Force-show the `Agentic Bookmarks: Dev: *` commands in production builds.

## Pre-launch cleanup

Before shipping the licensing system to end users, the following dev/debug surfaces should be reviewed and either removed, renamed, or hidden behind a build flag rather than a runtime setting:

- **`agenticBookmarks.licensing.testTier`** — bypass for the real license check. Should be removed once SML-1300 ships and there's no legitimate user-facing reason to force a tier.
- **`agenticBookmarks.licensing.testVisibility`** — bypass for the real visibility detector. Same rationale as above; possibly retain as a hidden internal-only setting for support diagnostics.
- **`agenticBookmarks.licensing.devCommandsEnabled`** — flips on `agenticBookmarks.isDevelopment`. End users don't need to see or be able to flip this.
- **`agenticBookmarks.testLicense.*` palette commands** (5 of them: testFeatureGate, testIntercept, getState, refreshVisibility, diagnoseStatus) — useful during development and for support tickets, but the surface area shouldn't ship as user-discoverable. Decide per-command:
  - Keep (gated by a build constant rather than a runtime setting): `diagnoseStatus` (good support tool).
  - Remove or hide: `testFeatureGate`, `testIntercept`, `getState`, `refreshVisibility`.
- **License row right-click menu entry** for `diagnoseStatus` — ditto; either retain as a support tool or remove from the production menu.
- **`test-pro` / `test-free` fixtures** in `PRO_FEATURES` / `FREE_FEATURES` — exclusively used by dev commands and unit tests. Consider whether the production registry should ship them. Removing requires updating the `agenticBookmarks.testLicense.testFeatureGate` QuickPick contents (or removing that command entirely) and any tests that reference them.
- **Heavy banner formatting** in the diagnose output (`═══` lines) — fine for dev, fine to keep, just flagged.

A pre-ship cleanup ticket should walk through this list and decide each item one-by-one. Don't blanket-remove — `diagnoseStatus` in particular is the kind of thing that pays for itself the first time a customer reports flaky gating.

## Pending follow-ups

- **SML-1300** — license-key validation (replaces `createStubLicenseChecker`).
- **SML-1333** — persistent 14-day trial timer (adds real `expiresAt`).
- **SML-1332** — per-feature UI badges and tree-item decorations.

Files explicitly deferred to other tickets and NOT shipped here:

- `activation.ts` — device activation/deactivation (SML-1300).
- `mcp-bridge.ts` — MCP `license-state.json` (separate ticket).
