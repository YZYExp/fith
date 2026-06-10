/**
 * Pure unit tests for createViewportRasterizer — the non-scrolling extension
 * rasterizer. Covers the two strategies and the document-coords origin offset
 * (full-page mode) without a browser, using a fake screenshot + canvas env.
 */
import { describe, it, expect } from 'vitest';
import { createViewportRasterizer } from '../src/backends/browser/viewport-raster.js';
import type { TileShot, TileCanvas } from '../src/backends/browser/raster-types.js';

interface FakeShot extends TileShot {
  scale: number;
}

/** Records the single draw() it receives so tests can assert crop geometry. */
function fakeCanvas() {
  const calls: number[][] = [];
  const canvas: TileCanvas<FakeShot> = {
    draw: (_s, sx, sy, sw, sh, dx, dy, dw, dh) => calls.push([sx, sy, sw, sh, dx, dy, dw, dh]),
    toDataURL: async () => 'data:image/png;base64,CANVAS',
  };
  return { canvas, calls };
}

describe('createViewportRasterizer', () => {
  it('uses an exact shootRegion result directly and never screenshots the viewport', async () => {
    let shotCalls = 0;
    const rasterize = createViewportRasterizer<FakeShot>({
      getViewport: () => ({ width: 800, height: 600 }),
      shootRegion: async () => 'data:image/png;base64,REGION',
      shoot: async () => {
        shotCalls++;
        return { scale: 1 };
      },
      createCanvas: () => fakeCanvas().canvas,
    });
    const url = await rasterize({ x: 0, y: 5000, width: 200, height: 200 });
    expect(url).toBe('data:image/png;base64,REGION');
    expect(shotCalls).toBe(0); // below the fold, captured without scrolling
  });

  it('falls back to a viewport crop when shootRegion yields null', async () => {
    const { canvas, calls } = fakeCanvas();
    const rasterize = createViewportRasterizer<FakeShot>({
      getViewport: () => ({ width: 800, height: 600 }),
      shootRegion: async () => null, // permission not granted
      shoot: async () => ({ scale: 1 }),
      createCanvas: () => canvas,
    });
    const url = await rasterize({ x: 100, y: 50, width: 200, height: 120 });
    expect(url).toBe('data:image/png;base64,CANVAS');
    // fully on-screen at origin {0,0}: src == dst, full size.
    expect(calls).toEqual([[100, 50, 200, 120, 0, 0, 200, 120]]);
  });

  it('offsets by the document origin (full-page scroll) and scales by device px', async () => {
    const { canvas, calls } = fakeCanvas();
    const rasterize = createViewportRasterizer<FakeShot>({
      getViewport: () => ({ width: 800, height: 600 }),
      getOrigin: () => ({ x: 0, y: 1000 }), // viewport scrolled to docY=1000
      shoot: async () => ({ scale: 2 }), // HiDPI
      createCanvas: () => canvas,
    });
    // Region at docY=1000 is at the top of the viewport (ry=0).
    const url = await rasterize({ x: 0, y: 1000, width: 100, height: 100 });
    expect(url).toBe('data:image/png;base64,CANVAS');
    expect(calls).toEqual([[0, 0, 200, 200, 0, 0, 200, 200]]); // ×2 scale
  });

  it('crops only the visible slice of a region straddling the fold', async () => {
    const { canvas, calls } = fakeCanvas();
    const rasterize = createViewportRasterizer<FakeShot>({
      getViewport: () => ({ width: 800, height: 600 }),
      shoot: async () => ({ scale: 1 }),
      createCanvas: () => canvas,
    });
    // Region spans docY 500..900 but the viewport ends at 600 → keep 500..600.
    await rasterize({ x: 0, y: 500, width: 200, height: 400 });
    // src y0=500, height 100; dst offset 0 (region top is on-screen).
    expect(calls).toEqual([[0, 500, 200, 100, 0, 0, 200, 100]]);
  });

  it('returns null for a region wholly off-screen with no shootRegion', async () => {
    const rasterize = createViewportRasterizer<FakeShot>({
      getViewport: () => ({ width: 800, height: 600 }),
      getOrigin: () => ({ x: 0, y: 0 }),
      shoot: async () => ({ scale: 1 }),
      createCanvas: () => fakeCanvas().canvas,
    });
    expect(await rasterize({ x: 0, y: 5000, width: 200, height: 200 })).toBeNull();
  });
});
