import { resolveCorsImages } from './cors-images.js';
import { collectExternalCss } from './external-css.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { captureScene } from '../../core/capture/capture.js';
import { captureSourceHtml } from '../../core/capture/source-html.js';
import { emitSvg, type EmitOptions } from '../../core/emit/svg.js';
import { createOutliner } from '../../core/emit/outline.js';
import { systemFallbackLoader, systemFontLoader } from './fonts.js';
import { findDiffRegions } from './diff-patch.js';
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
  /**
   * When true, a full-page screenshot is embedded as a base layer (z-order 0)
   * beneath all vector content. Any CSS that the DOM walk fails to vectorize
   * remains visible via the screenshot rather than silently disappearing.
   * Increases file size by ~150–800 KB (one embedded PNG). Default false.
   */
  guaranteeFloor?: boolean;
  /**
   * When true, performs a single diff pass after SVG generation: renders the SVG
   * back in Chromium, pixel-diffs it against the original page screenshot, and
   * patches regions that diverge beyond 5% with a raster screenshot of the original.
   * Eliminates most visual mismatches without a full screenshot base layer.
   * Works best with fontMode 'embed' or 'outline'; may produce false positives
   * with 'none' if system fonts differ between the two renders. Default false.
   */
  diffPatch?: boolean;
  /**
   * When true, also return a standalone HTML snapshot of the rendered page (DOM +
   * inlined CSS) via `renderDetailed`, for bug reports and fixtures. The snapshot
   * contains the page's content — only enable it when sharing is acceptable.
   */
  captureSourceHtml?: boolean;
}

export interface RenderResult {
  svg: string;
  /** Present when `captureSourceHtml` was requested. */
  sourceHtml?: string;
}

export type RenderInput = { html: string } | { url: string } | { page: Page };

async function withinViewport(page: Page, width: number, height: number | undefined) {
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

/**
 * Renders the SVG into a fresh browser page, pixel-diffs against the original
 * screenshot, and inserts raster patches for regions that diverge beyond 5%.
 * Mutates `scene.nodes` and returns the re-emitted SVG (or the original if
 * no patches were needed).
 */
async function applyDiffPatch(
  page: Page,
  scene: Scene,
  svg: string,
  emitOpts: EmitOptions,
): Promise<string> {
  // Reuse the base layer screenshot when available; otherwise take a fresh one.
  const originalBuf = scene.baseLayer
    ? Buffer.from(scene.baseLayer.split(',')[1], 'base64')
    : await page.screenshot({ clip: { x: 0, y: 0, width: scene.width, height: scene.height }, type: 'png' });

  // Write SVG to a temp file so the browser can load it via file:// URL (avoids
  // data-URI size limits and encoding issues with complex SVGs).
  const tmp = join(tmpdir(), `fh-${randomUUID()}.svg`);
  writeFileSync(tmp, svg);

  const svgPage = await page.context().newPage();
  let svgBuf: Buffer;
  try {
    await svgPage.setViewportSize({ width: scene.width, height: scene.height });
    await svgPage.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle' });
    await svgPage.evaluate(async () => {
      if (document.fonts) await document.fonts.ready;
    });
    svgBuf = await svgPage.screenshot({
      clip: { x: 0, y: 0, width: scene.width, height: scene.height },
      type: 'png',
    });
  } finally {
    await svgPage.close();
    try { unlinkSync(tmp); } catch { /* ignore cleanup failure */ }
  }

  const badRects = findDiffRegions(originalBuf, svgBuf, scene.width, scene.height);
  if (badRects.length === 0) return svg;

  // Screenshot the original page at each bad region and push as raster patches.
  // Patches are appended to scene.nodes so they paint on top of everything.
  let patched = 0;
  for (const rect of badRects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    try {
      const buf = await page.screenshot({ clip: rect, type: 'png' });
      scene.nodes.push({
        kind: 'raster',
        id: `dp${patched}`,
        rect,
        opacity: 1,
        href: 'data:image/png;base64,' + buf.toString('base64'),
        reason: 'diff-patch',
      });
      patched++;
    } catch { /* skip failed patch regions */ }
  }

  return patched > 0 ? emitSvg(scene, emitOpts) : svg;
}

async function captureAndEmit(page: Page, opts: RenderOptions): Promise<RenderResult> {
  const dsr = opts.deviceScaleFactor || 1;
  await withinViewport(page, opts.width, opts.height);
  if (opts.settleMs) await page.waitForTimeout(opts.settleMs);

  // Dev transpilers (tsx/esbuild keepNames) reference a `__name` helper inside
  // the serialized capture function; provide a no-op so it resolves in-page.
  await page.evaluate(() => {
    const g = globalThis as any;
    if (!g.__name) g.__name = (t: any) => t;
  });

  // Snapshot the source first: capture may temporarily touch the DOM.
  const sourceHtml = opts.captureSourceHtml
    ? await page.evaluate(captureSourceHtml, undefined)
    : undefined;

  const scene: Scene = await page.evaluate(captureScene, {
    width: opts.width,
    height: opts.height,
    deviceScaleFactor: dsr,
    // outline mode still needs @font-face bytes to outline webfont glyphs
    fontMode: (opts.fontMode === 'none' ? 'none' : 'embed') as 'embed' | 'none',
    collectGlyphX: opts.fontMode === 'outline',
    externalCss: opts.fontMode === 'none' ? undefined : await collectExternalCss(page),
  });

  // Full-page base-layer screenshot (guarantees visual floor; optional).
  if (opts.guaranteeFloor) {
    const vp = page.viewportSize()!;
    const buf = await page.screenshot({
      clip: { x: 0, y: 0, width: vp.width, height: vp.height },
      type: 'png',
    });
    scene.baseLayer = 'data:image/png;base64,' + buf.toString('base64');
  }

  // Prefer the real bytes of cross-origin <img>s over screenshots of them.
  await resolveCorsImages(page, scene);

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

  // Build emit options (outline mode converts text to glyph paths).
  const emitOpts: EmitOptions = {};
  if (opts.fontMode === 'outline') {
    emitOpts.outline = createOutliner(scene.fonts, systemFontLoader(), systemFallbackLoader());
    scene.fonts = []; // glyphs become paths; no @font-face <style> needed
  }

  let svg = emitSvg(scene, emitOpts);

  // Single-pass diff patch: render SVG back in Chromium, find divergent regions,
  // patch them with screenshots of the original page.
  if (opts.diffPatch) {
    svg = await applyDiffPatch(page, scene, svg, emitOpts);
  }

  return { svg, sourceHtml };
}

/** Like `renderToSvg`, but also returns the optional source-HTML snapshot. */
export async function renderDetailed(input: RenderInput, opts: RenderOptions): Promise<RenderResult> {
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

export async function renderToSvg(input: RenderInput, opts: RenderOptions): Promise<string> {
  return (await renderDetailed(input, opts)).svg;
}
