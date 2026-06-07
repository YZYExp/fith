/**
 * Real-world integration tests. These tests navigate to external URLs and
 * validate that the capture+emit pipeline produces a non-empty, structurally
 * correct SVG for complex, production-grade pages.
 *
 * Run with: REALWORLD_TESTS=1 npx vitest run test/visual/realworld.test.ts
 *
 * Tests are skipped unless REALWORLD_TESTS=1 is set, so they never run in
 * normal CI (they're flaky by nature — network-dependent, content may change).
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import sparticuz from '@sparticuz/chromium';
import { captureScene } from '../../src/core/capture/capture.js';
import { emitSvg } from '../../src/core/emit/svg.js';

const ENABLED = process.env.REALWORLD_TESTS === '1';
const OUT = resolve(__dirname, '__out__/realworld');
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process', '--ignore-certificate-errors'];

/** Minimal end-to-end: navigate → capture → emit → structural checks. */
async function captureUrl(
  url: string,
  name: string,
  opts: { width?: number; height?: number; settleMs?: number } = {},
): Promise<{ svg: string; nodeCount: number; textCount: number; rasterCount: number }> {
  const execPath = process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
  const width = opts.width ?? 1280;
  const height = opts.height ?? 800;
  const browser: Browser = await chromium.launch({ executablePath: execPath, args: ARGS });
  try {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    if (opts.settleMs) await page.waitForTimeout(opts.settleMs);
    await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; });

    // polyfill for dev transpiler helpers
    await page.evaluate(() => {
      const g = globalThis as any;
      if (!g.__name) g.__name = (t: any) => t;
    });

    const scene = await page.evaluate(captureScene, {
      width,
      height,
      deviceScaleFactor: 1,
      fontMode: 'none',
      captureScrollableContent: true,
      containerRasterFallback: true,
    } as any);

    // resolve raster targets via screenshots
    const byId = new Map(scene.rasterTargets.map((t) => [t.id, t]));
    for (const node of scene.nodes) {
      if (node.kind !== 'raster') continue;
      const t = byId.get(node.id);
      if (!t || t.width <= 0 || t.height <= 0) continue;
      try {
        const buf = await page.screenshot({ clip: { x: t.x, y: t.y, width: t.width, height: t.height } });
        node.href = 'data:image/png;base64,' + buf.toString('base64');
      } catch { node.href = null; }
    }

    const svg = emitSvg(scene);

    mkdirSync(OUT, { recursive: true });
    writeFileSync(resolve(OUT, `${name}.svg`), svg);

    const nodeCount = scene.nodes.length;
    const textCount = scene.nodes.filter((n) => n.kind === 'text').length;
    const rasterCount = scene.nodes.filter((n) => n.kind === 'raster').length;
    return { svg, nodeCount, textCount, rasterCount };
  } finally {
    await browser.close();
  }
}

// ─── helper to extract all text from SVG text nodes ───────────────────────

function svgTexts(svg: string): string {
  const matches = svg.match(/>[^<]+</g) || [];
  return matches.map((m) => m.slice(1, -1)).join(' ');
}

// ─── Test suite ────────────────────────────────────────────────────────────

