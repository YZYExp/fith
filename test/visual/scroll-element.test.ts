import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import sparticuz from '@sparticuz/chromium';
import { build } from 'esbuild';

const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/scroll-sidebar.html')).href;
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'];
let browser: Browser;
let page: Page;
let bundle: string;

/**
 * Picking an element nested in an app shell (position:fixed sidebar ⇒ <body> is 0px
 * tall) used to export an EMPTY svg because ancestors were culled by their own box,
 * and a picked scroll container only exported its visible window.
 */
beforeAll(async () => {
  const out = await build({
    entryPoints: [resolve(__dirname, '../../src/backends/browser/index.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'FittingHtml',
    write: false,
    target: 'chrome110',
  });
  bundle = out.outputFiles[0].text;
  const execPath = process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
  browser = await chromium.launch({ executablePath: execPath, args: ARGS });
  page = await (await browser.newContext({ viewport: { width: 300, height: 450 } })).newPage();
  await page.goto(FIXTURE);
  await page.addScriptTag({ content: bundle });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

const capture = (selector: string, opts: Record<string, unknown> = {}) =>
  page.evaluate(
    ([sel, o]) => (window as any).FittingHtml.captureElement(document.querySelector(sel as string), o),
    [selector, opts] as const,
  ) as Promise<string>;
const sessions = (svg: string) => new Set(svg.match(/Session \d+-\d+/g) ?? []).size;
const viewBoxHeight = (svg: string) => parseFloat(svg.match(/viewBox="[^"]*? [^"]*? [^"]*? ([\d.]+)"/)![1]);

describe('element export from a scrolling app-shell sidebar', () => {
  it('exports an element nested under a zero-height <body> (was an empty SVG)', async () => {
    const svg = await capture('.search');
    expect(svg).toContain('Search');
    expect(svg.length).toBeGreaterThan(300);
  }, 60_000);

  it('exports the whole scrolled list when the scroll container is picked', async () => {
    const svg = await capture('#nav');
    expect(sessions(svg)).toBe(144);
    expect(viewBoxHeight(svg)).toBeGreaterThan(4000);
    // fade-out labels stay vector text with an SVG mask, not bitmaps
    expect(svg).toContain('<mask');
    expect(svg).not.toContain('data:image/png');
  }, 60_000);

  it('exports the whole list when an ancestor of the scroller is picked', async () => {
    const svg = await capture('#frame-peek-popover');
    expect(sessions(svg)).toBe(144);
    expect(svg).toContain('YZ · Max'); // sibling footer is kept below the unfurled list
  }, 60_000);

  it('restores layout and scroll position after the capture', async () => {
    await capture('#frame-peek-popover');
    const m = await page.evaluate(() => {
      const n = document.getElementById('nav')!;
      return { st: n.scrollTop, ch: n.clientHeight, style: n.getAttribute('style') };
    });
    expect(m.st).toBe(700);
    expect(m.ch).toBe(334);
    expect(m.style).toBeNull();
  }, 60_000);

  it('can be opted out (visible window only)', async () => {
    const svg = await capture('#nav', { unfurlScrollContainers: false });
    expect(sessions(svg)).toBeLessThan(40);
  }, 60_000);
});
