/**
 * Viewport-tiled rasterization planner.
 *
 * The pure-extension path can only screenshot the *current viewport*
 * (`chrome.tabs.captureVisibleTab`), yet the capture core asks it to rasterize
 * regions in *document* coordinates — regions that may be scrolled off-screen
 * or taller/wider than the viewport. Naively cropping a single viewport
 * screenshot at document coordinates produces the classic bugs: blank or
 * mis-positioned regions, ghost text from the wrong scroll position bleeding
 * through, and off colors/shadows.
 *
 * `planRegionTiles` computes the set of (scroll position → screenshot crop →
 * output paste) tiles needed to cover a document-coordinate region by scrolling
 * it through the viewport. It is intentionally pure (no DOM, no canvas) so the
 * coordinate math — the part most prone to off-by-one and clamping mistakes —
 * is unit-testable. The runtime compositor (in the content script) executes the
 * plan against real screenshots.
 */
import type { Rect } from '../../core/ir/types.js';

export interface Viewport {
  width: number;
  height: number;
}

/** One screenshot tile: scroll here, crop the viewport at src, paste at dst. */
export interface Tile {
  /** Document scroll position to land on (already clamped to the document). */
  scrollX: number;
  scrollY: number;
  /** Crop origin within the captured viewport, in CSS px. */
  srcX: number;
  srcY: number;
  /** Paste origin within the output region, in CSS px. */
  dstX: number;
  dstY: number;
  /** Tile size in CSS px. */
  width: number;
  height: number;
}

/**
 * Plan the tiles that cover `rect` (document coordinates) given the viewport
 * size and the document's maximum scroll offset. `maxScroll` lets the planner
 * model the browser's scroll clamping: when a tile near the document edge can't
 * be scrolled fully to the viewport's top-left, the crop origin shifts down/right
 * accordingly so the composited output stays seamless.
 */
export function planRegionTiles(rect: Rect, vp: Viewport, maxScroll: { x: number; y: number }): Tile[] {
  const tiles: Tile[] = [];
  if (vp.width <= 0 || vp.height <= 0 || rect.width <= 0 || rect.height <= 0) return tiles;
  for (let oy = 0; oy < rect.height; oy += vp.height) {
    for (let ox = 0; ox < rect.width; ox += vp.width) {
      const reqX = rect.x + ox;
      const reqY = rect.y + oy;
      // Where the browser will actually land after scrollTo(reqX, reqY).
      const scrollX = Math.max(0, Math.min(reqX, maxScroll.x));
      const scrollY = Math.max(0, Math.min(reqY, maxScroll.y));
      // The tile's top-left, expressed relative to the (clamped) viewport.
      const srcX = reqX - scrollX;
      const srcY = reqY - scrollY;
      // Clip the tile to both the remaining region and the remaining viewport.
      const width = Math.min(vp.width - srcX, rect.width - ox);
      const height = Math.min(vp.height - srcY, rect.height - oy);
      if (width <= 0 || height <= 0) continue;
      tiles.push({ scrollX, scrollY, srcX, srcY, dstX: ox, dstY: oy, width, height });
    }
  }
  return tiles;
}
