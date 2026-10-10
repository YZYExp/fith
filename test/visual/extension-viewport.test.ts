/**
 * Viewport-only capture (the extension's default "visible area" scope): unlike
 * full-page capture, it must NOT scroll the page — it takes a single
 * captureVisibleTab screenshot and crops raster-fallback regions out of it,
 * using viewport-relative coordinates. This test drives the *shared*
 * createViewportRasterizer (the same code content.ts runs) and verifies:
 *   • a raster-fallback region that's currently on screen is captured and lands
 *     pixel-correct (no scroll, no stitch), and
 *   • a region below the fold yields null (left out, not blank/ghosted), and
 *   • the page scroll position is never touched.
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
import { createViewportRasterizer } from '../../src/backends/browser/viewport-raster.js';
import type { Scene } from '../../src/core/ir/types.js';

const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process'];
const OUT = resolve(__dirname, '__out__');
const VW = 800;
const VH = 600;

// A tall page with two raster-fallback cards (conic-gradient bg → not
// vectorizable): one we'll scroll into view, one left far below the fold.
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: Arial, sans-serif; }
  .spacer { height: 900px; background: #fff; }
  .card {
    height: 300px; margin: 0 40px;
    background: conic-gradient(from 20deg at 30% 30%, #1d4ed8, #9333ea, #1d4ed8); /* conic: still needs raster */
    color: #fff; border-radius: 16px; padding: 32px; box-sizing: border-box;
  }
  .card h2 { margin: 0 0 12px; font-size: 28px; }
  .card p { margin: 0; font-size: 18px; }
</style></head><body>
  <div class="spacer"></div>
  <div class="card" id="a"><h2>Card A</h2><p>Scrolled into view.</p></div>
  <div class="spacer" style="height:1200px"></div>
  <div class="card" id="b"><h2>Card B</h2><p>Stays below the fold.</p></div>
  <div class="spacer" style="height:300px"></div>
</body></html>`;

/** pngjs-backed single-viewport env for the shared createViewportRasterizer. */
type PngShot = { scale: number; png: PNG };
function viewportRasterizer(page: Page) {
  return createViewportRasterizer<PngShot>({
    getViewport: () => ({ width: VW, height: VH }),
    shoot: async () => ({ scale: 1, png: PNG.sync.read(await page.screenshot()) }), // viewport only
    createCanvas: (width, height) => {
      const out = new PNG({ width, height });
      return {
        draw: (shot, sx, sy, sw, sh, dx, dy) => {
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

describe('extension viewport-only capture', () => {
  it(
    'captures only the visible viewport without scrolling',
    async () => {
      const execPath = process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
      const browser: Browser = await chromium.launch({ executablePath: execPath, args: ARGS });
      try {
        const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
        const page = await context.newPage();
        await page.setContent(FIXTURE, { waitUntil: 'networkidle' });

        // Scroll Card A flush to the top of the viewport; Card B stays off-screen.
        const cardATop = await page.evaluate(() => {
          const el = document.querySelector('#a') as HTMLElement;
          return Math.round(el.getBoundingClientRect().top + window.scrollY);
        });
        await page.evaluate((y) => window.scrollTo(0, y), cardATop);
        const scrollBefore = await page.evaluate(() => window.scrollY);

        await page.evaluate(() => {
          const g = globalThis as any;
          if (!g.__name) g.__name = (t: any) => t;
        });
        // Viewport-only: do NOT unfurl scroll; coords stay viewport-relative.
        const scene: Scene = await page.evaluate(captureScene, {
          width: VW,
          height: VH,
          deviceScaleFactor: 1,
          fontMode: 'embed',
          captureScrollableContent: false,
          containerRasterFallback: true,
        } as any);

        const byId = new Map(scene.rasterTargets.map((t) => [t.id, t]));
        const rasterize = viewportRasterizer(page);
        // Off-screen content (Card B) is culled at capture time against the
        // viewport-sized region, so only the on-screen Card A raster remains —
        // and all its raster targets sit inside the viewport.
        const rasterNodes = scene.nodes.filter((n) => n.kind === 'raster');
        expect(rasterNodes.length).toBeGreaterThan(0);
        for (const n of rasterNodes) expect(byId.get(n.id)!.y).toBeLessThan(VH);

        for (const node of rasterNodes) {
          const t = byId.get(node.id)!;
          if (t.width <= 0 || t.height <= 0) continue;
          (node as any).href = await rasterize({ x: t.x, y: t.y, width: t.width, height: t.height });
        }
        // Every on-screen raster region was captured (not blank).
        for (const node of rasterNodes) expect((node as any).href).toBeTruthy();

        // Safety net: a region below the fold yields null (it can't be in the
        // single viewport screenshot), so its node would simply paint nothing.
        expect(await rasterize({ x: 0, y: VH + 100, width: 200, height: 200 })).toBeNull();

        // The rasterizer must never move the page.
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

        const svg = emitSvg(scene);
        mkdirSync(OUT, { recursive: true });
        const svgPath = resolve(OUT, 'extension-viewport.svg');
        writeFileSync(svgPath, svg);

        // Compare the full visible viewport: live page vs rendered SVG.
        const expectedBuf = await page.screenshot();
        const svgPage = await context.newPage();
        await svgPage.setViewportSize({ width: VW, height: VH });
        await svgPage.goto(pathToFileURL(svgPath).href, { waitUntil: 'networkidle' });
        const actualBuf = await svgPage.screenshot();

        const expected = PNG.sync.read(expectedBuf);
        const actual = PNG.sync.read(actualBuf);
        const diff = new PNG({ width: expected.width, height: expected.height });
        const diffPixels = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, {
          threshold: 0.1,
        });
        writeFileSync(resolve(OUT, 'extension-viewport.expected.png'), PNG.sync.write(expected));
        writeFileSync(resolve(OUT, 'extension-viewport.actual.png'), PNG.sync.write(actual));
        const ratio = diffPixels / (expected.width * expected.height);
        expect(ratio).toBeLessThan(0.05);
      } finally {
        await browser.close();
      }
    },
    90_000,
  );
});
