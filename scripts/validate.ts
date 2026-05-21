/**
 * Visual-regression harness: render the source page and the generated SVG in the
 * same Chromium, then pixel-diff them. Reports the fraction of differing pixels
 * and writes expected/actual/diff PNGs.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import sparticuz from '@sparticuz/chromium';
import { captureScene } from '../src/core/capture/capture.js';
import { emitSvg } from '../src/core/emit/svg.js';
import type { Scene } from '../src/core/ir/types.js';

const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process'];

export interface ValidateResult {
  width: number;
  height: number;
  diffPixels: number;
  totalPixels: number;
  ratio: number;
  outDir: string;
}

export async function validate(
  target: { url: string } | { html: string },
  opts: { width: number; height?: number; name: string; outDir: string },
): Promise<ValidateResult> {
  const execPath = process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
  const browser: Browser = await chromium.launch({ executablePath: execPath, args: ARGS });
  try {
    const context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height || 800 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    if ('url' in target) await page.goto(target.url, { waitUntil: 'networkidle' });
    else await page.setContent(target.html, { waitUntil: 'networkidle' });

    await page.evaluate(async () => {
      if (document.fonts) await document.fonts.ready;
    });
    const height =
      opts.height ||
      (await page.evaluate(() =>
        Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      ));
    await page.setViewportSize({ width: opts.width, height });

    // expected: screenshot of the real page
    const expectedBuf = await page.screenshot({ clip: { x: 0, y: 0, width: opts.width, height } });

    // generate SVG
    await page.evaluate(() => {
      const g = globalThis as any;
      if (!g.__name) g.__name = (t: any) => t;
    });
    const scene: Scene = await page.evaluate(captureScene, {
      width: opts.width,
      height,
      deviceScaleFactor: 2,
    });
    const byId = new Map(scene.rasterTargets.map((t) => [t.id, t]));
    for (const node of scene.nodes) {
      if (node.kind !== 'raster') continue;
      const t = byId.get(node.id);
      if (!t || t.width <= 0 || t.height <= 0) continue;
      try {
        const buf = await page.screenshot({ clip: { x: t.x, y: t.y, width: t.width, height: t.height } });
        node.href = 'data:image/png;base64,' + buf.toString('base64');
      } catch {
        node.href = null;
      }
    }
    const svg = emitSvg(scene);

    mkdirSync(opts.outDir, { recursive: true });
    const svgPath = resolve(opts.outDir, `${opts.name}.svg`);
    writeFileSync(svgPath, svg);

    // actual: render the SVG standalone in the same browser
    const svgPage = await context.newPage();
    await svgPage.setViewportSize({ width: opts.width, height });
    await svgPage.goto(pathToFileURL(svgPath).href, { waitUntil: 'networkidle' });
    await svgPage.evaluate(async () => {
      if (document.fonts) await document.fonts.ready;
    });
    const actualBuf = await svgPage.screenshot({ clip: { x: 0, y: 0, width: opts.width, height } });

    const expected = PNG.sync.read(expectedBuf);
    const actual = PNG.sync.read(actualBuf);
    const w = Math.min(expected.width, actual.width);
    const h = Math.min(expected.height, actual.height);
    const diff = new PNG({ width: w, height: h });
    const diffPixels = pixelmatch(
      cropTo(expected, w, h),
      cropTo(actual, w, h),
      diff.data,
      w,
      h,
      { threshold: 0.1 },
    );

    writeFileSync(resolve(opts.outDir, `${opts.name}.expected.png`), PNG.sync.write(expected));
    writeFileSync(resolve(opts.outDir, `${opts.name}.actual.png`), PNG.sync.write(actual));
    writeFileSync(resolve(opts.outDir, `${opts.name}.diff.png`), PNG.sync.write(diff));

    const total = w * h;
    return { width: w, height: h, diffPixels, totalPixels: total, ratio: diffPixels / total, outDir: opts.outDir };
  } finally {
    await browser.close();
  }
}

function cropTo(png: PNG, w: number, h: number): Buffer {
  if (png.width === w && png.height === h) return png.data;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    png.data.copy(out, y * w * 4, y * png.width * 4, y * png.width * 4 + w * 4);
  }
  return out;
}

async function main() {
  const [src, name = 'page', widthArg, heightArg] = process.argv.slice(2);
  if (!src) {
    console.error('usage: tsx scripts/validate.ts <url|file.html> [name] [width] [height]');
    process.exit(1);
  }
  const isUrl = /^https?:\/\//.test(src);
  const target = isUrl ? { url: src } : { url: pathToFileURL(resolve(src)).href };
  const r = await validate(target, {
    width: widthArg ? parseInt(widthArg, 10) : 1280,
    height: heightArg ? parseInt(heightArg, 10) : undefined,
    name,
    outDir: resolve('test/visual/__out__'),
  });
  console.error(
    `[${name}] ${r.width}x${r.height}  diff=${r.diffPixels}/${r.totalPixels}  ` +
      `(${(r.ratio * 100).toFixed(3)}%)  -> ${r.outDir}`,
  );
}

if (process.argv[1] && process.argv[1].endsWith('validate.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
