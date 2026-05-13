// ABOUTME: Tests for the pure visibility helpers in filesGroupsProvider —
// ABOUTME: computeFileChildrenVisibility and computeGroupVisualHidden.

import { describe, it, expect } from 'vitest';
import {
  computeFileChildrenVisibility,
  computeGroupVisualHidden,
} from './filesGroupsProvider-helpers';

// ---------------------------------------------------------------------------
// computeFileChildrenVisibility
// ---------------------------------------------------------------------------

describe('computeFileChildrenVisibility', () => {
  it('returns renderChildren=false when fileEnabled=false (regardless of UI-hidden)', () => {
    // Registry-disabled wins — file row is rendered but children short-circuit.
    expect(
      computeFileChildrenVisibility({ fileEnabled: false, fileUiHidden: false })
    ).toEqual({ renderChildren: false, childrenForcedHidden: false });
  });

  it('returns renderChildren=false when fileEnabled=false even if also UI-hidden', () => {
    // Out-of-scope path preserved — both flags true, registry-disable dominates.
    expect(
      computeFileChildrenVisibility({ fileEnabled: false, fileUiHidden: true })
    ).toEqual({ renderChildren: false, childrenForcedHidden: false });
  });

  it('renders children but marks them hidden when only UI-hidden (AC1, AC2a)', () => {
    expect(
      computeFileChildrenVisibility({ fileEnabled: true, fileUiHidden: true })
    ).toEqual({ renderChildren: true, childrenForcedHidden: true });
  });

  it('renders children normally when neither flag is set', () => {
    expect(
      computeFileChildrenVisibility({ fileEnabled: true, fileUiHidden: false })
    ).toEqual({ renderChildren: true, childrenForcedHidden: false });
  });
});

// ---------------------------------------------------------------------------
// computeGroupVisualHidden
// ---------------------------------------------------------------------------

describe('computeGroupVisualHidden', () => {
  // AC2b: file-forced hidden short-circuits everything else.
  it('returns true when childrenForcedHidden, regardless of focus/hidden', () => {
    expect(
      computeGroupVisualHidden({
        groupId: 'gA',
        childrenForcedHidden: true,
        uiFocus: 'gB',
        uiHidden: [],
      })
    ).toBe(true);
  });

  it('returns true when childrenForcedHidden even if the group is the focused one', () => {
    // File-forced wins over focus.
    expect(
      computeGroupVisualHidden({
        groupId: 'gA',
        childrenForcedHidden: true,
        uiFocus: 'gA',
        uiHidden: [],
      })
    ).toBe(true);
  });

  it('returns true when childrenForcedHidden and group already in hidden list', () => {
    expect(
      computeGroupVisualHidden({
        groupId: 'gA',
        childrenForcedHidden: true,
        uiFocus: null,
        uiHidden: ['gA'],
      })
    ).toBe(true);
  });

  // Focus-wins-over-hidden precedence (SML-1380, PR #28) — preserved exactly.
  it('returns true when focus is set and groupId is not the focused group', () => {
    expect(
      computeGroupVisualHidden({
        groupId: 'gB',
        childrenForcedHidden: false,
        uiFocus: 'gA',
        uiHidden: [],
      })
    ).toBe(true);
  });

  it('returns false when focus is set and groupId is the focused group (even if in hidden)', () => {
    // Focus wins over hidden list per the canonical predicate.
    expect(
      computeGroupVisualHidden({
        groupId: 'gA',
        childrenForcedHidden: false,
        uiFocus: 'gA',
        uiHidden: ['gA'],
      })
    ).toBe(false);
  });

  it('returns true when no focus and groupId is in the hidden list', () => {
    expect(
      computeGroupVisualHidden({
        groupId: 'gA',
        childrenForcedHidden: false,
        uiFocus: null,
        uiHidden: ['gA'],
      })
    ).toBe(true);
  });

  it('returns false when no focus, hidden list empty, and not file-forced', () => {
    expect(
      computeGroupVisualHidden({
        groupId: 'gA',
        childrenForcedHidden: false,
        uiFocus: null,
        uiHidden: [],
      })
    ).toBe(false);
  });
});
