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
});
