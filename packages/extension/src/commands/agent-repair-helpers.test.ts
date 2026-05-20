// ABOUTME: Tests for agent-repair selection logic and command-string construction.
import { describe, it, expect } from 'vitest';
import {
  REPAIR_PROMPT,
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

describe('buildAgentLaunch', () => {
  it('builds a terminal command for claude', () => {
    expect(buildAgentLaunch('claude')).toEqual({
      method: 'terminal',
      command: `claude "${REPAIR_PROMPT}"`,
    });
  });
  it('builds a terminal command for codex', () => {
    expect(buildAgentLaunch('codex')).toEqual({
      method: 'terminal',
      command: `codex "${REPAIR_PROMPT}"`,
    });
  });
  it('falls back to clipboard for cursor', () => {
    expect(buildAgentLaunch('cursor')).toEqual({
      method: 'clipboard',
      text: REPAIR_PROMPT,
    });
  });
});
