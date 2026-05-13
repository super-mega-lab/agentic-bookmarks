/**
 * Pro features. Strings are stable identifiers — do NOT remove `test-pro`,
 * it is a fixture used by the dev test commands and unit tests.
 *
 * Reclassifying a real feature as free: move the string from PRO_FEATURES
 * to FREE_FEATURES. Call sites stay valid because the FeatureName union
 * spans both registries.
 */
export const PRO_FEATURES = [
  'smart-anchors',
  'tag-anchors',
  'range-bookmarks',
  'auto-repair',
  'anchor-forensics',
  'in-editor-notes',
  'journeys',
  'power-view',
  'report-export',
  'extended-icons',
  'custom-icons',
  'icon-builder',
  'mcp-repair',
  'mcp-forensics',
  'test-pro',
] as const;

/**
 * Free features. `test-free` is a fixture — do NOT remove.
 */
export const FREE_FEATURES = [
  'test-free',
] as const;

export type ProFeature = typeof PRO_FEATURES[number];
export type FreeFeature = typeof FREE_FEATURES[number];
export type FeatureName = ProFeature | FreeFeature;

const PRO_SET = new Set<FeatureName>(PRO_FEATURES);

export function isProFeature(name: FeatureName): boolean {
  return PRO_SET.has(name);
}
