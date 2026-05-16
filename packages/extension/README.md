# Agentic Bookmarks

**Durable code bookmarks for you and your AI agents.** Bookmarks that survive
refactors, merge cleanly when checked into git, and that LLM agents can read,
place, and repair through MCP — turning the bookmark set into shared project
memory for a team and the agents working with it.

> _[PLACEHOLDER: hero GIF / screenshot — bookmarks panel + gutter decorations +
> overlay notes in an editor]_

---

## Why another bookmarks extension?

Traditional bookmarks work as "a line number in a file." That works fine until anyone else edits
the file — which is why bookmarks are usually treated as throwaway,
single-developer scratch state instead of a real way to share knowledge about
a codebase.

Agentic Bookmarks takes the opposite bet: **a bookmark should be a first-class
artifact of a codebase that a team — and the agents working with that team —
can rely on.**

- **Durable anchors.** Bookmarks resolve from surrounding context, not raw
  line numbers, so they survive normal editing and merging.
- **Local _and_ shared, as first-class concepts.** Personal scratch
  bookmarks ("I'm working here this week") and team-shared knowledge
  ("this is the auth boundary") have different tradeoffs and are modelled
  separately.
- **AI agents as a first-class user.** A bundled MCP server lets agents
  read, place, organize, and repair bookmarks during research and task work.

---

## Installation

Install **Agentic Bookmarks** from the VS Code Marketplace:

- Marketplace page: _[PLACEHOLDER: Marketplace listing URL once published]_
- Or, in VS Code: open the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
  and search for **Agentic Bookmarks**.
- Or, from the Command Palette: `ext install supermegalab.agentic-bookmarks`.

Requires VS Code `1.92` or newer. Also works in **Cursor** and other
VS Code–compatible editors that support the Extensions API and MCP.

---

## Getting started

1. Open any file and place your cursor on a line you want to remember.
2. Press **`Ctrl+K Ctrl+B`** (**`Cmd+K Cmd+B`** on macOS) to toggle a
   bookmark on the current line. Use **`Ctrl+K Ctrl+Shift+B`** to add a
   labelled bookmark — you'll be prompted for a label and (optionally) a
   group.
3. Open the **Bookmarks** panel from the Activity Bar to see every bookmark
   in the workspace, organized by group and file.
4. Jump between bookmarks with **`Ctrl+K Ctrl+N`** / **`Ctrl+K Ctrl+P`**, or
   open the in-file list with **`Ctrl+K L`**.

> _[PLACEHOLDER: short GIF — toggle a bookmark, see it in the panel, jump to
> the next one]_

That's the minimum loop. Everything else — groups, notes, MCP, repair — is
optional polish on top.

---

## Features

### Anchors: how a bookmark stays attached to code

Three anchor types, picked per bookmark:

- **Smart anchor (default).** Stores enough surrounding context to re-find
  its line as code drifts. Designed for adaptive, loose matching — small
  edits in or near the line don't force the stored data to update, which is
  what makes smart anchors team-friendly when checked into git.
- **Tag anchor.** Places a small comment tag (e.g. `// @bookmark:abc123`)
  on the line. The source of truth lives in the code itself, so maintenance
  is trivial; the tradeoff is that the code has to be touched. A natural
  fit for shared bookmarks where an inline marker is acceptable.

> _[PLACEHOLDER: diagram comparing the three anchor types]_

### Local vs. shared bookmarks

Bookmarks live in files in your repo, but **local** and **shared** are
different first-class concepts:

- **Local bookmarks** are personal scratch — stored under
  `.bookmarks/local/` in your workspace (gitignored). Smart anchors
  used for local bookmarks keep richer context, since git history
  can't help bail them out.
- **Shared bookmarks** live under `.bookmarks/shared/` in your
  workspace and are checked in (path configurable). They use a
  leaner footprint so the data file doesn't churn merge conflicts on
  every neighbouring edit.

### Groups, labels, notes, overlays

- **Groups** organize bookmarks and each one has its own icon style and
  color. A curated catalog ships so groups stay visually distinct without
  configuration work.
- **Labels** are short titles; **notes** are longer free-form text — the
  "what is this and why did I mark it" that turns a pin into a useful
  artifact (especially for agents reading them).
- Bookmarks render as **gutter decorations**. With editor overlays
  enabled, labels and notes can also appear **inline in the editor** as
  floating UI.
- Don't like the visual styling? **Uniform-style** and **uniform-color**
  overrides flatten the appearance without changing the bookmarks
  themselves.
- **Broken or low-confidence anchors** get distinct overlay indicators so
  problems are visible at a glance.

> _[PLACEHOLDER: screenshot of gutter decorations + inline note overlay]_

### Self-healing: when anchors do drift or break

Code changes can always outrun an anchor. Repair is a layered system:

1. **Manual relocation.** Right-click a broken bookmark and pick the
   correct line with a quick-pick UI. Always available.
2. **Auto-repair.** Mechanical repair that runs in the background
   (configurable; can be disabled and triggered on demand instead). Uses
   context search, optionally git history, and shift validation to find
   the most likely new location — and only writes when confidence is high
   enough. Conservative by design: it's allowed to refuse when it isn't
   sure.
3. **Agent-assisted repair.** Through MCP, an LLM agent can run a
   structured waterfall of diagnostic and repair tools — diff diagnosis,
   baseline-commit forensics, line tracing, moved-code search, cross-file
   search — and resolve cases that defeat purely mechanical methods. This
   is what makes long-lived, shared bookmarks practical.

### AI / MCP integration

The bundled **MCP server** gives AI coding agents the same view of bookmarks
you have, plus dedicated tooling for the things agents are uniquely good at:

