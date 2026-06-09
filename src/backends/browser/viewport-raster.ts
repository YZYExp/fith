/**
 * Non-scrolling rasterizer for screenshot-backed backends (the Chrome
 * extension). It resolves a raster region WITHOUT ever scrolling the page —
 * scrolling is risky (it triggers sticky/fixed repositioning, lazy-load, and
 * scroll-driven animations and is slow under the captureVisibleTab rate limit),
 * and these captures target relatively static pages.
 *
 * Two strategies, in order:
 *   1. shootRegion(rect) — an exact single-shot capture of the region in document
 *      coordinates (e.g. chrome.debugger Page.captureScreenshot with
 *      captureBeyondViewport). When available, this captures content anywhere on
 *      the page, including below the fold, with no scrolling.
 *   2. viewport crop — crop the region out of ONE current-viewport screenshot.
 *      Only the part of the region overlapping the visible viewport is captured;
 *      anything off-screen is left transparent (and a fully off-screen region
 *      yields null). This is the zero-permission fallback.
 *
 * `getOrigin()` reports the document coordinates of the viewport's top-left:
 *   • viewport-only capture keeps coords viewport-relative → origin {0,0};
 *   • full-page capture uses document-absolute coords → origin = current scroll.
 *
 * Environment specifics (screenshot, canvas) are injected, and the viewport
 * screenshot is taken once and reused, so the shared code is exercised by both
 * the extension and the test.
 */
import type { Viewport, TileShot, TileCanvas, Rect } from './raster-types.js';

export interface ViewportRasterEnv<S extends TileShot> {
  getViewport(): Viewport | Promise<Viewport>;
  /** Document-coords of the viewport's top-left. Default {x:0,y:0}. */
  getOrigin?(): { x: number; y: number } | Promise<{ x: number; y: number }>;
  /**
   * Optional exact-region capture (document coords) in a single shot, tried
   * before the viewport crop. Returns a ready data URL, or null if unavailable
   * (e.g. the debugger permission wasn't granted) so we fall back to the crop.
   */
  shootRegion?(rect: Rect): Promise<string | null>;
  /** Screenshot the current viewport; null if unavailable. */
  shoot(): Promise<S | null>;
  /** Allocate the output canvas at the given device-px size (null on failure). */
  createCanvas(width: number, height: number): TileCanvas<S> | null;
}

export function createViewportRasterizer<S extends TileShot>(
  env: ViewportRasterEnv<S>,
): (rect: Rect) => Promise<string | null> {
  let shot: Promise<S | null> | null = null;
  const getShot = () => (shot ??= Promise.resolve(env.shoot()));

  return async (rect: Rect): Promise<string | null> => {
    // 1. Exact single-shot region capture (no scroll, reaches below the fold).
    if (env.shootRegion) {
      const direct = await env.shootRegion(rect);
      if (direct) return direct;
    }

    // 2. Crop the region out of a single current-viewport screenshot.
    const s = await getShot();
    if (!s) return null;
    const vp = await env.getViewport();
    const origin = env.getOrigin ? await env.getOrigin() : { x: 0, y: 0 };
    // Region in viewport-local coords.
    const rx = rect.x - origin.x;
    const ry = rect.y - origin.y;
    // Intersect with the visible viewport.
    const x0 = Math.max(0, rx);
    const y0 = Math.max(0, ry);
    const x1 = Math.min(vp.width, rx + rect.width);
    const y1 = Math.min(vp.height, ry + rect.height);
    if (x1 - x0 <= 0 || y1 - y0 <= 0) return null; // off-screen → nothing visible

    const scale = s.scale;
    const canvas = env.createCanvas(
      Math.max(1, Math.round(rect.width * scale)),
      Math.max(1, Math.round(rect.height * scale)),
    );
    if (!canvas) return null;
    // Paint the visible slice at its offset within the (full-size) target rect,
    // leaving any off-screen part transparent.
    canvas.draw(
      s,
      x0 * scale, y0 * scale, (x1 - x0) * scale, (y1 - y0) * scale,
      (x0 - rx) * scale, (y0 - ry) * scale, (x1 - x0) * scale, (y1 - y0) * scale,
    );
    return canvas.toDataURL();
  };
}
