/**
 * Visual-regression harness: render the source page and the generated SVG in the
 * same Chromium, then pixel-diff them. Reports the fraction of differing pixels
 * and writes expected/actual/diff PNGs.
 */
import { writeFileSync, mkdirSync, createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import sparticuz from '@sparticuz/chromium';
import { captureScene } from '../src/core/capture/capture.js';
import { emitSvg } from '../src/core/emit/svg.js';
import { collectExternalCss } from '../src/backends/node/external-css.js';
import { resolveCorsImages } from '../src/backends/node/cors-images.js';
import { createOutliner } from '../src/core/emit/outline.js';
import { systemFontLoader } from '../src/backends/node/fonts.js';
import type { Scene } from '../src/core/ir/types.js';

const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process'];

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.mjs': 'text/javascript',
  '.map': 'application/json',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.eot': 'application/vnd.ms-fontobject',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Serve a directory over http for fixtures that need a real origin (webfonts, ES modules). */
export function serveDir(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = join(dir, rel);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
    createReadStream(file).pipe(res);
  });
  return new Promise((res) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      res({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

export interface ValidateResult {
  width: number;
  height: number;
  diffPixels: number;
  totalPixels: number;
  ratio: number;
  outDir: string;
  /** Scene statistics for the bench harness. */
  stats: SceneStats;
  svgBytes: number;
  captureMs: number;
  /** diff pixels / pixels that differ from the page background in either image (undiluted by whitespace). */
  contentRatio: number;
  /** worst 64px tile: differing fraction (localizes a failure the global ratio hides). */
  worstTile: number;
  /** Page self-drift: diff between the reference screenshot and a second one of the ORIGINAL page taken after
   *  capture. High drift = moving target (carousel/ads) — the diff ratio is then not a conversion error. */
  drift: number;
}

export interface SceneStats {
  nodes: number;
  box: number;
  text: number;
  image: number;
  inlineSvg: number;
  raster: number;
  rasterArea: number;
  /** Characters in vector <text> nodes. */
  textChars: number;
  /** Visible characters of DOM text nodes (rendered), for coverage checks. */
  domTextChars: number;
  rasterReasons: Record<string, number>;
  /** Largest raster nodes (reason, element, area px) for triage. */
  topRasters: { reason: string; el?: string; area: number }[];
}

export function sceneStats(scene: Scene, domTextChars: number): SceneStats {
  const st: SceneStats = { nodes: scene.nodes.length, box: 0, text: 0, image: 0, inlineSvg: 0, raster: 0, rasterArea: 0, textChars: 0, domTextChars, rasterReasons: {}, topRasters: [] };
  for (const n of scene.nodes) {
    if (n.kind === 'box') st.box++;
    else if (n.kind === 'text') { st.text++; for (const l of n.lines) st.textChars += l.text.replace(/\s/g, '').length; }
    else if (n.kind === 'image') st.image++;
    else if (n.kind === 'inline-svg') {
      st.inlineSvg++;
      // text inside transplanted <svg> (charts, diagrams) is still vector text
      for (const m of n.markup.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) st.textChars += m[1].replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/g, 'x').replace(/\s/g, '').length;
    }
    else if (n.kind === 'raster') { st.raster++; st.rasterArea += n.rect.width * n.rect.height; st.rasterReasons[n.reason] = (st.rasterReasons[n.reason] || 0) + 1; st.topRasters.push({ reason: n.reason, el: n.desc, area: Math.round(n.rect.width * n.rect.height) }); }
  }
  st.topRasters.sort((a, b) => b.area - a.area);
  st.topRasters = st.topRasters.slice(0, 5);
  return st;
}

export async function validate(
  target: { url: string } | { html: string },
  opts: {
    width: number;
    height?: number;
    name: string;
    outDir: string;
    fontMode?: 'embed' | 'outline' | 'none';
    /** JS snippet evaluated in-page before navigation (e.g. to seed localStorage). */
    initScript?: string;
    /** Extra settle time (ms) after networkidle before capturing. */
    settleMs?: number;
    /** HTTP(S) proxy for live-site runs (defaults to $HTTPS_PROXY when target is a remote URL). */
    proxy?: string;
    /** Capture only the viewport (no full-page height). */
    viewportOnly?: boolean;
  },
): Promise<ValidateResult> {
  const execPath = process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
  const browser: Browser = await chromium.launch({
    executablePath: execPath,
    args: ARGS,
    proxy: 'url' in target && /^https?:\/\/(?!(localhost|127\.|\[::1\]))/.test(target.url) && (opts.proxy || process.env.HTTPS_PROXY) ? { server: (opts.proxy || process.env.HTTPS_PROXY)! } : undefined,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height || 800 },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true,
    });
    if (opts.initScript) await context.addInitScript(opts.initScript);
    const page = await context.newPage();
    if ('url' in target) {
      // real sites with analytics/ads rarely reach networkidle: settle on 'load' + a bounded idle wait
      await page.goto(target.url, { waitUntil: 'load', timeout: 45_000 });
      await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
      // Stabilise the moving target so reference screenshot and capture see the same page: freeze CSS
      // animations/transitions, scroll through once to trigger lazy loading, wait for images to decode.
      await page.addStyleTag({ content: '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important;caret-color:transparent!important}' }).catch(() => {});
      await page.evaluate(async () => {
        const h = Math.min(document.documentElement.scrollHeight, 6000);
        for (let y = 0; y < h; y += Math.max(300, innerHeight * 0.8)) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
        scrollTo(0, 0);
        // decode() never settles for images that never load: bound the wait
        await Promise.race([
          Promise.all(Array.from(document.images).map((i) => (i.complete ? Promise.resolve() : i.decode().catch(() => {})))),
          new Promise((r) => setTimeout(r, 3000)),
        ]);
      }).catch(() => {});
      await page.waitForTimeout(600);
    }
    else await page.setContent(target.html, { waitUntil: 'networkidle' });
    if (opts.settleMs) await page.waitForTimeout(opts.settleMs);

    await page.evaluate(async () => {
      if (document.fonts) await document.fonts.ready;
    });
    const height =
      opts.height ||
      (opts.viewportOnly ? 800 : 0) ||
      (await page.evaluate(() =>
        Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      ));
    await page.setViewportSize({ width: opts.width, height });

    // expected: screenshot of the real page
    // Resizing can start CSS transitions (for example a fixed 100vh sidebar).
    // Finish finite animations before measuring geometry and capturing the scene.
    const expectedBuf = await page.screenshot({
      clip: { x: 0, y: 0, width: opts.width, height },
      animations: 'disabled',
    });

    // generate SVG
    await page.evaluate(() => {
      // unconditional: some pages define their own __name with different semantics (returns undefined)
      (globalThis as any).__name = (t: any) => t;
    });
    const t0 = Date.now();
    const domTextChars = await page.evaluate(([capW, capH]) => {
      let n = 0;
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode() as Text | null; t; t = w.nextNode() as Text | null) {
        const el = t.parentElement;
        if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        // skip visually-hidden (sr-only, clip:rect) text
        let hidden = false;
        for (let a: Element | null = el; a && !hidden; a = a.parentElement) {
          const c = getComputedStyle(a);
          const m = c.clip.match(/rect\(([^)]*)\)/);
          if (m && c.position === 'absolute') {
            const v = m[1].split(/[ ,]+/).map(parseFloat);
            if (v[1] - v[3] <= 0 || v[2] - v[0] <= 0) hidden = true;
          }
        }
        if (hidden) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        if (r.top >= capH || r.bottom <= 0 || r.left >= capW || r.right <= 0) continue; // outside the captured region
        n += (t.data || '').replace(/\s/g, '').length;
      }
      return n;
    }, [opts.width, height] as [number, number]);
    const scene: Scene = await page.evaluate(captureScene, {
      width: opts.width,
      height,
      deviceScaleFactor: 2,
      fontMode: opts.fontMode === 'none' ? 'none' : 'embed',
      collectGlyphX: opts.fontMode === 'outline',
      externalCss: opts.fontMode === 'none' ? undefined : await collectExternalCss(page),
      captureScrollableContent: true,
      containerRasterFallback: true,
    } as any);
    await resolveCorsImages(page, scene);
    const byId = new Map(scene.rasterTargets.map((t) => [t.id, t]));
    for (const node of scene.nodes) {
      if (node.kind !== 'raster') continue;
      const t = byId.get(node.id);
      if (!t || t.width <= 0 || t.height <= 0) continue;
      try {
        const buf = await page.screenshot({
          clip: { x: t.x, y: t.y, width: t.width, height: t.height },
          animations: 'disabled',
        });
        node.href = 'data:image/png;base64,' + buf.toString('base64');
      } catch {
        node.href = null;
      }
    }
    let svg: string;
    if (opts.fontMode === 'outline') {
      const outline = createOutliner(scene.fonts, systemFontLoader());
      scene.fonts = [];
      svg = emitSvg(scene, { outline });
    } else {
      svg = emitSvg(scene);
    }

    const captureMs = Date.now() - t0;
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

    // noise floor: how much did the original page itself change during the run?
    let drift = 0;
    try {
      const again = PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width: opts.width, height }, animations: 'disabled' }));
      const dw = Math.min(expected.width, again.width), dh = Math.min(expected.height, again.height);
      drift = pixelmatch(cropTo(expected, dw, dh), cropTo(again, dw, dh), null, dw, dh, { threshold: 0.1 }) / (dw * dh);
    } catch { /* page gone */ }
    const e = cropTo(expected, w, h), a2 = cropTo(actual, w, h);
    const bgR = e[0], bgG = e[1], bgB = e[2];
    let content = 0;
    const T = 64, tilesX = Math.ceil(w / T), tileDiff = new Array(tilesX * Math.ceil(h / T)).fill(0), tileTot = new Array(tileDiff.length).fill(0);
    for (let i = 0, px = 0; i < e.length; i += 4, px++) {
      const x = px % w, y = (px / w) | 0, t = ((y / T) | 0) * tilesX + ((x / T) | 0);
      tileTot[t]++;
      const eb = e[i] !== bgR || e[i + 1] !== bgG || e[i + 2] !== bgB;
      const ab = a2[i] !== bgR || a2[i + 1] !== bgG || a2[i + 2] !== bgB;
      if (eb || ab) content++;
      if (diff.data[i] === 255 && diff.data[i + 1] === 0 && diff.data[i + 2] === 0) tileDiff[t]++;
    }
    const worstTile = tileDiff.reduce((m, d, k) => Math.max(m, d / tileTot[k]), 0);
    const total = w * h;
    return { width: w, height: h, diffPixels, totalPixels: total, ratio: diffPixels / total, outDir: opts.outDir, stats: sceneStats(scene, domTextChars), svgBytes: Buffer.byteLength(svg), captureMs, contentRatio: diffPixels / Math.max(1, content), worstTile, drift };
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
  const [src, name = 'page', widthArg, heightArg, fontModeArg] = process.argv.slice(2);
  if (!src) {
    console.error('usage: tsx scripts/validate.ts <url|file.html> [name] [width] [height] [embed|outline|none]');
    process.exit(1);
  }
  const isUrl = /^https?:\/\//.test(src);
  const target = isUrl ? { url: src } : { url: pathToFileURL(resolve(src)).href };
  const r = await validate(target, {
    width: widthArg ? parseInt(widthArg, 10) : 1280,
    height: heightArg ? parseInt(heightArg, 10) : undefined,
    name,
    outDir: resolve('test/visual/__out__'),
    fontMode: (fontModeArg as 'embed' | 'outline' | 'none') || 'embed',
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
