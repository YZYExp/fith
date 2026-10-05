import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import sparticuz from '@sparticuz/chromium';
import { build } from 'esbuild';

const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process'];
const OUT = resolve(__dirname, '__out__');
const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/raster-fallback.html')).href;

/**
 * Pure in-page capture (NO screenshot backend): un-vectorizable regions must be
 * re-rendered by the foreignObject DOM rasterizer instead of being dropped.
 */
describe('in-page DOM raster fallback', () => {
  async function run(domRasterFallback: boolean) {
    const bundle = await build({
      entryPoints: [resolve(__dirname, '../../src/backends/browser/index.ts')],
      bundle: true,
      format: 'iife',
      globalName: 'FittingHtml',
      write: false,
      target: 'chrome110',
    });
    const execPath = process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
    const browser = await chromium.launch({ executablePath: execPath, args: ARGS });
    try {
      const ctx = await browser.newContext({ viewport: { width: 440, height: 360 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(FIXTURE, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const svg: string = await page.evaluate(
        (o) => (window as any).FittingHtml.captureCurrentPage(o),
        { width: 440, height: 360, domRasterFallback },
      );
      const expected = await page.screenshot();
      mkdirSync(OUT, { recursive: true });
      const svgPath = resolve(OUT, `raster-fallback-${domRasterFallback}.svg`);
      writeFileSync(svgPath, svg);
      const sp = await ctx.newPage();
      await sp.setViewportSize({ width: 440, height: 360 });
      await sp.goto(pathToFileURL(svgPath).href);
      const actual = await sp.screenshot();
      const e = PNG.sync.read(expected);
      const a = PNG.sync.read(actual);
      const diff = new PNG({ width: e.width, height: e.height });
      const px = pixelmatch(e.data, a.data, diff.data, e.width, e.height, { threshold: 0.1 });
      writeFileSync(resolve(OUT, `raster-fallback-${domRasterFallback}.diff.png`), PNG.sync.write(diff));
      return { svg, ratio: px / (e.width * e.height) };
    } finally {
      await browser.close();
    }
  }

  it('drops un-vectorizable regions without the fallback (baseline)', async () => {
    const r = await run(false);
    expect(r.ratio).toBeGreaterThan(0.02);
  }, 60_000);

  it('re-renders them via foreignObject so the result matches the page', async () => {
    const r = await run(true);
    expect(r.svg).toContain('data:image/png');
    expect(r.ratio).toBeLessThan(0.03);
  }, 60_000);
});
