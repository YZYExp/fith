/**
 * Debug aid: `pnpm inspect <url|file> <x> <y> [width] [height]`
 * Lists the DOM elements under a page point (with the styles fith cares about)
 * and the Scene nodes whose rect covers it, so a diff hotspot can be traced to
 * the exact element / capture decision responsible.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sparticuz from '@sparticuz/chromium';
import { captureScene } from '../src/core/capture/capture.js';

async function main() {
  const [src, xs, ys, ws = '1280', hs = '1600'] = process.argv.slice(2);
  if (!src || !xs || !ys) {
    console.error('usage: tsx scripts/inspect.ts <url|file.html> <x> <y> [width] [height]');
    process.exit(1);
  }
  const x = +xs, y = +ys, width = +ws, height = +hs;
  const isUrl = /^https?:\/\//.test(src);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (await sparticuz.executablePath()),
    args: ['--no-sandbox', '--disable-gpu'],
    proxy: isUrl && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
  });
  const page = await (await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true })).newPage();
  await page.goto(isUrl ? src : pathToFileURL(resolve(src)).href, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const els = await page.evaluate(([px, py]) => {
    const out: any[] = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (px < r.left || px > r.right || py < r.top || py > r.bottom) continue;
      const cs = getComputedStyle(el);
      const interesting: Record<string, string> = {};
      for (const k of ['backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundClip', 'filter', 'mixBlendMode', 'maskImage', 'clipPath', 'transform', 'opacity', 'position', 'overflow', 'borderRadius', 'boxShadow', 'fontFamily', 'whiteSpace', 'fontVariationSettings', 'fontFeatureSettings', 'fontStretch', 'fontWeight', 'fontOpticalSizing', 'textRendering', 'fontKerning'] as const) {
        const v = (cs as any)[k];
        if (v && v !== 'none' && v !== 'normal' && v !== 'rgba(0, 0, 0, 0)' && v !== 'auto' && v !== '0px' && v !== 'visible' && v !== '1' && v !== 'static') interesting[k] = String(v).slice(0, 160);
      }
      out.push({ tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''), rect: [r.left, r.top, r.width, r.height].map(Math.round), ...interesting });
    }
    return out;
  }, [x, y]);
  console.log('DOM elements (outer → inner):');
  for (const e of els) console.log(' ', JSON.stringify(e));
  await page.evaluate(() => { const g = globalThis as any; if (!g.__name) g.__name = (t: any) => t; });
  const scene = await page.evaluate(captureScene, { width, height, deviceScaleFactor: 1, fontMode: 'none', captureScrollableContent: true, containerRasterFallback: true } as any);
  console.log('\nScene nodes covering point:');
  for (const n of scene.nodes) {
    const r = n.rect;
    if (x < r.x || x > r.x + r.width || y < r.y || y > r.y + r.height) continue;
    const { id, rect, kind, ...rest } = n as any;
    const brief = JSON.stringify(rest, (k, v) => (typeof v === 'string' && v.length > 80 ? v.slice(0, 60) + '…' : v));
    console.log(' ', kind, [r.x, r.y, r.width, r.height].map(Math.round).join(','), brief.slice(0, 300));
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
