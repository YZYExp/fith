import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'esbuild';

const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'];
const RASTER = pathToFileURL(resolve(__dirname, '../fixtures/raster-fallback.html')).href;
const SMOKE = pathToFileURL(resolve(__dirname, '../fixtures/smoke.html')).href;
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** The hooks a host that embeds fith uses: pictures for regions fith cannot draw, and font bytes it already holds. */
describe('host hooks of the in-page backend', () => {
  let browser: Browser;
  let code = '';
  beforeAll(async () => {
    code = (await build({ entryPoints: [resolve(__dirname, '../../src/backends/browser/index.ts')], bundle: true, format: 'iife', globalName: 'Fith', write: false, target: 'chrome110' })).outputFiles[0].text;
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ARGS });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  async function open(url: string): Promise<Page> {
    const page = await (await browser.newContext({ viewport: { width: 440, height: 360 } })).newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.addScriptTag({ content: code });
    return page;
  }

  it('rasterize is told which element and why, and its pixels are used and reported', async () => {
    const page = await open(RASTER);
    const out = await page.evaluate(async (pixel) => {
      const calls: { reason: string; tag: string | null; w: number }[] = [];
      const r = await (window as any).Fith.captureCurrentPageDetailed({
        width: 440,
        height: 360,
        domRasterFallback: false,
        rasterize: async (rect: { width: number }, _scale: number, info: { reason: string; element?: Element }) => {
          calls.push({ reason: info.reason, tag: info.element ? info.element.tagName : null, w: rect.width });
          return pixel;
        },
      });
      return { calls, svg: r.svg as string, report: r.report };
    }, PIXEL);
    expect(out.calls.length).toBeGreaterThan(0);
    expect(out.calls.every((c) => !!c.reason)).toBe(true);
    expect(out.calls.some((c) => c.tag === 'DIV')).toBe(true);
    expect(out.svg).toContain(PIXEL);
    expect(out.report.rasters.every((r: { filled: string }) => r.filled === 'screenshot')).toBe(true);
    expect(out.report.omitted).toEqual([]);
  }, 60_000);

  it('fonts replaces the document @font-face rules', async () => {
    const page = await open(SMOKE);
    const face = { family: 'HostFont', weight: '400', style: 'normal', src: 'data:font/woff2;base64,AAAA', format: 'woff2' };
    const [withFont, without] = await page.evaluate(async (f) => {
      const FH = (window as any).Fith;
      return [await FH.captureCurrentPage({ width: 420, height: 280, fonts: [f] }), await FH.captureCurrentPage({ width: 420, height: 280, fonts: [] })] as string[];
    }, face);
    expect(withFont).toContain("font-family:'HostFont'");
    expect(withFont).toContain('data:font/woff2;base64,AAAA');
    expect(without).not.toContain('@font-face');
  }, 60_000);

  it('a fonts function is asked once per used face, with the characters set in it', async () => {
    const page = await open(SMOKE);
    const out = await page.evaluate(async () => {
      const FH = (window as any).Fith;
      const reqs: { family: string; weight: string; style: string; chars: string }[] = [];
      const svg: string = await FH.captureCurrentPage({
        width: 420,
        height: 280,
        fonts: (r: any) => {
          reqs.push(r);
          return { family: r.family, weight: r.weight, style: r.style, src: 'data:font/woff2;base64,BBBB', format: 'woff2' };
        },
      });
      return { svg, reqs };
    });
    expect(out.reqs.length).toBeGreaterThan(0);
    const keys = out.reqs.map((r) => `${r.family.toLowerCase()}|${r.weight}|${r.style}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(out.reqs.every((r) => r.chars.length > 0 && new Set(r.chars).size === r.chars.length)).toBe(true);
    expect(out.svg).toContain('data:font/woff2;base64,BBBB');
  }, 60_000);

  it('a fonts function that throws or answers null leaves the family referenced by name', async () => {
    const page = await open(SMOKE);
    const svg: string = await page.evaluate(async () => {
      const FH = (window as any).Fith;
      let n = 0;
      return FH.captureCurrentPage({ width: 420, height: 280, fonts: () => { if (n++ % 2) throw new Error('no'); return null; } });
    });
    expect(svg).not.toContain('@font-face');
    expect(svg).toContain('<text');
  }, 60_000);
});
