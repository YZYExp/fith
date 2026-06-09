/**
 * Extension-path fidelity: the pure-extension backend can only screenshot the
 * *current viewport* (chrome.tabs.captureVisibleTab), unlike the Node backend
 * which can clip any document region. This test reproduces that constraint —
 * rasterizing an off-screen, raster-fallback region by scrolling it through the
 * viewport and compositing the tiles (planRegionTiles) — and verifies the
 * region lands in the right place with the right pixels.
 *
 * Before the tiling fix, a single viewport screenshot cropped at document
 * coordinates produced a blank/ghost region for anything below the fold.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import sparticuz from '@sparticuz/chromium';
import { captureScene } from '../../src/core/capture/capture.js';
import { emitSvg } from '../../src/core/emit/svg.js';
import { createTiledRasterizer } from '../../src/backends/browser/tiled-raster.js';
import type { Scene } from '../../src/core/ir/types.js';

const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process'];
const OUT = resolve(__dirname, '__out__');
const VW = 800;
const VH = 600;

// A page much taller than the viewport, with a raster-fallback container
// (radial-gradient background → not vectorizable) far below the fold.
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: Arial, sans-serif; }
  .spacer { height: 1500px; background: #fff; }
  .card {
    height: 320px; margin: 0 40px;
    background: radial-gradient(circle at 30% 30%, #1d4ed8, #9333ea);
    color: #fff; border-radius: 16px; padding: 32px; box-sizing: border-box;
  }
  .card h2 { margin: 0 0 12px; font-size: 28px; }
  .card p { margin: 0; font-size: 18px; }
</style></head><body>
  <div class="spacer"></div>
  <div class="card"><h2>Off-Screen Card</h2><p>Composited from below the fold.</p></div>
  <div class="spacer" style="height:300px"></div>
</body></html>`;

/**
 * Drive the *shared* createTiledRasterizer (the same code content.ts runs)
 * through a Playwright-backed environment. shoot() screenshots only the current
 * viewport — mimicking chrome.tabs.captureVisibleTab — and the output canvas is
 * a pngjs buffer (deviceScaleFactor 1 → scale 1, so device px == CSS px).
 */
type PngShot = { scale: number; png: PNG };
function viewportRasterizer(page: Page) {
  return createTiledRasterizer<PngShot>({
    getViewport: () => ({ width: VW, height: VH }),
    getMaxScroll: () =>
      page.evaluate(() => ({
        x: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        y: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
      })),
    getScroll: () => page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })),
    scrollTo: (x, y) => page.evaluate(([sx, sy]) => window.scrollTo(sx, sy), [x, y]),
    settle: () =>
      page.evaluate(
        () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      ),
    shoot: async () => ({ scale: 1, png: PNG.sync.read(await page.screenshot()) }), // viewport only
    createCanvas: (width, height) => {
      const out = new PNG({ width, height });
      return {
        draw: (shot, sx, sy, sw, sh, dx, dy) => {
          // scale is 1 in this env, so src/dst sizes match — straight row copy.
          for (let row = 0; row < sh; row++) {
            const syRow = sy + row;
            const dyRow = dy + row;
            if (syRow < 0 || syRow >= shot.png.height || dyRow < 0 || dyRow >= out.height) continue;
            const sStart = (syRow * shot.png.width + sx) * 4;
            const dStart = (dyRow * out.width + dx) * 4;
            shot.png.data.copy(out.data, dStart, sStart, sStart + sw * 4);
          }
        },
        toDataURL: async () => 'data:image/png;base64,' + PNG.sync.write(out).toString('base64'),
      };
    },
  });
}

describe('extension viewport-tiled rasterization', () => {
  it(
    'composites an off-screen raster-fallback region into the correct place',
    async () => {
      const execPath = process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
      const browser: Browser = await chromium.launch({ executablePath: execPath, args: ARGS });
      try {
        const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
        const page = await context.newPage();
        await page.setContent(FIXTURE, { waitUntil: 'networkidle' });

        const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);

        await page.evaluate(() => {
          const g = globalThis as any;
          if (!g.__name) g.__name = (t: any) => t;
        });
        const scene: Scene = await page.evaluate(captureScene, {
          width: VW,
          height: fullHeight,
          deviceScaleFactor: 1,
          fontMode: 'embed',
          captureScrollableContent: true,
          containerRasterFallback: true,
        } as any);

        // The radial-gradient card must have produced a raster target below the fold.
        const rasters = scene.rasterTargets.filter((t) => t.y > VH);
        expect(rasters.length).toBeGreaterThan(0);

        const rasterize = viewportRasterizer(page);
        const byId = new Map(scene.rasterTargets.map((t) => [t.id, t]));
        for (const node of scene.nodes) {
          if (node.kind !== 'raster') continue;
          const t = byId.get(node.id);
          if (!t || t.width <= 0 || t.height <= 0) continue;
          node.href = await rasterize({ x: t.x, y: t.y, width: t.width, height: t.height });
        }
        // Every off-screen raster region must have been captured (not blank).
        for (const node of scene.nodes) {
          if (node.kind === 'raster') expect(node.href).toBeTruthy();
        }

        const svg = emitSvg(scene);
        mkdirSync(OUT, { recursive: true });
        const svgPath = resolve(OUT, 'extension-offscreen.svg');
        writeFileSync(svgPath, svg);

        // Compare the card band: live page vs rendered SVG.
        const cardTop = await page.evaluate(() => {
          const el = document.querySelector('.card') as HTMLElement;
          return Math.round(el.getBoundingClientRect().top + window.scrollY);
        });
        await page.evaluate(() => window.scrollTo(0, 0));
        // Grow the viewport so the below-the-fold band is clippable in one shot.
        await page.setViewportSize({ width: VW, height: fullHeight });
        const band = { x: 0, y: cardTop, width: VW, height: 320 };
        const expectedBuf = await page.screenshot({ clip: band });

        const svgPage = await context.newPage();
        await svgPage.setViewportSize({ width: VW, height: fullHeight });
        await svgPage.goto(pathToFileURL(svgPath).href, { waitUntil: 'networkidle' });
        const actualBuf = await svgPage.screenshot({ clip: band });

        const expected = PNG.sync.read(expectedBuf);
        const actual = PNG.sync.read(actualBuf);
        const diff = new PNG({ width: expected.width, height: expected.height });
        const diffPixels = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, {
          threshold: 0.1,
        });
        writeFileSync(resolve(OUT, 'extension-offscreen.expected.png'), PNG.sync.write(expected));
        writeFileSync(resolve(OUT, 'extension-offscreen.actual.png'), PNG.sync.write(actual));
        const ratio = diffPixels / (expected.width * expected.height);
        expect(ratio).toBeLessThan(0.05);
      } finally {
        await browser.close();
      }
    },
    90_000,
  );
});
