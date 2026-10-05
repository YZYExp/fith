/**
 * Shared message contracts and constants for the extension's three contexts
 * (popup, content script, service worker). Bundled (inlined) into each entry
 * by esbuild, so this adds no runtime coupling — just one source of truth.
 */

export type OutputMode = 'both' | 'download' | 'preview';
export type FontMode = 'embed' | 'outline' | 'none';
export type Scope = 'viewport' | 'full';

/** chrome.storage.local keys for the popup preferences. */
export const PREF_KEYS = ['fhOutput', 'fhFont', 'fhScope', 'fhSource'] as const;

export const DEFAULT_PREFS = {
  fhOutput: 'both' as OutputMode,
  fhFont: 'embed' as FontMode,
  fhScope: 'viewport' as Scope,
  /** Also save the page's source HTML (opt-in: it contains page content). */
  fhSource: false,
};

/**
 * captureBeyondViewport renders the whole clip at `scale` device px; cap the
 * device-pixel area so an enormous below-the-fold region can't OOM/stall Chrome
 * (callers then fall back to a viewport crop, or omit the raster node).
 * ~ 4000 × 10000 device px.
 */
export const MAX_REGION_DEVICE_PX = 40_000_000;
