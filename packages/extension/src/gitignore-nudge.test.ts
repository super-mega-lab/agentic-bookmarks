// ABOUTME: Tests for `gitignore-nudge.ts` covering dismiss/show-once/handler-action logic
// ABOUTME: with an injectable Memento and faked detection/append/message helpers.

import { describe, it, expect } from 'vitest';
import {
  GITIGNORE_NUDGE_SHOWN_KEY,
  type MaybeShowGitignoreNudgeDeps,
  type WorkspaceStateLike,
  maybeShowGitignoreNudge,
} from './gitignore-nudge';

function makeState(initial?: Record<string, unknown>): WorkspaceStateLike & { snapshot(): Record<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(initial ?? {}));
  return {
    get<T>(key: string): T | undefined {
      return data.get(key) as T | undefined;
    },
    update(key: string, value: unknown): Promise<void> {
      data.set(key, value);
      return Promise.resolve();
    },
    snapshot() {
      return Object.fromEntries(data.entries());
    },
  };
}

const noopLog = { error: () => undefined, info: () => undefined };

interface RecorderOpts {
  trackedFiles?: string[];
  click?: string;
  appendStatus?: 'created' | 'appended' | 'already-present';
  appendError?: Error;
}

function makeDeps(state: WorkspaceStateLike, opts: RecorderOpts) {
  const calls = {
    listTracked: 0,
    append: 0,
    info: 0,
    warn: 0,
    infoArgs: null as { msg: string; buttons: string[] } | null,
    warnArgs: null as string | null,
  };
  const deps: MaybeShowGitignoreNudgeDeps = {
    workspaceRoot: '/fake/workspace',
    workspaceState: state,
    log: noopLog,
    listTrackedLocalFiles: async () => {
      calls.listTracked++;
      return opts.trackedFiles ?? [];
    },
    appendGitignoreLine: async () => {
      calls.append++;
      if (opts.appendError) throw opts.appendError;
      return opts.appendStatus ?? 'created';
    },
    showInformationMessage: (msg, ...buttons) => {
      calls.info++;
      calls.infoArgs = { msg, buttons };
      return Promise.resolve(opts.click);
    },
    showWarningMessage: (msg) => {
      calls.warn++;
      calls.warnArgs = msg;
      return Promise.resolve(undefined);
    },
  };
  return { deps, calls };
}

describe('GITIGNORE_NUDGE_SHOWN_KEY', () => {
  it('uses a versioned, namespaced key', () => {
    expect(GITIGNORE_NUDGE_SHOWN_KEY).toBe('agenticBookmarks.gitignoreNudgeShownV1');
  });
});

