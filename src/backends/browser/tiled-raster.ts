/**
 * Viewport-tiled region rasterizer (the runtime that executes a planRegionTiles
 * plan). The bug-prone parts — scroll sequencing, per-scroll screenshot dedup,
 * scale handling, and src→dst crop coordinates — live here and are shared by:
 *   • the extension content script (real env: window scroll + OffscreenCanvas +
 *     a service-worker screenshot), and
 *   • the Playwright integration test (env backed by page.evaluate + pngjs),
 * so the test exercises the *actual* code rather than a reimplementation.
 *
 * All environment specifics (scrolling, screenshotting, canvas/bitmap ops) are
 * injected. Scroll accessors may be sync or async, so the same code drives both
 * the synchronous DOM and Playwright's async page API.
 */
import { planRegionTiles, type Viewport } from './tiles.js';
import type { Rect } from '../../core/ir/types.js';

/** A captured viewport screenshot. Environments extend this with their own
 *  bitmap payload (ImageBitmap, PNG, …); only `scale` is needed by the core. */
export interface TileShot {
  /** Device px per CSS px in the screenshot (devicePixelRatio + browser zoom). */
  scale: number;
}

/** Per-environment output sink: accumulate device-px tiles, then encode. */
export interface TileCanvas<S extends TileShot> {
  /** Paint a crop of `shot` (src, device px) into the output (dst, device px). */
  draw(shot: S, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  /** Encode the accumulated output as a data URL (null on failure). */
  toDataURL(): Promise<string | null>;
}

export interface TiledRasterEnv<S extends TileShot> {
  getViewport(): Viewport | Promise<Viewport>;
  getMaxScroll(): { x: number; y: number } | Promise<{ x: number; y: number }>;
  getScroll(): { x: number; y: number } | Promise<{ x: number; y: number }>;
  scrollTo(x: number, y: number): void | Promise<void>;
  /** Resolve once layout + paint have settled after a scroll. */
  settle(): void | Promise<void>;
  /** Screenshot the current viewport; null if unavailable. */
  shoot(): Promise<S | null>;
  /** Allocate the output canvas at the given device-px size (null on failure). */
  createCanvas(width: number, height: number): TileCanvas<S> | null;
}

/**
 * Build a rasterizer that captures a document-coordinate region correctly even
 * when it's off-screen or larger than the viewport, by scrolling it through the
 * viewport tile-by-tile and compositing the slices. Screenshots are deduplicated
 * by scroll position (adjacent regions sharing a viewport reuse one shot, which
 * also eases the screenshot rate limit). The original scroll position is restored
 * afterward. A fresh dedup cache lives for the lifetime of the returned function.
 */
export function createTiledRasterizer<S extends TileShot>(
  env: TiledRasterEnv<S>,
): (rect: Rect) => Promise<string | null> {
  const shotCache = new Map<string, Promise<S | null>>();
  const shotAt = (x: number, y: number): Promise<S | null> => {
    const key = Math.round(x) + ',' + Math.round(y);
    let p = shotCache.get(key);
    if (!p) {
      p = env.shoot();
      shotCache.set(key, p);
    }
    return p;
  };

  return async (rect: Rect): Promise<string | null> => {
    const save = await env.getScroll();
    try {
      const vp = await env.getViewport();
      const maxScroll = await env.getMaxScroll();
      const tiles = planRegionTiles(rect, vp, maxScroll);
      if (tiles.length === 0) return null;

      let canvas: TileCanvas<S> | null = null;
      let scale = 0;
      for (const t of tiles) {
        await env.scrollTo(t.scrollX, t.scrollY);
        await env.settle();
        const cur = await env.getScroll();
        const shot = await shotAt(cur.x, cur.y);
        if (!shot) continue;
        if (!canvas) {
          scale = shot.scale;
          canvas = env.createCanvas(
            Math.max(1, Math.round(rect.width * scale)),
            Math.max(1, Math.round(rect.height * scale)),
          );
          if (!canvas) return null;
        }
        canvas.draw(
          shot,
          t.srcX * scale, t.srcY * scale, t.width * scale, t.height * scale,
          t.dstX * scale, t.dstY * scale, t.width * scale, t.height * scale,
        );
      }
      if (!canvas) return null;
      return await canvas.toDataURL();
    } catch {
      return null;
    } finally {
      await env.scrollTo(save.x, save.y);
    }
  };
}
