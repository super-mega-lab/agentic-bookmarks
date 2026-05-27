# Agentic Bookmarks

Your AI coding agent loses context every session. **Agentic Bookmarks** fixes that: durable, self-healing bookmarks that agents can read, place, and repair through a bundled MCP server. They survive refactors, survive Prettier, survive branch merges — and check into git so your whole team shares persistent codebase knowledge.

---

## What can your agent do?

Once the MCP server is connected, your AI assistant can:

- **Place bookmarks** during research — "bookmark the auth boundary and the rate limiter"
- **Read bookmarks as context** — "what bookmarks exist in this module?"
- **Map an entire codebase** — "map this codebase with bookmarks" (uses built-in skill guide)
- **Repair broken bookmarks** — structured diagnostic waterfall for bookmarks that drifted during large refactors

28 MCP tools cover the full lifecycle: create, read, search, organize, validate, and repair.

---

## Installation

Search for **"Agentic Bookmarks"** in the VS Code Extensions panel (`Ctrl+Shift+X` / `Cmd+Shift+X`) and click **Install**. Publisher: **supermegalab**.

Or from the command line: `code --install-extension supermegalab.agentic-bookmarks`

Also works in **Cursor** and other VS Code-compatible editors that support the Extensions API and MCP.

---

## Quickstart

1. Install **"Agentic Bookmarks"** from the Extensions panel
2. Open the **Agentic Bookmarks** panel (bookmark icon in the Activity Bar) and click **Set up for Claude Code** (or Cursor / Codex) — this also handles `.gitignore`
3. Start placing bookmarks — your agent can too

→ **[Full Getting Started guide with screenshots](resources/getting-started.md)**

---

The extension collects no usage telemetry. Pure JavaScript, no native dependencies. Source-available under [PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0/) — see [`LICENSE`](LICENSE).

> **Public beta:** all Pro features are free for everyone, no account required. Beta end date: **to be announced**.

---

## Features

### Your agents remember

A bundled MCP server lets Claude Code, Cursor, and Codex read, place, and repair bookmarks — no separate setup. Built-in skill guides teach agents best practices so you can say "map this codebase with bookmarks" and it knows what to do.

- 28 MCP tools for full bookmark lifecycle
- Works with any MCP-compatible client
- Zero-config: installs with the extension

The MCP server runs **locally on your machine**. Agents you connect to it get whatever access you'd give any other local tool — no Agentic Bookmarks service sits in the middle.

### Survives every refactor

Smart anchors store surrounding context — not line numbers — so durable bookmarks survive renames, moves, Prettier runs, and formatting passes. Self-healing keeps them correct as code drifts; agent-assisted repair handles the hard cases.

- Context-based matching, not line numbers
- Background self-healing on file changes
- Agent-assisted repair for large refactors

Repair is layered: manual relocation (always available) → background auto-repair (configurable) → agent-assisted repair through MCP for the hard cases that defeat mechanical methods.

### Knowledge that compounds

Shared team bookmarks commit to git like code. New team members and agents inherit the map on clone. Bookmark groups, labeled bookmarks, and notes turn bookmarks into living documentation.

- **Local bookmarks** — personal scratch, stored under `.bookmarks/local/` (gitignored)
- **Shared bookmarks** — team knowledge, stored under `.bookmarks/shared/` (committed)
- Merge-conflict-friendly storage format
- Bookmark groups and labels for organization

---

## Privacy

- **No telemetry.** The extension does not phone home, does not record
  usage events, and does not transmit your code, repository metadata, or
  bookmarks to any server we run.
- **AI / MCP runs locally.** When an agent uses the MCP server, prompts
  and completions flow between your editor and your AI provider directly.
  Agentic Bookmarks is not in that path.
- **Repository visibility** (used to decide which Pro features are free —
  see _Beta status_ below) is determined on your device.

