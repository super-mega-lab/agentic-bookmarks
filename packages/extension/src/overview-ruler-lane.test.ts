// ABOUTME: Tests for the overview-ruler-lane pure helper. No vscode mocks;
// ABOUTME: helper is vscode-API-free by design.

import { describe, it, expect } from 'vitest';
import {
  mapOverviewRulerLane,
  DEFAULT_OVERVIEW_RULER_LANE,
} from './overview-ruler-lane';

// ---------------------------------------------------------------------------
// mapOverviewRulerLane
// ---------------------------------------------------------------------------

describe('mapOverviewRulerLane', () => {
  // VS Code OverviewRulerLane: Left = 1, Center = 2, Right = 4, Full = 7 —
  // verified against node_modules/@types/vscode/index.d.ts.
  it('maps "left" to Left (1)', () => {
    expect(mapOverviewRulerLane('left')).toBe(1);
  });
  it('maps "center" to Center (2)', () => {
    expect(mapOverviewRulerLane('center')).toBe(2);
  });
  it('maps "right" to Right (4)', () => {
    expect(mapOverviewRulerLane('right')).toBe(4);
  });
  it('maps "full" to Full (7)', () => {
    expect(mapOverviewRulerLane('full')).toBe(7);
  });
  it('maps unknown string ("bogus") to Center (2) default', () => {
    expect(mapOverviewRulerLane('bogus')).toBe(2);
  });
  it('maps undefined to Center (2) default', () => {
    expect(mapOverviewRulerLane(undefined)).toBe(2);
  });
  it('maps null to Center (2) default', () => {
    expect(mapOverviewRulerLane(null)).toBe(2);
  });
  it('maps empty string to Center (2) default', () => {
    expect(mapOverviewRulerLane('')).toBe(2);
  });
  it('maps a number (42) to Center (2) default', () => {
    expect(mapOverviewRulerLane(42)).toBe(2);
  });
  it('maps an object ({}) to Center (2) default', () => {
    expect(mapOverviewRulerLane({})).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_OVERVIEW_RULER_LANE
// ---------------------------------------------------------------------------

describe('DEFAULT_OVERVIEW_RULER_LANE', () => {
  it('is "center"', () => {
    expect(DEFAULT_OVERVIEW_RULER_LANE).toBe('center');
  });
});
