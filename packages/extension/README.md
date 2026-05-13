# Agentic Bookmarks

VS Code extension for managing bookmarks, with a bundled MCP server so AI coding agents can read, add, and navigate them too.

## Keyboard shortcuts

The extension ships with a default keybinding. All editor-scope chords use the `Ctrl+K …` (`Cmd+K …` on macOS) prefix to stay clear of single-press defaults and to avoid AltGr issues on European keyboard layouts.

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

`Ctrl+K L` for "List bookmarks in file" intentionally drops the second `Ctrl` — VS Code's default `Ctrl+K Ctrl+L` is `editor.toggleFold` and we don't want to override it.

### Customizing keybindings

Use VS Code's standard `keybindings.json` (Command Palette → "Preferences: Open Keyboard Shortcuts (JSON)").

**Bind a different key** to any of our commands — for example to bind `Ctrl+K B` to the toggle command:

```jsonc
{ "key": "ctrl+k b", "command": "agenticBookmarks.toggle", "when": "editorTextFocus" }
```

**Disable one of our defaults** by prefixing the command with `-`:

```jsonc
{ "key": "ctrl+k ctrl+f", "command": "-agenticBookmarks.toggleFiltering" }
```

**Discover all our commands** via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type "Bookmarks" or "Agentic Bookmarks". Each is bindable.

### Migrating from `alefragnani.Bookmarks`?

If you're used to that extension's defaults and want the same keys to drive ours, paste this into `keybindings.json`.

```jsonc
[
  { "key": "ctrl+alt+k", "command": "agenticBookmarks.toggle",         "when": "editorTextFocus" },
  { "key": "ctrl+alt+l", "command": "agenticBookmarks.jumpNext",       "when": "editorTextFocus" },
  { "key": "ctrl+alt+j", "command": "agenticBookmarks.jumpPrevious",   "when": "editorTextFocus" }
]
```

On macOS, replace `ctrl+alt` with `cmd+alt`. Heads-up: `Ctrl+Alt+<key>` produces AltGr characters on many European keyboard layouts (DE, FR, etc.) — pick different keys if you're on one of those.
