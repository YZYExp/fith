import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import sparticuz from '@sparticuz/chromium';
import { build } from 'esbuild';

const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process'];
const OUT = resolve(__dirname, '__out__');
const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/smoke.html')).href;

/**
 * Proves the subtree-capture capability: captureElement() crops the SVG to a
 * single element's box (viewBox at the element origin) and matches a screenshot
 * of just that element.
 */
describe('element (subtree) capture', () => {
  it(
    'captures only the picked element and matches its screenshot',
    async () => {
      const bundle = await build({
        entryPoints: [resolve(__dirname, '../../src/backends/browser/index.ts')],
        bundle: true,
        format: 'iife',
        globalName: 'FittingHtml',
        write: false,
        target: 'chrome110',
      });
      const code = bundle.outputFiles[0].text;

      const execPath = process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
      const browser: Browser = await chromium.launch({ executablePath: execPath, args: ARGS });
      try {
        const ctx = await browser.newContext({ viewport: { width: 420, height: 280 }, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        await page.goto(FIXTURE, { waitUntil: 'networkidle' });
        await page.evaluate(async () => {
          if (document.fonts) await document.fonts.ready;
        });

        const exact = await page.evaluate(() => {
          const r = document.querySelector('.card')!.getBoundingClientRect();
          return { x: r.left, y: r.top, width: r.width, height: r.height };
        });
        const rect = {
          x: Math.round(exact.x),
          y: Math.round(exact.y),
          width: Math.round(exact.width),
          height: Math.round(exact.height),
        };

        const expected = await page.locator('.card').screenshot();

        await page.addScriptTag({ content: code });
        const svg: string = await page.evaluate(async () => {
          // @ts-expect-error injected global
          return await FittingHtml.captureElement(document.querySelector('.card'));
        });

        // viewBox must be cropped to the element box (not the full page at 0,0)
        const vb = svg.match(/viewBox="([\d.\- ]+)"/)![1].split(' ').map(Number);
        expect(Math.abs(vb[0] - exact.x)).toBeLessThan(1);
        expect(Math.abs(vb[1] - exact.y)).toBeLessThan(1);
        expect(Math.abs(vb[2] - exact.width)).toBeLessThan(1);
        expect(Math.abs(vb[3] - exact.height)).toBeLessThan(1);

        mkdirSync(OUT, { recursive: true });
        const svgPath = resolve(OUT, 'element.svg');
        writeFileSync(svgPath, svg);

        const svgPage = await ctx.newPage();
        await svgPage.setViewportSize({ width: rect.width, height: rect.height });
        await svgPage.goto(pathToFileURL(svgPath).href, { waitUntil: 'networkidle' });
        const actual = await svgPage.screenshot({ clip: { x: 0, y: 0, width: rect.width, height: rect.height } });

        const a = PNG.sync.read(expected);
        const b = PNG.sync.read(actual);
        const w = Math.min(a.width, b.width);
        const h = Math.min(a.height, b.height);
        const diff = new PNG({ width: w, height: h });
        const px = pixelmatch(a.data, b.data, diff.data, w, h, { threshold: 0.1 });
        writeFileSync(resolve(OUT, 'element.diff.png'), PNG.sync.write(diff));
        expect(px / (w * h)).toBeLessThan(0.02);
      } finally {
        await browser.close();
      }
    },
    90_000,
  );
});
