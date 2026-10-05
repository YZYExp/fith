import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import sparticuz from '@sparticuz/chromium';
import { captureSourceHtml } from '../../src/core/capture/source-html.js';
import { renderDetailed } from '../../src/backends/node/playwright.js';

const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process'];
const FIXTURES = resolve(__dirname, '../fixtures');

const PAGE = `<!doctype html><html lang="en" class="theme"><head><title>t</title>
<style>.theme body{margin:0;font:14px sans-serif}.app .box{width:120px;height:40px;background:#d97757;color:#fff;padding:8px}
.app .icon{width:20px;height:20px;background:url(pix.png)}</style>
<link rel="preload" href="x.js" as="script"><script>document.title='mutated'</script></head>
<body onload="alert(1)"><div class="app"><div class="box" id="a">hello</div>
<input type="password" value="secret"><input type="text" id="t"><textarea id="ta"></textarea>
<canvas id="c" width="40" height="20"></canvas>
<div id="host"></div></div>
<script>
document.getElementById('t').value='typed';document.getElementById('ta').value='long text';
const g=document.getElementById('c').getContext('2d');g.fillStyle='#00f';g.fillRect(0,0,40,20);
const sr=document.getElementById('host').attachShadow({mode:'open'});sr.innerHTML='<style>p{color:red}</style><p>in shadow</p>';
</script></body></html>`;

async function withPage<T>(html: string, fn: (page: import('playwright').Page, b: Browser) => Promise<T>) {
  const execPath = process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
  const browser = await chromium.launch({ executablePath: execPath, args: ARGS });
  try {
    const page = await (await browser.newContext({ viewport: { width: 400, height: 300 } })).newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return await fn(page, browser);
  } finally {
    await browser.close();
  }
}

describe('captureSourceHtml', () => {
  it('produces a sanitized, re-openable snapshot', async () => {
    const html = await withPage(PAGE, (page) => page.evaluate(captureSourceHtml, undefined));
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onload');
    expect(html).not.toContain('rel="preload"');
    expect(html).not.toContain('secret'); // password value dropped
    expect(html).toContain('value="typed"');
    expect(html).toContain('long text');
    expect(html).toContain('<base href=');
    expect(html).toContain('name="fith-capture"');
    expect(html).toContain('data-fith-inlined');
    expect(html).toContain('<img src="data:image/png'); // canvas pixels
    expect(html).toContain('shadowrootmode="open"');
    expect(html).toContain('in shadow');
  }, 60_000);

  it('re-renders to the same pixels as the original page', async () => {
    const fixture = readFileSync(resolve(FIXTURES, 'sidebar-rail.html'), 'utf8');
    const execPath = process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
    const browser = await chromium.launch({ executablePath: execPath, args: ARGS });
    try {
      const ctx = await browser.newContext({ viewport: { width: 260, height: 700 } });
      const a = await ctx.newPage();
      await a.setContent(fixture, { waitUntil: 'load' });
      const snapshot = await a.evaluate(captureSourceHtml, undefined);
      const want = PNG.sync.read(await a.screenshot());
      const b = await ctx.newPage();
      await b.setContent(snapshot, { waitUntil: 'load' });
      const got = PNG.sync.read(await b.screenshot());
      const diff = pixelmatch(want.data, got.data, undefined, 260, 700, { threshold: 0.1 });
      expect(diff / (260 * 700)).toBeLessThan(0.001);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it('keeps the ancestor chain when snapshotting a single element', async () => {
    const html = await withPage(PAGE, (page) =>
      page.evaluate((fn) => (0, eval)(`(${fn})`)(document.getElementById('a')), captureSourceHtml.toString()),
    );
    expect(html).toContain('class="theme"'); // html classes preserved for selectors
    expect(html).toContain('class="app"');
    expect(html).toContain('id="a"');
    expect(html).not.toContain('<canvas');
    expect(html).toContain('&quot;scope&quot;:&quot;element&quot;');
    expect(html).not.toContain('onload');
  }, 60_000);

  it('is returned by renderDetailed only when requested', async () => {
    const execPath = process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
    const off = await renderDetailed({ html: PAGE }, { width: 400, height: 300, executablePath: execPath, launchArgs: ARGS });
    expect(off.sourceHtml).toBeUndefined();
    const on = await renderDetailed(
      { html: PAGE },
      { width: 400, height: 300, executablePath: execPath, launchArgs: ARGS, captureSourceHtml: true },
    );
    expect(on.sourceHtml).toContain('fith-capture');
    expect(on.svg).toContain('<svg');
  }, 60_000);
});