Full details: see the [Privacy Policy](https://agenticbookmarks.com/legal/privacy)
and [Security Overview](https://agenticbookmarks.com/legal/security).

---

## Beta status

Agentic Bookmarks is currently in **beta**. During the beta period:

- **All Pro features are free** for everyone, regardless of subscription
  state. You don't need an account.
- We're collecting feedback to shape what stays free post-beta vs. what
  becomes a paid Pro feature. Since we don't include ANY telemetry,
  please file a GitHub issue or email us — we will listen.

After the beta ends (Beta End Date: **to be announced**), the product
transitions to a freemium model:

- **Community features** stay free for everyone.
- A subset of **Pro features** stays free on **public repositories** 
- The remaining Pro features require a subscription. 

We'll give clear notice before that transition happens.

---

## License and acceptance

Agentic Bookmarks is **source-available** under the
[PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0/)
license — see [`LICENSE`](LICENSE). In short: you can use, read, modify, and
share the source for any purpose **except** offering it as a competing
product.

**By installing or using Agentic Bookmarks, you agree to:**

- the [End User License Agreement](https://agenticbookmarks.com/legal/eula)
  (Bonterms Standard End User Agreement v1.0),
- the [Provider-Specific Terms](https://agenticbookmarks.com/legal/terms),
  including the
  [Beta and Pro Features Policy](https://agenticbookmarks.com/legal/policy),
- the [Privacy Policy](https://agenticbookmarks.com/legal/privacy), and
- where it applies to your use of the extension, the
  [Data Processing Addendum](https://agenticbookmarks.com/legal/dpa).

If you do not agree to these, please do not install or use the extension.

The public source repository is at
<https://github.com/super-mega-lab/agentic-bookmarks>.

---

## Keyboard shortcuts

The extension ships with single-press default keybindings that match
familiar conventions from other bookmark extensions:

| Action                       | Shortcut                                             | When                                  |
| ---------------------------- | ---------------------------------------------------- | ------------------------------------- |
| Toggle bookmark              | `Ctrl+Alt+K` (`Cmd+Alt+K` on macOS)                  | Editor focused                        |
| Jump to next bookmark        | `Ctrl+Alt+L` (`Cmd+Alt+L`)                           | Editor focused                        |
| Jump to previous bookmark    | `Ctrl+Alt+J` (`Cmd+Alt+J`)                           | Editor focused                        |
| Expand selection to next     | `Shift+Alt+L`                                        | Editor focused                        |
| Expand selection to previous | `Shift+Alt+J`                                        | Editor focused                        |
| Shrink selection             | `Shift+Alt+K`                                        | Editor focused                        |
| Confirm re-anchor pick       | `Enter`                                              | Re-anchor pick mode active            |
| Cancel re-anchor pick        | `Escape`                                             | Re-anchor pick mode active            |

Heads-up: `Ctrl+Alt+<key>` produces AltGr characters on many European
keyboard layouts (DE, FR, etc.) — if you're on one of those, switch to
`chorded` or `custom` mode (see below). On macOS, the basic bindings use
`Cmd+Alt` instead of `Ctrl+Alt`.

### Switching keybinding modes

The **`agenticBookmarks.hotkeyStyle`** setting lets you pick the mode that
matches how you want to work:

- **`basic`** (default) — single-press shortcuts matching
  `alefragnani.Bookmarks`: `Ctrl+Alt+K` to toggle, `Ctrl+Alt+L` /
  `Ctrl+Alt+J` to jump to the next / previous bookmark, and
  `Shift+Alt+L` / `Shift+Alt+J` / `Shift+Alt+K` to expand the selection
  to the next / previous bookmark / shrink it.
- **`chorded`** — `Ctrl+K Ctrl+B`-style chord shortcuts (`Cmd+K` on
  macOS). Avoids single-press conflicts and AltGr issues on European
  layouts. Chords: `Ctrl+K Ctrl+B` toggle, `Ctrl+K Ctrl+Shift+B` toggle
  labeled, `Ctrl+K Ctrl+N` / `Ctrl+K Ctrl+P` jump next / prev,
  `Ctrl+K L` list in file, `Ctrl+K Ctrl+Shift+L` list all,
  `Ctrl+K Ctrl+F` toggle group filtering.
- **`custom`** — keeps the chorded defaults active and unlocks the
  **Agentic Bookmarks: Customize Keybindings…** command, which opens VS
  Code's Keyboard Shortcuts UI pre-filtered to this extension's commands
  so you can bind whatever you like without leaving the extension's mental
  model.

### Customizing keybindings

Use VS Code's standard `keybindings.json` (Command Palette → "Preferences:
Open Keyboard Shortcuts (JSON)").

**Bind a different key** to any of our commands — for example to bind
`Ctrl+K B` to the toggle command:

```jsonc
{ "key": "ctrl+k b", "command": "agenticBookmarks.toggle", "when": "editorTextFocus" }
```

**Disable one of our defaults** by prefixing the command with `-`:

```jsonc
{ "key": "ctrl+k ctrl+f", "command": "-agenticBookmarks.toggleFiltering" }
```

**Discover all our commands** via Command Palette
(`Ctrl+Shift+P` / `Cmd+Shift+P`) and type "Bookmarks" or
"Agentic Bookmarks". Each is bindable.

---

## Settings

Settings live under **`agenticBookmarks.*`** in VS Code's settings UI.
Highlights:

- **`agenticBookmarks.dataDirectory`** — where shared bookmark data is
  stored, relative to the workspace root (default `.bookmarks`). Change
  this if your project already uses `.bookmarks` for something else.
- **`agenticBookmarks.hotkeyStyle`** — picks the keybinding preset:
  `basic` (default) for single-press `Ctrl+Alt+K/L/J` shortcuts, `chorded`
  for the `Ctrl+K Ctrl+B …` chords, or `custom` to keep the chords and
  enable the **Agentic Bookmarks: Customize Keybindings…** command.
- **`agenticBookmarks.autoRepair`** — automatically attempt to repair
  broken smart anchors when files are opened.
- **`agenticBookmarks.autoRepairCanUseGit`** — allow auto-repair to use
  git history analysis (blame, line tracing) as an enhancement.
- **`agenticBookmarks.editorOverlay.*`** — control inline label/note
  overlays in the editor body.
- **`agenticBookmarks.showLowConfidenceIndicators`** — surface a `?`
  overlay on bookmarks whose anchor match is uncertain.
- **`agenticBookmarks.mcpCanEditFiles`** — allow the MCP server to write
  tag comments directly into source files. Off by default (the server
  returns the tag string for the agent to insert).

See the **Settings** UI for the full list and descriptions.

---

## Support & feedback

- Issues, feature requests, and bug reports:
  <https://github.com/super-mega-lab/agentic-bookmarks/issues>
- Email: **contact@supermegalab.com**

We read everything during the beta. If something feels wrong or missing,
please tell us.

---

## Links

- Marketplace listing: [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=supermegalab.agentic-bookmarks)
- Source repository: <https://github.com/super-mega-lab/agentic-bookmarks>
- Product page: <https://agenticbookmarks.com>
- Company / Publisher: <https://supermegalab.com>
- Privacy Policy: <https://agenticbookmarks.com/legal/privacy>
- Security Overview: <https://agenticbookmarks.com/legal/security>
- Provider-Specific Terms: <https://agenticbookmarks.com/legal/terms>
- End User License Agreement: <https://agenticbookmarks.com/legal/eula>
- Data Processing Addendum: <https://agenticbookmarks.com/legal/dpa>
- Data Handling Statement: <https://agenticbookmarks.com/legal/data-handling>
- Beta and Pro Features Policy: <https://agenticbookmarks.com/legal/policy>
- Sub-processor list: <https://agenticbookmarks.com/legal/subprocessors>
- License (PolyForm Shield 1.0.0): [`LICENSE`](LICENSE)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)
