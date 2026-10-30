import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { build } from 'esbuild';

const OUT = resolve(__dirname, '__out__');
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'];

const CARD = `<!doctype html><html><body style="margin:0;background:#eef">
  <div style="height:40px"></div>
  <div id="card" style="margin-left:30px;width:300px;height:120px;box-sizing:border-box;padding:16px;border-radius:14px;
       background:linear-gradient(90deg,rgb(255,0,0),rgb(0,0,255));color:#fff;font:600 20px sans-serif;border:3px solid rgb(20,20,20)">
    Hello from the frame
    <p id="sub" style="margin:8px 0 0;font:14px sans-serif">second line</p>
  </div></body></html>`;

/**
 * The editor that embeds fith lives in one document and draws a work in a same-origin <iframe>. The
 * capture must therefore read the element's own document and window (`instanceof HTMLElement` is false
 * across realms, and `document` is the host's), not the globals of the page it was loaded into.
 */
describe('capture an element that lives in another document', () => {
  let browser: Browser;
  let code = '';

  beforeAll(async () => {
    const bundle = await build({
      entryPoints: [resolve(__dirname, '../../src/backends/browser/index.ts')],
      bundle: true,
      format: 'iife',
      globalName: 'FittingHtml',
      write: false,
      target: 'chrome110',
    });
    code = bundle.outputFiles[0].text;
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ARGS });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it('captures a card inside an iframe as vector text and shapes that match its screenshot', async () => {
    const ctx = await browser.newContext({ viewport: { width: 600, height: 400 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.setContent(
      `<!doctype html><body style="margin:0"><div style="height:30px"></div><iframe id="f" style="border:0;width:500px;height:300px;margin-left:20px"></iframe></body>`,
    );
    await page.evaluate((html) => {
      (document.getElementById('f') as HTMLIFrameElement).srcdoc = html;
    }, CARD);
    await page.waitForFunction(() => !!(document.getElementById('f') as HTMLIFrameElement).contentDocument?.getElementById('card'));
    const frame = page.frames().find((f) => f !== page.mainFrame())!;
    const expected = await frame.locator('#card').screenshot();

    await page.addScriptTag({ content: code });
    const svg: string = await page.evaluate(async () => {
      const el = (document.getElementById('f') as HTMLIFrameElement).contentDocument!.getElementById('card')!;
      // @ts-expect-error injected global
      return await FittingHtml.captureElement(el, { fontMode: 'none' });
    });

    expect(svg).toContain('<text');
    expect(svg).toContain('Hello from the frame');
    expect(svg).toContain('second line');
    expect(svg).toContain('linearGradient');
    expect(svg).not.toContain('data:image/png'); // nothing fell back to a picture
    expect(svg).toMatch(/viewBox="[\d.\s-]*\b300\s+120"/);

    mkdirSync(OUT, { recursive: true });
    const svgPath = resolve(OUT, 'cross-document.svg');
    writeFileSync(svgPath, svg);
    const svgPage = await ctx.newPage();
    await svgPage.setViewportSize({ width: 300, height: 120 });
    await svgPage.goto('file://' + svgPath);
    const actual = await svgPage.screenshot({ clip: { x: 0, y: 0, width: 300, height: 120 } });
    const a = PNG.sync.read(expected);
    const b = PNG.sync.read(actual);
    expect([b.width, b.height]).toEqual([a.width, a.height]);
    const px = pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: 0.1 });
    expect(px / (a.width * a.height)).toBeLessThan(0.03);
    await ctx.close();
  }, 60_000);

  it('re-renders an unvectorizable element of an iframe with the DOM rasterizer', async () => {
    const ctx = await browser.newContext({ viewport: { width: 600, height: 400 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.setContent(
      `<!doctype html><body style="margin:0"><iframe id="f" style="border:0;width:500px;height:300px"></iframe></body>`,
    );
    await page.evaluate((html) => {
      (document.getElementById('f') as HTMLIFrameElement).srcdoc = html;
    }, `<!doctype html><body style="margin:0;background:#fff"><div id="wrap" style="padding:40px">
      <div id="tilt" style="width:160px;height:80px;background:rgb(0,128,0);color:#fff;font:700 18px sans-serif;
        transform:perspective(200px) rotateY(25deg)">tilted
        <svg width="40" height="30" style="display:block"><rect width="40" height="30" fill="rgb(255,0,0)"/></svg></div></div></body>`);
    await page.waitForFunction(() => !!(document.getElementById('f') as HTMLIFrameElement).contentDocument?.getElementById('wrap'));
    await page.addScriptTag({ content: code });
    const out = await page.evaluate(async () => {
      const el = (document.getElementById('f') as HTMLIFrameElement).contentDocument!.getElementById('wrap')!;
      // @ts-expect-error injected global
      return await FittingHtml.captureElementDetailed(el, { fontMode: 'none' });
    });
    expect(out.svg).toContain('data:image/png');
    // the inline <svg> inside the picture must survive: `instanceof SVGElement` is false across realms
    const red: number = await page.evaluate(async (svg: string) => {
      const href = /href="(data:image\/png;base64,[^"]+)"/.exec(svg)![1];
      const img = new Image();
      img.src = href;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60 && d[i + 3] > 200) n++;
      return n;
    }, out.svg);
    expect(red).toBeGreaterThan(200);
    const dom = out.report.rasters.filter((r: { filled: string }) => r.filled === 'dom');
    expect(dom.length).toBeGreaterThan(0);
    expect(out.report.omitted).toEqual([]);
    await ctx.close();
  }, 60_000);
});
