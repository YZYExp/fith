/**
 * Single-shot viewport rasterizer. Counterpart to createTiledRasterizer for the
 * "visible area only" capture mode: it takes ONE viewport screenshot and crops
 * each requested region — whose coordinates are already viewport-relative — out
 * of it, with no scrolling. Regions are clamped to the viewport; a region wholly
 * off-screen yields null so its raster node paints nothing.
 *
 * This avoids the scroll-and-stitch path (createTiledRasterizer), which on long
 * pages is slow (rate-limited screenshots) and drags sticky/fixed headers and
 * lazy-loaded content into the wrong place. Environment specifics (screenshot,
 * canvas) are injected, and the screenshot is taken once and reused across all
 * regions, so the shared code is exercised by both the extension and the test.
 */
import type { Viewport } from './tiles.js';
import type { TileShot, TileCanvas } from './tiled-raster.js';
import type { Rect } from '../../core/ir/types.js';

export interface ViewportRasterEnv<S extends TileShot> {
  getViewport(): Viewport | Promise<Viewport>;
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
    const s = await getShot();
    if (!s) return null;
    const vp = await env.getViewport();
    // Intersect the region with the visible viewport.
    const x0 = Math.max(0, rect.x);
    const y0 = Math.max(0, rect.y);
    const x1 = Math.min(vp.width, rect.x + rect.width);
    const y1 = Math.min(vp.height, rect.y + rect.height);
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
      (x0 - rect.x) * scale, (y0 - rect.y) * scale, (x1 - x0) * scale, (y1 - y0) * scale,
    );
    return canvas.toDataURL();
  };
}
