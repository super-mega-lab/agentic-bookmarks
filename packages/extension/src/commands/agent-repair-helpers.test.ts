// ABOUTME: Tests for agent-repair selection logic and command-string construction.
import { describe, it, expect } from 'vitest';
import {
  REPAIR_PROMPT,
  buildRepairPrompt,
  pickAgentToLaunch,
  buildAgentLaunch,
} from './agent-repair-helpers';

describe('pickAgentToLaunch', () => {
  it('asks to connect when no agents are connected', () => {
    expect(pickAgentToLaunch({ connected: [], preferred: undefined }))
      .toEqual({ action: 'connect' });
  });
  it('launches the only connected agent', () => {
    expect(pickAgentToLaunch({ connected: ['claude'], preferred: undefined }))
      .toEqual({ action: 'launch', agent: 'claude' });
  });
  it('uses the saved preference when set and still connected', () => {
    expect(pickAgentToLaunch({ connected: ['claude', 'codex'], preferred: 'codex' }))
      .toEqual({ action: 'launch', agent: 'codex' });
  });
  it('asks the user to choose when 2+ connected and no valid preference', () => {
    expect(pickAgentToLaunch({ connected: ['claude', 'codex'], preferred: undefined }))
      .toEqual({ action: 'choose', agents: ['claude', 'codex'] });
  });
  it('ignores a preference that is no longer connected', () => {
    expect(pickAgentToLaunch({ connected: ['claude', 'codex'], preferred: 'cursor' }))
      .toEqual({ action: 'choose', agents: ['claude', 'codex'] });
  });
});

describe('buildRepairPrompt', () => {
  it('returns the historical repair-all prompt verbatim for the "all" target', () => {
    expect(buildRepairPrompt({ kind: 'all' })).toBe(REPAIR_PROMPT);
  });
  it('names a single bookmark id', () => {
    expect(buildRepairPrompt({ kind: 'ids', ids: ['bm-1'] })).toBe(
      'Please use the agentic-bookmarks MCP to repair the following broken bookmarks: bm-1. ' +
        'Start by reading the repair skill guide from anchor_getRepairSkillGuide.',
    );
  });
  it('joins multiple bookmark ids with commas', () => {
    expect(buildRepairPrompt({ kind: 'ids', ids: ['bm-1', 'bm-2', 'bm-3'] })).toBe(
      'Please use the agentic-bookmarks MCP to repair the following broken bookmarks: bm-1, bm-2, bm-3. ' +
        'Start by reading the repair skill guide from anchor_getRepairSkillGuide.',
    );
  });
});

describe('buildAgentLaunch', () => {
  it('builds a terminal command for claude with the given prompt', () => {
    expect(buildAgentLaunch('claude', REPAIR_PROMPT)).toEqual({
      method: 'terminal',
      command: `claude "${REPAIR_PROMPT}"`,
    });
  });
  it('builds a terminal command for codex with the given prompt', () => {
    expect(buildAgentLaunch('codex', REPAIR_PROMPT)).toEqual({
      method: 'terminal',
      command: `codex "${REPAIR_PROMPT}"`,
    });
  });
  it('falls back to clipboard for cursor with the given prompt', () => {
    expect(buildAgentLaunch('cursor', REPAIR_PROMPT)).toEqual({
      method: 'clipboard',
      text: REPAIR_PROMPT,
    });
  });
  it('embeds a targeted prompt for claude', () => {
    const prompt = buildRepairPrompt({ kind: 'ids', ids: ['bm-1'] });
    expect(buildAgentLaunch('claude', prompt)).toEqual({
      method: 'terminal',
      command: `claude "${prompt}"`,
    });
  });
});