describe('real-world URL capture', () => {
  it.skipIf(!ENABLED)(
    'GitHub repo page (vitejs/vite)',
    async () => {
      const { svg, nodeCount, textCount } = await captureUrl(
        'https://github.com/vitejs/vite',
        'github-vitejs-vite',
        { width: 1280, height: 900 },
      );
      const texts = svgTexts(svg);
      expect(svg).toContain('<svg');
      expect(nodeCount).toBeGreaterThan(20);
      expect(textCount).toBeGreaterThan(5);
      // GitHub always shows repo name, star count, topics
      expect(texts.toLowerCase()).toMatch(/vite|vitejs/);
      // no CSS Color 4 functions must survive into the output
      expect(svg).not.toMatch(/:\s*(?:oklch|oklab|lab|lch|hwb)\(/);
      console.log(`[github] nodes=${nodeCount} text=${textCount} svgBytes=${svg.length}`);
    },
    120_000,
  );

  it.skipIf(!ENABLED)(
    'Google Search results page',
    async () => {
      const { svg, nodeCount, textCount } = await captureUrl(
        'https://www.google.com/search?q=html+to+svg+converter',
        'google-search',
        { width: 1280, height: 900, settleMs: 1000 },
      );
      expect(svg).toContain('<svg');
      // Google may show a minimal page under bot-detection; just ensure capture completes
      expect(nodeCount).toBeGreaterThan(2);
      expect(textCount).toBeGreaterThanOrEqual(0);
      expect(svg).not.toMatch(/:\s*(?:oklch|oklab|lab|lch|hwb)\(/);
      console.log(`[google-search] nodes=${nodeCount} text=${textCount} svgBytes=${svg.length}`);
    },
    120_000,
  );

  it.skipIf(!ENABLED)(
    'Google Images search page',
    async () => {
      const { svg, nodeCount, textCount } = await captureUrl(
        'https://www.google.com/search?q=gradient+ui+design&tbm=isch',
        'google-images',
        { width: 1280, height: 900, settleMs: 2000 },
      );
      expect(svg).toContain('<svg');
      // Google Images may show a minimal page under bot-detection; just ensure capture completes
      expect(nodeCount).toBeGreaterThan(2);
      const imageCount = (svg.match(/<image /g) || []).length;
      expect(imageCount).toBeGreaterThan(0);
      console.log(`[google-images] nodes=${nodeCount} text=${textCount} images=${imageCount} svgBytes=${svg.length}`);
    },
    120_000,
  );

  it.skipIf(!ENABLED)(
    'MUI Material UI homepage',
    async () => {
      const { svg, nodeCount, textCount } = await captureUrl(
        'https://mui.com/material-ui/getting-started/',
        'mui-homepage',
        { width: 1280, height: 900, settleMs: 1500 },
      );
      const texts = svgTexts(svg);
      expect(svg).toContain('<svg');
      expect(nodeCount).toBeGreaterThan(30);
      expect(textCount).toBeGreaterThan(10);
      expect(texts.toLowerCase()).toMatch(/mui|material/i);
      expect(svg).not.toMatch(/:\s*(?:oklch|oklab|lab|lch|hwb)\(/);
      console.log(`[mui] nodes=${nodeCount} text=${textCount} svgBytes=${svg.length}`);
    },
    120_000,
  );

  it.skipIf(!ENABLED)(
    'Ant Design Button component docs page',
    async () => {
      const { svg, nodeCount, textCount } = await captureUrl(
        'https://ant.design/components/button/',
        'antd-button',
        { width: 1280, height: 900, settleMs: 2000 },
      );
      const texts = svgTexts(svg);
      expect(svg).toContain('<svg');
      expect(nodeCount).toBeGreaterThan(30);
      expect(textCount).toBeGreaterThan(10);
      expect(texts.toLowerCase()).toMatch(/button|ant/i);
      expect(svg).not.toMatch(/:\s*(?:oklch|oklab|lab|lch|hwb)\(/);
      console.log(`[antd] nodes=${nodeCount} text=${textCount} svgBytes=${svg.length}`);
    },
    120_000,
  );

  it.skipIf(!ENABLED)(
    'MDN Web Docs — CSS reference page',
    async () => {
      const { svg, nodeCount, textCount } = await captureUrl(
        'https://developer.mozilla.org/en-US/docs/Web/CSS/background',
        'mdn-css-background',
        { width: 1280, height: 900 },
      );
      const texts = svgTexts(svg);
      expect(svg).toContain('<svg');
      expect(nodeCount).toBeGreaterThan(30);
      expect(textCount).toBeGreaterThan(15);
      expect(texts.toLowerCase()).toMatch(/background|css/i);
      expect(svg).not.toMatch(/:\s*(?:oklch|oklab|lab|lch|hwb)\(/);
      console.log(`[mdn] nodes=${nodeCount} text=${textCount} svgBytes=${svg.length}`);
    },
    120_000,
  );

  it.skipIf(!ENABLED)(
    'React documentation homepage',
    async () => {
      const { svg, nodeCount, textCount } = await captureUrl(
        'https://react.dev/',
        'react-dev',
        { width: 1280, height: 900, settleMs: 1000 },
      );
      const texts = svgTexts(svg);
      expect(svg).toContain('<svg');
      expect(nodeCount).toBeGreaterThanOrEqual(10);
      expect(textCount).toBeGreaterThan(2);
      expect(texts.toLowerCase()).toMatch(/react/i);
      expect(svg).not.toMatch(/:\s*(?:oklch|oklab|lab|lch|hwb)\(/);
      console.log(`[react.dev] nodes=${nodeCount} text=${textCount} svgBytes=${svg.length}`);
    },
    120_000,
  );

  it.skipIf(!ENABLED)(
    'Tailwind CSS documentation page',
    async () => {
      const { svg, nodeCount, textCount } = await captureUrl(
        'https://tailwindcss.com/docs/background-color',
        'tailwind-docs',
        { width: 1280, height: 900, settleMs: 1000 },
      );
      const texts = svgTexts(svg);
      expect(svg).toContain('<svg');
      expect(nodeCount).toBeGreaterThan(20);
      expect(textCount).toBeGreaterThan(10);
      expect(texts.toLowerCase()).toMatch(/background|tailwind/i);
      expect(svg).not.toMatch(/:\s*(?:oklch|oklab|lab|lch|hwb)\(/);
      console.log(`[tailwind] nodes=${nodeCount} text=${textCount} svgBytes=${svg.length}`);
    },
    120_000,
  );
});