describe('maybeShowGitignoreNudge', () => {
  it('is a no-op when the workspace has already been nudged (does not even spawn git)', async () => {
    const state = makeState({ [GITIGNORE_NUDGE_SHOWN_KEY]: true });
    const { deps, calls } = makeDeps(state, { trackedFiles: ['.bookmarks/local/x'] });

    await maybeShowGitignoreNudge(deps);

    expect(calls.listTracked).toBe(0);
    expect(calls.info).toBe(0);
    expect(calls.append).toBe(0);
    expect(state.snapshot()[GITIGNORE_NUDGE_SHOWN_KEY]).toBe(true);
  });

  it('does NOT mark the workspace as shown when no tracked files are found', async () => {
    const state = makeState();
    const { deps, calls } = makeDeps(state, { trackedFiles: [] });

    await maybeShowGitignoreNudge(deps);

    expect(calls.listTracked).toBe(1);
    expect(calls.info).toBe(0);
    expect(calls.append).toBe(0);
    // Critical: leaves the flag unset so a future activation can still nudge.
    expect(state.snapshot()[GITIGNORE_NUDGE_SHOWN_KEY]).toBeUndefined();
  });

  it('marks the workspace as shown synchronously when the nudge is displayed', async () => {
    const state = makeState();
    const { deps } = makeDeps(state, { trackedFiles: ['.bookmarks/local/registry.json'] });

    await maybeShowGitignoreNudge(deps);

    expect(state.snapshot()[GITIGNORE_NUDGE_SHOWN_KEY]).toBe(true);
  });

  it("on 'Add to .gitignore' click, calls appendGitignoreLine", async () => {
    const state = makeState();
    const { deps, calls } = makeDeps(state, {
      trackedFiles: ['.bookmarks/local/registry.json'],
      click: 'Add to .gitignore',
      appendStatus: 'created',
    });

    await maybeShowGitignoreNudge(deps);

    expect(calls.info).toBe(1);
    expect(calls.append).toBe(1);
    expect(state.snapshot()[GITIGNORE_NUDGE_SHOWN_KEY]).toBe(true);
  });

  it("on 'Don't show again' click, marks shown but does NOT append", async () => {
    const state = makeState();
    const { deps, calls } = makeDeps(state, {
      trackedFiles: ['.bookmarks/local/registry.json'],
      click: "Don't show again",
    });

    await maybeShowGitignoreNudge(deps);

    expect(calls.info).toBe(1);
    expect(calls.append).toBe(0);
    expect(state.snapshot()[GITIGNORE_NUDGE_SHOWN_KEY]).toBe(true);
  });

  it('on dismiss (X / Esc, click=undefined), marks shown but does NOT append', async () => {
    const state = makeState();
    const { deps, calls } = makeDeps(state, {
      trackedFiles: ['.bookmarks/local/registry.json'],
      click: undefined,
    });

    await maybeShowGitignoreNudge(deps);

    expect(calls.info).toBe(1);
    expect(calls.append).toBe(0);
    expect(state.snapshot()[GITIGNORE_NUDGE_SHOWN_KEY]).toBe(true);
  });

  it('after a previous nudge has been shown, subsequent calls are no-ops regardless of state changes', async () => {
    const state = makeState();
    const firstRun = makeDeps(state, {
      trackedFiles: ['.bookmarks/local/registry.json'],
      click: "Don't show again",
    });
    await maybeShowGitignoreNudge(firstRun.deps);

    // Now even if the workspace gets MORE tracked files, the nudge should not fire again.
    const secondRun = makeDeps(state, {
      trackedFiles: ['.bookmarks/local/a.json', '.bookmarks/local/b.json'],
    });
    await maybeShowGitignoreNudge(secondRun.deps);

    expect(secondRun.calls.listTracked).toBe(0);
    expect(secondRun.calls.info).toBe(0);
  });

  it('shows a warning toast when appendGitignoreLine throws, but still marks shown', async () => {
    const state = makeState();
    const { deps, calls } = makeDeps(state, {
      trackedFiles: ['.bookmarks/local/registry.json'],
      click: 'Add to .gitignore',
      appendError: new Error('EACCES: permission denied'),
    });

    await maybeShowGitignoreNudge(deps);

    expect(calls.append).toBe(1);
    expect(calls.warn).toBe(1);
    expect(calls.warnArgs).toContain('EACCES');
    expect(state.snapshot()[GITIGNORE_NUDGE_SHOWN_KEY]).toBe(true);
  });

  it("includes the canonical line '.bookmarks/local/' in the message", async () => {
    const state = makeState();
    const { deps, calls } = makeDeps(state, {
      trackedFiles: ['.bookmarks/local/registry.json'],
    });

    await maybeShowGitignoreNudge(deps);

    expect(calls.infoArgs?.msg).toContain('.bookmarks/local/');
    expect(calls.infoArgs?.buttons).toEqual(['Add to .gitignore', "Don't show again"]);
  });

  it('never throws when listTrackedLocalFiles itself rejects (defense in depth)', async () => {
    const state = makeState();
    const deps: MaybeShowGitignoreNudgeDeps = {
      workspaceRoot: '/fake/workspace',
      workspaceState: state,
      log: noopLog,
      listTrackedLocalFiles: async () => {
        throw new Error('unexpected boom');
      },
      appendGitignoreLine: async () => 'created',
      showInformationMessage: () => Promise.resolve(undefined),
      showWarningMessage: () => Promise.resolve(undefined),
    };

    await expect(maybeShowGitignoreNudge(deps)).resolves.toBeUndefined();
    // We did not get to show the nudge, so the flag remains unset.
    expect(state.snapshot()[GITIGNORE_NUDGE_SHOWN_KEY]).toBeUndefined();
  });
});
