/**
 * Central registry of default values for user-facing settings.
 *
 * Read sites should use `withDefault(stored, SETTINGS_DEFAULTS.<group>.<key>)`
 * instead of inlining `!== false` / `=== true` / `??` idioms, so the
 * defaults live in one discoverable place.
 *
 * Currently only view prefs are wired up; other groups (general,
 * appearance, anchors, watchers, …) can adopt the same pattern as they
 * are touched.
 */

export function withDefault<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

export const SETTINGS_DEFAULTS = {
  viewPrefs: {
    showFilesInAllBookmarks: false,
    showBookmarksInFilesAndGroups: true,
  },
  // general: { ... }      // add when general settings adopt the helper
  // appearance: { ... }   // add when appearance toggles adopt the helper
} as const;
