import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { build } from 'esbuild';
import { renderDetailed } from '../../src/backends/node/playwright.js';
import { buildReport } from '../../src/core/report.js';
import type { Scene } from '../../src/core/ir/types.js';

const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'];
const RASTER = pathToFileURL(resolve(__dirname, '../fixtures/raster-fallback.html')).href;
const SMOKE = pathToFileURL(resolve(__dirname, '../fixtures/smoke.html')).href;

const rect = { x: 0, y: 0, width: 10, height: 10 };

describe('buildReport', () => {
  it('lists pictures, blank regions and how fonts are carried', () => {
    const scene = {
      nodes: [
        { kind: 'raster', id: 'a', rect, opacity: 1, clip: null, reason: 'filter', href: 'data:image/png;base64,AA', filledBy: 'dom', desc: 'div.x' },
        { kind: 'raster', id: 'b', rect, opacity: 1, clip: null, reason: '3d-transform', href: null },
        { kind: 'raster', id: 'c', rect, opacity: 1, clip: null, reason: 'canvas', href: 'data:image/png;base64,BB' },
        { kind: 'raster', id: 'd', rect, opacity: 1, clip: null, reason: 'img', href: null, imgFallback: { src: 'x.png', rect } },
        { kind: 'text', id: 't', fontFamily: '"Inter", sans-serif' },
        { kind: 'text', id: 'u', fontFamily: 'Georgia, serif' },
      ],
      fonts: [{ family: 'Inter' }],
    } as unknown as Scene;
    const r = buildReport(scene);
    expect(r.rasters.map((x) => [x.reason, x.filled])).toEqual([
      ['filter', 'dom'],
      ['3d-transform', 'none'],
      ['canvas', 'screenshot'],
      ['img', 'none'],
    ]);
    // an <img> the Node backend will fetch itself is not a blank region
    expect(r.omitted.map((x) => x.reason)).toEqual(['3d-transform']);
    expect(r.fonts).toEqual([
      { family: 'Inter', mode: 'embedded' },
      { family: 'Georgia', mode: 'referenced' },
    ]);
    expect(buildReport(scene, { outlined: true }).fonts.every((f) => f.mode === 'outlined')).toBe(true);
  });
});

describe('capture report', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ARGS });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  it('the Node backend reports what it screenshotted, and a plain page reports nothing', async () => {
    const withRaster = await renderDetailed({ url: RASTER }, { width: 440, height: 360, fontMode: 'none', executablePath: process.env.CHROMIUM_PATH });
    expect(withRaster.report.rasters.length).toBeGreaterThan(0);
    expect(withRaster.report.rasters.every((r) => r.filled === 'screenshot')).toBe(true);
    expect(withRaster.report.omitted).toEqual([]);

    const plain = await renderDetailed({ url: SMOKE }, { width: 420, height: 280, fontMode: 'none', executablePath: process.env.CHROMIUM_PATH });
    expect(plain.report.rasters).toEqual([]);
    expect(plain.report.fonts.length).toBeGreaterThan(0);
  }, 90_000);

  it('the in-page backend says which regions are blank without a screenshot backend, and which the DOM re-render filled', async () => {
    const bundle = await build({ entryPoints: [resolve(__dirname, '../../src/backends/browser/index.ts')], bundle: true, format: 'iife', globalName: 'Fith', write: false, target: 'chrome110' });
    const ctx = await browser.newContext({ viewport: { width: 440, height: 360 } });
    const page = await ctx.newPage();
    await page.goto(RASTER, { waitUntil: 'networkidle' });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const run = (domRasterFallback: boolean) =>
      page.evaluate((o) => (window as any).Fith.captureCurrentPageDetailed(o), { width: 440, height: 360, domRasterFallback }) as Promise<{ svg: string; report: import('../../src/core/ir/types.js').CaptureReport }>;
    const off = await run(false);
    expect(off.report.omitted.length).toBeGreaterThan(0);
    expect(off.report.omitted.every((o) => !!o.reason)).toBe(true);
    const on = await run(true);
    expect(on.report.rasters.some((r) => r.filled === 'dom')).toBe(true);
    expect(on.report.omitted.length).toBeLessThan(off.report.omitted.length);
    await ctx.close();
  }, 90_000);
});
