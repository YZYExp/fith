import type { Rect } from './ir/types.js';

/**
 * Environment capability contract. The core capture/emit pipeline depends only
 * on this; each environment (Node Playwright, browser extension, in-page library)
 * provides its own implementation.
 */
export interface CaptureBackend {
  /** Run a self-contained function in the target page context and return its result. */
  run<A, R>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  /** Optional: rasterize a document-space rect to a data URI. Absent → no raster fallback. */
  rasterize?(rect: Rect, scale: number): Promise<string | null>;
}