- **Research & placement.** Agents can study code and place well-labelled
  bookmarks during an investigation — leaving a trail behind, or setting up
  landmarks at the start of a task.
- **Reading bookmarks as task context.** When working a ticket, an agent
  can pull the relevant bookmarks (with their notes) into its working
  context, turning the bookmark set into evolving project memory.
- **Organization.** Rename, regroup, retag, and clean up bookmarks as
  part of broader codebase maintenance.
- **Repair.** The most invested-in capability — see above.

> _[PLACEHOLDER: setup instructions / one-liner for Claude Code, Cursor, and
> any other MCP-capable agents — once setup commands are finalized]_

The MCP server runs **locally on your machine**. Agents you connect to it
get whatever access you'd give any other local tool — no Agentic Bookmarks
service sits in the middle.

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

## Keyboard shortcuts (QOL upgrade on way)

The extension ships with default keybindings. All editor-scope chords use
the `Ctrl+K …` (`Cmd+K …` on macOS) prefix to stay clear of single-press
defaults and to avoid AltGr issues on European keyboard layouts.

| Action                       | Shortcut                                            | When                                  |
| ---------------------------- | --------------------------------------------------- | ------------------------------------- |
| Toggle bookmark              | `Ctrl+K Ctrl+B` (`Cmd+K Cmd+B` on macOS)            | Editor focused                        |
| Toggle labeled bookmark      | `Ctrl+K Ctrl+Shift+B` (`Cmd+K Cmd+Shift+B`)         | Editor focused                        |
| Jump to next bookmark        | `Ctrl+K Ctrl+N` (`Cmd+K Cmd+N`)                     | Editor focused                        |
| Jump to previous bookmark    | `Ctrl+K Ctrl+P` (`Cmd+K Cmd+P`)                     | Editor focused                        |
| List bookmarks in file       | `Ctrl+K L` (`Cmd+K L`)                              | Editor focused                        |
| List bookmarks in all files  | `Ctrl+K Ctrl+Shift+L` (`Cmd+K Cmd+Shift+L`)         | Editor focused                        |
| Toggle group filtering       | `Ctrl+K Ctrl+F` (`Cmd+K Cmd+F`)                     | Bookmarks panel focused               |
| Confirm re-anchor pick       | `Enter`                                             | Re-anchor pick mode active            |
| Cancel re-anchor pick        | `Escape`                                            | Re-anchor pick mode active            |

`Ctrl+K L` for "List bookmarks in file" intentionally drops the second
`Ctrl` — VS Code's default `Ctrl+K Ctrl+L` is `editor.toggleFold` and we
don't want to override it.

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

### Migrating from other extensions or not a fan of chords?

The simplest path is the **`agenticBookmarks.hotkeyStyle`** setting. Pick the
mode that matches how you want to work:

- **`chorded`** (default) — the `Ctrl+K Ctrl+B …` chord shortcuts described
  above.
- **`basic`** — single-press shortcuts matching `alefragnani.Bookmarks`:
  `Ctrl+Alt+K` to toggle, `Ctrl+Alt+L` / `Ctrl+Alt+J` to jump to the next
  / previous bookmark, and `Shift+Alt+L` / `Shift+Alt+J` / `Shift+Alt+K`
  to expand the selection to the next / previous bookmark / shrink it.
- **`custom`** — keeps the chorded defaults active and unlocks the
  **Agentic Bookmarks: Customize Keybindings…** command, which opens VS
  Code's Keyboard Shortcuts UI pre-filtered to this extension's commands
  so you can bind whatever you like without leaving the extension's mental
  model.

Heads-up: `Ctrl+Alt+<key>` produces AltGr characters on many European
keyboard layouts (DE, FR, etc.) — if you're on one of those, prefer
`custom` mode and pick different keys. On macOS, the basic bindings use
`Cmd+Alt` instead of `Ctrl+Alt`.

**Advanced: hand-rolled `keybindings.json`.** If you'd rather manage
bindings yourself, paste this snippet — it reproduces the basic-mode keys
and is a good starting point to tweak:

```jsonc
[
  { "key": "ctrl+alt+k",  "command": "agenticBookmarks.toggle",                    "when": "editorTextFocus" },
  { "key": "ctrl+alt+l",  "command": "agenticBookmarks.jumpNext",                  "when": "editorTextFocus" },
  { "key": "ctrl+alt+j",  "command": "agenticBookmarks.jumpPrevious",              "when": "editorTextFocus" },
  { "key": "shift+alt+l", "command": "agenticBookmarks.expandSelectionToNext",     "when": "editorTextFocus" },
  { "key": "shift+alt+j", "command": "agenticBookmarks.expandSelectionToPrevious", "when": "editorTextFocus" },
  { "key": "shift+alt+k", "command": "agenticBookmarks.shrinkSelection",           "when": "editorTextFocus" }
]
```

On macOS, replace the `ctrl+alt` entries with `cmd+alt`; the `shift+alt`
entries are the same on both platforms.

---

## Settings

Settings live under **`agenticBookmarks.*`** in VS Code's settings UI.
Highlights:

- **`agenticBookmarks.dataDirectory`** — where shared bookmark data is
  stored, relative to the workspace root (default `.bookmarks`). Change
  this if your project already uses `.bookmarks` for something else.
- **`agenticBookmarks.hotkeyStyle`** — picks the keybinding preset:
  `chorded` (default) for the `Ctrl+K Ctrl+B …` chords, `basic` for the
  single-press `Ctrl+Alt+K/L/J` shortcuts, or `custom` to keep the chords
  and enable the **Agentic Bookmarks: Customize Keybindings…** command.
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

- Marketplace listing: _[PLACEHOLDER: Marketplace URL]_
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
