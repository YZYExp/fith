/**
 * Real-world screenshot comparison generator.
 * For each URL: screenshot the live page (left), capture+emit our SVG and
 * render it back (right), then stitch them side-by-side into one PNG so the
 * conversion fidelity is visible at a glance.
 *
 * Run: CHROMIUM_PATH=/tmp/chromium tsx scripts/screenshot-realworld.ts
 */
import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { PNG } from 'pngjs';
import sparticuz from '@sparticuz/chromium';
import { captureScene } from '../src/core/capture/capture.js';
import { emitSvg } from '../src/core/emit/svg.js';

const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process', '--ignore-certificate-errors'];
const OUT = resolve('test/visual/__out__/realworld');

const TARGETS: { name: string; url: string; settleMs?: number }[] = [
  { name: 'github-vitejs-vite', url: 'https://github.com/vitejs/vite' },
  { name: 'google-search', url: 'https://www.google.com/search?q=html+to+svg+converter', settleMs: 1000 },
  { name: 'google-images', url: 'https://www.google.com/search?q=gradient+ui+design&tbm=isch', settleMs: 2000 },
  { name: 'mui-homepage', url: 'https://mui.com/material-ui/getting-started/', settleMs: 1500 },
  { name: 'antd-button', url: 'https://ant.design/components/button/', settleMs: 2000 },
  { name: 'mdn-css-background', url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/background' },
  { name: 'react-dev', url: 'https://react.dev/', settleMs: 1000 },
  { name: 'tailwind-docs', url: 'https://tailwindcss.com/docs/background-color', settleMs: 1000 },
];

const W = 1280;
const H = 900;

/** Stitch two equal-height PNGs side by side with a divider gutter. */
function stitch(left: PNG, right: PNG, gutter = 16): PNG {
  const h = Math.max(left.height, right.height);
  const w = left.width + gutter + right.width;
  const out = new PNG({ width: w, height: h });
  out.data.fill(0xff); // white background
  const blit = (src: PNG, dx: number) => {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const si = (y * src.width + x) * 4;
        const di = (y * w + (x + dx)) * 4;
        out.data[di] = src.data[si];
        out.data[di + 1] = src.data[si + 1];
        out.data[di + 2] = src.data[si + 2];
        out.data[di + 3] = src.data[si + 3];
      }
    }
  };
  blit(left, 0);
  blit(right, left.width + gutter);
  return out;
}

async function run() {
  const execPath = process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
  mkdirSync(OUT, { recursive: true });
  for (const t of TARGETS) {
    process.stdout.write(`[${t.name}] navigating… `);
    // Fresh browser per target: --single-process Chromium is prone to crashing
    // when several heavy navigations share one process.
    const browser: Browser = await chromium.launch({ executablePath: execPath, args: ARGS });
    try {
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
        await page.goto(t.url, { waitUntil: 'networkidle', timeout: 60_000 });
        if (t.settleMs) await page.waitForTimeout(t.settleMs);
        await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; });

        // 1) live page screenshot
        const liveBuf = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });

        // 2) capture → emit SVG (with raster targets resolved)
        await page.evaluate(() => { const g = globalThis as any; if (!g.__name) g.__name = (x: any) => x; });
        const scene = await page.evaluate(captureScene, {
          width: W, height: H, deviceScaleFactor: 1, fontMode: 'embed',
          captureScrollableContent: false, containerRasterFallback: true,
        } as any);
        const byId = new Map(scene.rasterTargets.map((r) => [r.id, r]));
        for (const node of scene.nodes) {
          if (node.kind !== 'raster') continue;
          const r = byId.get(node.id);
          if (!r || r.width <= 0 || r.height <= 0) continue;
          try {
            const buf = await page.screenshot({ clip: { x: r.x, y: r.y, width: r.width, height: r.height } });
            node.href = 'data:image/png;base64,' + buf.toString('base64');
          } catch { node.href = null; }
        }
        const svg = emitSvg(scene);
        writeFileSync(join(OUT, `${t.name}.svg`), svg);

        // 3) render the SVG back to PNG
        const svgPath = join(OUT, `${t.name}.svg`);
        const svgPage = await ctx.newPage();
        await svgPage.setViewportSize({ width: W, height: H });
        await svgPage.goto(pathToFileURL(svgPath).href, { waitUntil: 'networkidle' });
        await svgPage.evaluate(async () => { if (document.fonts) await document.fonts.ready; });
        const svgBuf = await svgPage.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
        await svgPage.close();

        // 4) stitch side-by-side
        const comparison = stitch(PNG.sync.read(liveBuf), PNG.sync.read(svgBuf));
        writeFileSync(join(OUT, `${t.name}.compare.png`), PNG.sync.write(comparison));
        console.log(`done (nodes=${scene.nodes.length}, svg=${(svg.length / 1024).toFixed(0)}KB)`);
    } catch (e) {
      console.log(`FAILED: ${(e as Error).message.split('\n')[0]}`);
    } finally {
      await browser.close();
    }
  }
  console.log(`\nComparison images written to ${OUT}/*.compare.png`);
}

run().catch((e) => { console.error(e); process.exit(1); });
