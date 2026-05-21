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
 * Proves the decoupled core works entirely in-page: the browser backend
 * (capture + emit) is bundled and injected, runs in the page with no Node and
 * no CDP, and produces an SVG that matches the source.
 */
describe('in-page backend', () => {
  it(
    'captures and emits a faithful SVG entirely inside the page',
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
        const expected = await page.screenshot({ clip: { x: 0, y: 0, width: 420, height: 280 } });

        await page.addScriptTag({ content: code });
        const svg: string = await page.evaluate(async () => {
          // @ts-expect-error injected global
          return await FittingHtml.captureCurrentPage({ width: 420, height: 280, fontMode: 'embed' });
        });

        mkdirSync(OUT, { recursive: true });
        const svgPath = resolve(OUT, 'inpage.svg');
        writeFileSync(svgPath, svg);

        const svgPage = await ctx.newPage();
        await svgPage.setViewportSize({ width: 420, height: 280 });
        await svgPage.goto(pathToFileURL(svgPath).href, { waitUntil: 'networkidle' });
        const actual = await svgPage.screenshot({ clip: { x: 0, y: 0, width: 420, height: 280 } });

        const a = PNG.sync.read(expected);
        const b = PNG.sync.read(actual);
        const diff = new PNG({ width: a.width, height: a.height });
        const px = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
        writeFileSync(resolve(OUT, 'inpage.diff.png'), PNG.sync.write(diff));
        expect(px / (a.width * a.height)).toBeLessThan(0.01);
      } finally {
        await browser.close();
      }
    },
    90_000,
  );
});
