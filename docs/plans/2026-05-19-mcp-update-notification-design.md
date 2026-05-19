# MCP Update Notification — Design (SML-1420)

## Problem

When the extension updates, the MCP server bundle path changes. Users must manually re-run MCP
setup to update their Claude Code (or Cursor/Codex) registration. Most won't know to do this and
are left with a stale MCP server.

## Goal

On extension activation after a version change, detect outdated MCP registrations and show a
notification that lets the user update with one click.

**Out of scope for this ticket:** Welcome page integration (status indicators, green/update/install
buttons). That is a follow-on ticket.

---

## State Model

Each agent gets one record per scope level, stored in the VS Code state store that matches the
scope:

```typescript
interface AgentMcpRecord {
  scope: 'local' | 'user' | 'project' | 'global';
  installedVersion: string;  // e.g. '0.7.8'
}
```

Storage layout — same key name used across both stores:

| Agent  | Store          | Key                          | Scope value  |
|--------|----------------|------------------------------|--------------|
| Claude | workspaceState | `agenticBookmarks.mcp.claude` | `'local'`   |
| Claude | globalState    | `agenticBookmarks.mcp.claude` | `'user'`    |
| Cursor | workspaceState | `agenticBookmarks.mcp.cursor` | `'project'` |
| Cursor | globalState    | `agenticBookmarks.mcp.cursor` | `'global'`  |
| Codex  | workspaceState | `agenticBookmarks.mcp.codex`  | `'project'` |
| Codex  | globalState    | `agenticBookmarks.mcp.codex`  | `'global'`  |

**Scope semantics:** per-project scope → `workspaceState`; machine-wide scope → `globalState`.
The scope naming differs between agents (`local`/`project`, `user`/`global`) but the two-level
concept is the same.

**Two records for the same agent** (e.g. Claude with both local and user) is an unsupported edge
case. The Claude CLI always removes both scopes before adding, so only one registration is active
at a time. If both slots are somehow set, both will appear in the notification.

**On uninstall:** records are never cleared by this feature. A stale record from a removed
installation just means the notification may fire on the next update; the update operation is
idempotent, so this is harmless.

---

## Components

### New: `packages/extension/src/commands/mcp-install-state.ts`

Pure helpers for reading and writing install records. No business logic beyond state I/O.

```typescript
// Write a record after a successful setup run.
// currentVersion is passed in (not read from context) for testability.
function recordMcpInstall(
  context: vscode.ExtensionContext,
  agent: 'claude' | 'cursor' | 'codex',
  scope: AgentMcpRecord['scope'],
  currentVersion: string,
): Promise<void>

// Read all populated slots across both stores.
function getMcpInstallRecords(
  context: vscode.ExtensionContext,
): { agent: string; record: AgentMcpRecord; store: 'workspace' | 'global' }[]

// Filter to entries where installedVersion !== currentVersion.
// Malformed or missing installedVersion is treated as outdated.
function getOutdatedMcpInstalls(
  context: vscode.ExtensionContext,
  currentVersion: string,
): { agent: string; record: AgentMcpRecord; store: 'workspace' | 'global' }[]
```

### Modified: `mcp-config-and-diagnostics.ts`

- `setupClaude`, `setupCursor`, `setupCodex` each call `recordMcpInstall` on their happy path,
  after the terminal is sent / file is written.
- New command `agenticBookmarks.updateMcpRegistrations` registered here. Reads
  `getOutdatedMcpInstalls`, and for each result re-runs the setup logic for that agent using the
  stored scope — no scope quick-pick. Claude opens a terminal; Cursor/Codex write files silently.
  Calls `recordMcpInstall` after each successful update.

### Modified: `extension.ts`

One new block during activation, after bootstrapping. Calls `getOutdatedMcpInstalls` and if any
exist, shows `vscode.window.showInformationMessage` with an appropriate action button (see Data
Flow below).

---

## Data Flow

### First install

1. User runs `setupClaude` from the welcome view or command palette.
2. User picks scope (quick-pick, unchanged).
3. Terminal opens and runs `claude mcp remove …; claude mcp add …`.
4. `recordMcpInstall(context, 'claude', 'user', '0.7.8')` writes
   `{ scope: 'user', installedVersion: '0.7.8' }` to `globalState`.

### Extension updates to 0.7.9

1. Extension activates; current version is `'0.7.9'`.
2. `getOutdatedMcpInstalls(context, '0.7.9')` finds the record with `installedVersion: '0.7.8'`.
3. Notification fires.
4. User clicks the action button → `agenticBookmarks.updateMcpRegistrations` executes.
5. Command reads stored record (`scope: 'user'`), builds the Claude setup command, opens terminal.
6. Terminal runs `claude mcp remove …; claude mcp add …`.
7. `recordMcpInstall` writes `installedVersion: '0.7.9'` — record is now current.
8. On next activation `getOutdatedMcpInstalls` returns empty — no notification.

### Notification button labels

The button must honestly describe what it does:

- **1 outdated agent**: single agent-specific button — e.g. `"Update Claude (user)"` — updates
  only that agent.
- **2+ outdated agents**: single `"Update All"` button — updates every outdated agent in one pass.
  (VS Code dismisses the notification on any button click, so individual buttons for 2+ agents
  would silently leave the others behind.)

Notification message names the agents regardless:
> *"Agentic Bookmarks updated to v0.7.9 — Claude (user) and Cursor (project) MCP registrations
> need updating."*

### User dismisses without clicking

The record stays at the old version. The notification fires again on the next activation. This is
intentional — we never silently suppress an outdated registration.

---

## Error Handling

- `recordMcpInstall` failures are swallowed silently. A missed state write means the notification
  may re-fire on the next update, which is acceptable.
- `agenticBookmarks.updateMcpRegistrations`: Cursor/Codex file-write failures show an error
  notification. Claude errors are visible in the terminal. The stored record is only updated after
  the operation succeeds.
- Malformed or missing `installedVersion` in a stored record → treated as outdated, included in
  the update prompt.

---

## Testing

- `mcp-install-state.ts` is testable without VS Code: inject a fake context with `workspaceState`
  / `globalState` maps and verify read/write/filter behaviour.
- The notification trigger in `extension.ts` is thin wiring — no dedicated test needed.
- The update execution path reuses the same logic as the existing setup commands, which have no
  unit tests today (VS Code API dependency). No change in test coverage posture.
