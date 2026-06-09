import { describe, it, expect } from 'vitest';
import { planRegionTiles } from '../src/backends/browser/tiles.js';

const VP = { width: 1000, height: 800 };
const NO_LIMIT = { x: 100000, y: 100000 };

describe('planRegionTiles', () => {
  it('covers a region that fits in one viewport with a single tile', () => {
    const tiles = planRegionTiles({ x: 50, y: 60, width: 300, height: 200 }, VP, NO_LIMIT);
    expect(tiles).toHaveLength(1);
    // Scroll the region's top-left to the viewport origin → crop at (0,0).
    expect(tiles[0]).toMatchObject({
      scrollX: 50, scrollY: 60, srcX: 0, srcY: 0, dstX: 0, dstY: 0, width: 300, height: 200,
    });
  });

  it('tiles a region taller than the viewport vertically', () => {
    // 1700px tall → 800 + 800 + 100.
    const tiles = planRegionTiles({ x: 0, y: 0, width: 500, height: 1700 }, VP, NO_LIMIT);
    expect(tiles).toHaveLength(3);
    expect(tiles[0]).toMatchObject({ scrollY: 0, srcY: 0, dstY: 0, height: 800 });
    expect(tiles[1]).toMatchObject({ scrollY: 800, srcY: 0, dstY: 800, height: 800 });
    expect(tiles[2]).toMatchObject({ scrollY: 1600, srcY: 0, dstY: 1600, height: 100 });
    // Every tile pastes back into a contiguous, gap-free column.
    expect(tiles.reduce((h, t) => h + t.height, 0)).toBe(1700);
  });

  it('tiles a region in a 2-D grid when wider and taller than the viewport', () => {
    const tiles = planRegionTiles({ x: 0, y: 0, width: 1500, height: 1200 }, VP, NO_LIMIT);
    // cols: 1000 + 500, rows: 800 + 400 → 4 tiles
    expect(tiles).toHaveLength(4);
    const total = tiles.reduce((a, t) => a + t.width * t.height, 0);
    expect(total).toBe(1500 * 1200); // exact, seamless coverage
  });

  it('shifts the crop origin when scroll clamps at the document edge', () => {
    // A region near the document bottom that the browser cannot scroll fully to
    // the viewport top: maxScroll.y caps the scroll, so the crop must shift down.
    const tiles = planRegionTiles(
      { x: 0, y: 1900, width: 400, height: 300 },
      VP,
      { x: 0, y: 1500 }, // can't scroll past y=1500
    );
    expect(tiles).toHaveLength(1);
    // Requested scrollY 1900 clamps to 1500 → region sits 400px down the viewport.
    expect(tiles[0]).toMatchObject({ scrollY: 1500, srcY: 400, dstY: 0, height: 300 });
  });

  it('returns no tiles for an empty or degenerate region', () => {
    expect(planRegionTiles({ x: 0, y: 0, width: 0, height: 100 }, VP, NO_LIMIT)).toHaveLength(0);
    expect(planRegionTiles({ x: 0, y: 0, width: 100, height: 100 }, { width: 0, height: 0 }, NO_LIMIT)).toHaveLength(0);
  });

  it('keeps src/dst tile sizes equal so the composite is 1:1 (no scaling/skew)', () => {
    const tiles = planRegionTiles({ x: 30, y: 2500, width: 1300, height: 1100 }, VP, { x: 200, y: 2000 });
    for (const t of tiles) {
      expect(t.width).toBeGreaterThan(0);
      expect(t.height).toBeGreaterThan(0);
      // Crop never exceeds the viewport.
      expect(t.srcX + t.width).toBeLessThanOrEqual(VP.width);
      expect(t.srcY + t.height).toBeLessThanOrEqual(VP.height);
    }
  });
});
