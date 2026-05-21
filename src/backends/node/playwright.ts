import { chromium, type Browser, type Page } from 'playwright';
import { captureScene } from '../../core/capture/capture.js';
import { emitSvg } from '../../core/emit/svg.js';
import { createOutliner } from '../../core/emit/outline.js';
import { systemFontLoader } from './fonts.js';
import type { Scene } from '../../core/ir/types.js';

export interface RenderOptions {
  width: number;
  height?: number;
  deviceScaleFactor?: number;
  /** Path to a Chromium executable; if omitted, Playwright's bundled browser is used. */
  executablePath?: string;
  launchArgs?: string[];
  /** Extra wait (ms) after load for late layout/fonts. */
  settleMs?: number;
  /**
   * 'embed' (default) inlines @font-face fonts as base64; 'outline' converts text
   * to glyph <path>s (no font dependency); 'none' references families by name.
   */
  fontMode?: 'embed' | 'outline' | 'none';
}

export type RenderInput = { html: string } | { url: string } | { page: Page };

async function withinViewport(page: Page, width: number, height: number | undefined, dsr: number) {
  await page.setViewportSize({ width, height: height || 800 });
  await page.evaluate(async () => {
    if (document.fonts) await document.fonts.ready;
  });
  if (!height) {
    const full = await page.evaluate(() =>
      Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
    );
    await page.setViewportSize({ width, height: full });
  }
}

async function captureAndEmit(page: Page, opts: RenderOptions): Promise<string> {
  const dsr = opts.deviceScaleFactor || 1;
  await withinViewport(page, opts.width, opts.height, dsr);
  if (opts.settleMs) await page.waitForTimeout(opts.settleMs);

  // Dev transpilers (tsx/esbuild keepNames) reference a `__name` helper inside
  // the serialized capture function; provide a no-op so it resolves in-page.
  await page.evaluate(() => {
    const g = globalThis as any;
    if (!g.__name) g.__name = (t: any) => t;
  });

  const scene: Scene = await page.evaluate(captureScene, {
    width: opts.width,
    height: opts.height,
    deviceScaleFactor: dsr,
    // outline mode still needs @font-face bytes to outline webfont glyphs
    fontMode: (opts.fontMode === 'none' ? 'none' : 'embed') as 'embed' | 'none',
    collectGlyphX: opts.fontMode === 'outline',
  });

  // Resolve raster targets via screenshots.
  const byId = new Map(scene.rasterTargets.map((t) => [t.id, t]));
  for (const node of scene.nodes) {
    if (node.kind !== 'raster') continue;
    const t = byId.get(node.id);
    if (!t || t.width <= 0 || t.height <= 0) continue;
    try {
      const buf = await page.screenshot({
        clip: { x: t.x, y: t.y, width: t.width, height: t.height },
        type: 'png',
      });
      node.href = 'data:image/png;base64,' + buf.toString('base64');
    } catch {
      node.href = null;
    }
  }

  if (opts.fontMode === 'outline') {
    const outline = createOutliner(scene.fonts, systemFontLoader());
    scene.fonts = []; // glyphs become paths; no @font-face <style> needed
    return emitSvg(scene, { outline });
  }
  return emitSvg(scene);
}

export async function renderToSvg(input: RenderInput, opts: RenderOptions): Promise<string> {
  if ('page' in input) {
    return captureAndEmit(input.page, opts);
  }

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      executablePath: opts.executablePath,
      args: opts.launchArgs || ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });
    const context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height || 800 },
      deviceScaleFactor: opts.deviceScaleFactor || 1,
    });
    const page = await context.newPage();
    if ('url' in input) {
      await page.goto(input.url, { waitUntil: 'networkidle' });
    } else {
      await page.setContent(input.html, { waitUntil: 'networkidle' });
    }
    return await captureAndEmit(page, opts);
  } finally {
    if (browser) await browser.close();
  }
}
