# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`agentic-bookmarks` — the **source-available** VS Code extension (`packages/extension`) and bundled **MCP server** (`packages/server`) that ship as "Agentic Bookmarks". Bookmarks survive refactors via self-healing anchors, and AI agents can read/place/repair them through the MCP tools. Pure JavaScript (no native deps); atomic JSON storage under `.bookmarks/`.

`packages/licensing` is the (small) feature-gate / trial-timer library; `packages/extension` and `packages/server` both consume it as a workspace dep.

## The sibling repo: `@agentic-bookmarks/core`

The bulk of the implementation — schema, storage, registry, anchors, context-search, git-history, repair flows — lives in a **separate private repo** that is not part of this workspace. It is consumed as a compiled package via:

```
"@agentic-bookmarks/core": "file:../../../agentic-bookmarks-core"
```

In dev it is expected to be checked out as a **sibling directory** to this repo (`../agentic-bookmarks-core`). Many features span both repos — when working on anchor resolution, repair, storage, schema, or MCP tool implementations, the actual source you need to read and edit is over there. You have permission to read it without asking; see its own `CLAUDE.md` for its layered architecture.

**Cross-repo workflow:**

- **Building** generally happens from *this* repo (`pnpm build` / `pnpm package` here pulls in core's built `dist/` via the `file:` dep). Building from the core repo by itself is rarely needed unless explicitly requested.
- **Tests** often need to be run from *the core repo* while iterating on a cross-repo feature, since the matching test suite for changed core code lives there. `cd ../agentic-bookmarks-core && pnpm test <path>` (or `-t <name>`) is the normal pattern. After core changes, rebuild core (`pnpm build` in that repo) before rebuilding here if you want the extension/server to pick them up.

The root `tsconfig.json` has a stale `references` entry pointing at `./packages/core` — there is no such directory in this repo. Ignore it (or fix it if you're already touching tsconfigs).

## Where the docs live

**All product, spec, and API documentation for both repos lives in the core repo under `docs/`** — not in this one. When writing or updating docs that span the product, put them there. Starting points (relative to this repo's root):

- `../agentic-bookmarks-core/docs/product/product-brief.md` — canonical record of what the product *is*; the right anchor for product-level decisions and understanding existing features in context.
- `../agentic-bookmarks-core/docs/product-overview.md` — cross-package picture (core + extension + server).
- `../agentic-bookmarks-core/docs/docs-index.md` — catalog of all docs with last-build metadata.
- `../agentic-bookmarks-core/docs/core/quickstart.md` — entry point for the per-subsystem API docs under `docs/core/`.
- `../agentic-bookmarks-core/docs/specs/` — authoritative design specs; the load-bearing ones are `durable-anchors.md` (anchor system), `multi-workspace.md` (storage/registry), `agentrepair.md` and `autorepair.md` (repair flows), and `mcp-server.md` (the surface this repo's `packages/server` implements).

Per-ticket plans / design docs for extension-side work live in the sibling core repo under `docs/extension/plans/` (named `SML-####.md` or dated). The public extension repo no longer carries a `docs/plans/` directory.

## Package layout and the build pipeline

```
packages/
  licensing/   built first by pnpm -r (no deps on the others)
  server/      bundled by tsup to dist/index.cjs — depends on core (sibling) + licensing
  extension/   tsup-bundled VS Code extension; its build script ALSO copies
               ../server/dist/index.cjs → server-bundle/index.js, which is the
               file shipped inside the .vsix and used at runtime.
```

The extension's `package.json` "copy-server" step is the load-bearing connection: **the extension does not import the server as a module — it spawns the bundled file**. After changes to server code you must rebuild the server before rebuilding the extension; `pnpm -r build` handles that ordering, but watch mode in only one package will not.

`pnpm package` runs `pnpm build` then `vsce package --no-dependencies -o ../../dist/agentic-bookmarks.vsix`. The `--no-dependencies` flag is intentional — the extension bundle already has everything inlined.

## Common commands

```bash
# Build / typecheck / lint / test the whole workspace
pnpm build
pnpm build:watch          # parallel watchers across all packages
pnpm typecheck            # tsc --noEmit, all packages, --no-bail
pnpm lint                 # eslint . (flat config)
pnpm test                 # vitest run (single pass, all packages)

# Package and (re)install the extension into VS Code / Cursor
pnpm package              # build + vsce package → dist/agentic-bookmarks.vsix
pnpm package:install      # package + `code --install-extension … --force`
pnpm package:update       # install the already-built VSIX without rebuilding
pnpm cursor:install       # same, but for Cursor
pnpm iterate              # increment:patch + package + package:update (full dev loop)

# Version bumps (touches every package.json + lockfile)
pnpm increment:patch      # also: increment:minor, increment:major
                          # see scripts/bump-version.mjs

# MCP server smoke tests (spawn the bundled server, exercise tools over stdio)
pnpm smoke                # build + scripts/smoke-mcp-server.mjs
pnpm smoke:nobuild        # same without rebuilding
pnpm smoke:all            # all four detailed smoke harnesses in packages/server/scripts/
```

### Running a single test

Vitest picks up `*.test.ts` next to source. From the repo root:

```bash
pnpm test packages/extension/src/anchorState.test.ts        # one file
pnpm test -t "smart anchor"                                 # by test name
npx vitest packages/server/src/                             # by path prefix, watch mode
```

Many tests in `packages/server/src/` (especially `anchor-git-tools.test.ts` and `trace-line-history.test.ts`) **shell out to `git`** against temp repos — `git` must be on PATH.

## MCP iteration loop

After modifying server code, the bundled file inside the **installed** extension is stale until you reinstall the VSIX. For Claude Code specifically, the MCP client also caches a version — the README's recipe is:

```bash
claude mcp remove mcp_bookmarks                # or --scope user
# then re-run "MCP Bookmarks: Setup for Claude Code" from VS Code's palette
```

This is the documented workflow; don't try to hot-reload the server from outside the host.

## Workspace data layout

The extension stores data under `.bookmarks/` at the workspace root:

- `.bookmarks/shared/` — bookmark data files; **committed to git** (this is the "shareable" part).
- `.bookmarks/local/` — registry, default local bookmarks file, lock/pulse cache, generated icons, logs. **Gitignored.**

Pre-0.5 layouts (`.vscode/bookmarks.registry.json`, `.bookmarks/.cache/`, etc.) auto-migrate idempotently on activation; see `packages/extension/src/migrate-local-layout.ts`.

The `bookmarks.dataRoot` setting (default `.bookmarks`) lets users move the data root. When running the MCP server standalone outside VS Code, point it at the local dir via `BOOKMARKS_DIR=…/.bookmarks/local` — the server's stdio-discovery walks upward looking for `bookmarks.registry.json` and falls back to `BOOKMARKS_DIR` or `cwd`.

## Lint conventions

ESLint v9 flat config (`eslint.config.js`) only lints `packages/*/src/**/*.ts`. Style: 2-space indent, single quotes, semicolons. Several rules are intentionally relaxed (`no-explicit-any` off, `no-var-requires` off, indent/semi as `warn`) so a fresh checkout's `pnpm lint` exits 0; tightening is follow-up work, not something to fix incidentally.

## Things to know before changing code

- **Node ≥ 20** and **pnpm** are required (`packageManager` not pinned but `pnpm-lock.yaml` is authoritative; `.npmrc` configures the registry).
- **0-based line/column indices everywhere** in code and storage. User-facing strings and Markdown export are 1-based — don't conflate them.
- The MCP server is invoked over **stdio**; all logging in `packages/server/` goes to `console.error` (stdout is the JSON-RPC channel). Keep it that way.
- The extension's MCP server registration uses `vscode.lm.registerMcpServerDefinitionProvider` — see the `mcpServerDefinitionProviders` contribution in `packages/extension/package.json` and the corresponding code in `packages/extension/src/extension.ts`.
- License-gated ("Pro") features are currently free during public beta (`licensing.testTier` default `'auto'` resolves to free). The `agenticBookmarks.testLicense.*` commands and `agenticBookmarks.licensing.*` settings are dev-only and gated by `agenticBookmarks.isDevelopment`.
- Design docs and per-ticket plans for extension-side work live in the sibling core repo under `docs/extension/plans/` (named `SML-####.md` or dated). Cross-package / product-level docs live in the same sibling core repo under `docs/`, per its conventions.
