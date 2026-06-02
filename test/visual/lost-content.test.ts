import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from 'playwright';
import sparticuz from '@sparticuz/chromium';
import { build } from 'esbuild';

const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process'];
const FIXTURE = pathToFileURL(resolve(__dirname, '../fixtures/lost-content.html')).href;

/**
 * Lost-content detector. Instead of pixel-diffing, this asserts a structural
 * invariant: every visible, text-bearing DOM node must be represented by at
 * least one emitted Scene node covering its area. A "covering" node is a text,
 * raster, image, or inline-svg node — a plain box (background only) does NOT
 * count, since it doesn't carry the text. This catches the whole class of
 * silent-content-loss bugs (visibility:hidden children, content-visibility,
 * subtree sibling drops, …) as a hard CI failure with a minimal repro.
 */
async function bundleBrowser(): Promise<string> {
  const out = await build({
    entryPoints: [resolve(__dirname, '../../src/backends/browser/index.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'FittingHtml',
    write: false,
    target: 'chrome110',
  });
  return out.outputFiles[0].text;
}

// Runs in-page: returns text runs that have no covering Scene node.
const DETECTOR = `(scene) => {
  const COVER = new Set(['text', 'raster', 'image', 'inline-svg']);
  const covers = scene.nodes.filter((n) => COVER.has(n.kind)).map((n) => n.rect);
  const lost = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let tn;
  while ((tn = walker.nextNode())) {
    const raw = tn.textContent || '';
    if (!raw.trim()) continue;
    const parent = tn.parentElement;
    if (!parent) continue;
    const pcs = getComputedStyle(parent);
    if (pcs.display === 'none' || pcs.visibility !== 'visible') continue;
    const range = document.createRange();
    range.selectNodeContents(tn);
    for (const r of Array.from(range.getClientRects())) {
      if (r.width < 1 || r.height < 1) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const covered = covers.some(
        (c) => cx >= c.x - 1 && cx <= c.x + c.width + 1 && cy >= c.y - 1 && cy <= c.y + c.height + 1,
      );
      if (!covered) lost.push({ text: raw.trim().slice(0, 40), x: Math.round(r.left), y: Math.round(r.top) });
    }
  }
  return lost;
}`;

describe('lost-content detector', () => {
  it(
    'emits a covering node for every visible text run (full page)',
    async () => {
      const code = await bundleBrowser();
      const execPath = process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
      const browser: Browser = await chromium.launch({ executablePath: execPath, args: ARGS });
      try {
        const ctx = await browser.newContext({ viewport: { width: 700, height: 600 }, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        await page.goto(FIXTURE, { waitUntil: 'networkidle' });
        await page.evaluate(async () => {
          if (document.fonts) await document.fonts.ready;
        });
        await page.addScriptTag({ content: code });

        const lost = await page.evaluate(
          async ({ detector }) => {
            // @ts-expect-error injected global
            const scene = await FittingHtml.captureScene({
              width: document.documentElement.clientWidth,
              height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
              deviceScaleFactor: 1,
              fontMode: 'none',
              captureScrollableContent: true,
              containerRasterFallback: false,
            });
            return (0, eval)(detector)(scene);
          },
          { detector: DETECTOR },
        );

        if (lost.length) console.error('LOST text runs (full page):', JSON.stringify(lost, null, 2));
        expect(lost).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    90_000,
  );

  it(
    'captures content inside MUI Collapse-style overflow:hidden wrappers (all list items)',
    async () => {
      const code = await bundleBrowser();
      const execPath = process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
      const browser: Browser = await chromium.launch({ executablePath: execPath, args: ARGS });
      try {
        const ctx = await browser.newContext({ viewport: { width: 700, height: 800 }, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        const fixture = pathToFileURL(resolve(__dirname, '../fixtures/mui-collapse-list.html')).href;
        await page.goto(fixture, { waitUntil: 'networkidle' });
        await page.evaluate(async () => {
          if (document.fonts) await document.fonts.ready;
        });
        await page.addScriptTag({ content: code });

        // Find text nodes whose own rect falls entirely OUTSIDE their clip.
        // These would be clipped to nothing by SVG's clip-path — invisible.
        const clippedAway = await page.evaluate(async () => {
          // @ts-expect-error injected global
          const scene = await FittingHtml.captureScene({
            width: document.documentElement.clientWidth,
            height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
            deviceScaleFactor: 1,
            fontMode: 'none',
            captureScrollableContent: true,
            containerRasterFallback: false,
          });
          const lost: { text: string; reason: string }[] = [];
          for (const n of scene.nodes as any[]) {
            if (n.kind !== 'text' || !n.clip) continue;
            const text = n.lines.map((l: any) => l.text).join(' ').trim();
            if (!text) continue;
            const cx = n.rect.x + n.rect.width / 2;
            const cy = n.rect.y + n.rect.height / 2;
            const inside =
              cx >= n.clip.x && cx <= n.clip.x + n.clip.width &&
              cy >= n.clip.y && cy <= n.clip.y + n.clip.height;
            if (!inside) lost.push({ text: text.slice(0, 40), reason: 'text center outside clip' });
          }
          return lost;
        });

        if (clippedAway.length) console.error('CLIPPED OUT (mui-collapse):', JSON.stringify(clippedAway, null, 2));
        expect(clippedAway).toEqual([]);
      } finally {
        await browser.close();
      }
    },
    90_000,
  );

  it(
    'includes overlapping sibling text when a single element is selected',
    async () => {
      const code = await bundleBrowser();
      const execPath = process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
      const browser: Browser = await chromium.launch({ executablePath: execPath, args: ARGS });
      try {
        const ctx = await browser.newContext({ viewport: { width: 700, height: 600 }, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        await page.goto(FIXTURE, { waitUntil: 'networkidle' });
        await page.evaluate(async () => {
          if (document.fonts) await document.fonts.ready;
        });
        await page.addScriptTag({ content: code });

        // Select ONLY the button. Its sibling label ("Save changes") visually
        // overlaps the button but is not a DOM descendant — it must still appear.
        const texts = await page.evaluate(async () => {
          // @ts-expect-error injected global
          const scene = await FittingHtml.captureScene(
            {
              width: 0,
              height: 0,
              deviceScaleFactor: 1,
              fontMode: 'none',
              captureScrollableContent: true,
              containerRasterFallback: false,
            },
            document.querySelector('.overlay-btn'),
          );
          return scene.nodes
            .filter((n: any) => n.kind === 'text')
            .flatMap((n: any) => n.lines.map((l: any) => l.text))
            .join(' ');
        });

        expect(texts).toContain('Save changes');
      } finally {
        await browser.close();
      }
    },
    90_000,
  );
});
