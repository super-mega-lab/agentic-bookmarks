// ABOUTME: Pure helper mapping the bookmarks.overviewRulerLane string setting
// ABOUTME: to vscode.OverviewRulerLane integer values. vscode-API-free by design.

// VS Code's OverviewRulerLane values (verified against
// node_modules/@types/vscode/index.d.ts):
//   Left = 1, Center = 2, Right = 4, Full = 7.
// `mapOverviewRulerLane` returns the integer constant so the helper stays
// vscode-free and unit-testable. The caller casts to vscode.OverviewRulerLane.
const RULER_LANE_LEFT = 1;
const RULER_LANE_CENTER = 2;
const RULER_LANE_RIGHT = 4;
const RULER_LANE_FULL = 7;

export type OverviewRulerLaneSetting = 'left' | 'center' | 'right' | 'full';

export const DEFAULT_OVERVIEW_RULER_LANE: OverviewRulerLaneSetting = 'center';

export function mapOverviewRulerLane(value: unknown): number {
  switch (value) {
    case 'left':
      return RULER_LANE_LEFT;
    case 'right':
      return RULER_LANE_RIGHT;
    case 'full':
      return RULER_LANE_FULL;
    case 'center':
      return RULER_LANE_CENTER;
    default:
      return RULER_LANE_CENTER;
  }
}
