/**
 * Regressions found by running the bench corpus (bench/) against real sites
 * (nodejs.org, pypi.org). Each pins one capture behaviour with a pixel diff AND
 * a structural assertion so a silent fall-back to raster/fallback fonts fails.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { resolve, join } from 'node:path';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { validate, serveDir } from '../../scripts/validate.js';

const FIXTURES = resolve(__dirname, '../fixtures');
const OUT = resolve(__dirname, '__out__');

describe('real-world regressions', () => {
  it('keeps the first glyph position after collapsed leading space and preserves <pre> indentation', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'code-whitespace.html')).href },
      { width: 640, height: 260, name: 'code-whitespace', outDir: OUT, fontMode: 'none' },
    );
    const svg = readFileSync(resolve(OUT, 'code-whitespace.svg'), 'utf8');
    expect(svg).not.toContain('data:image/png');
    // runs of spaces inside white-space:pre text are kept verbatim (not collapsed/trimmed)
    expect(svg).toContain('xml:space="preserve"> createServer </text>');
    expect(r.ratio).toBeLessThan(0.01);
  }, 60_000);

  it('vectorizes filter:blur glows (pseudo + leaf box) as feGaussianBlur', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'blur-glow.html')).href },
      { width: 480, height: 320, name: 'blur-glow', outDir: OUT, fontMode: 'none' },
    );
    const svg = readFileSync(resolve(OUT, 'blur-glow.svg'), 'utf8');
    expect(svg.match(/<feGaussianBlur stdDeviation="(40|24)"/g)?.length).toBe(2);
    expect(svg).not.toContain('data:image/png');
    expect(r.ratio).toBeLessThan(0.01);
  }, 60_000);

  it('vectorizes sharp inset shadows, rounds <img>, hides sr-only text, descends into 0x0 panes', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'layout-quirks.html')).href },
      { width: 640, height: 300, name: 'layout-quirks', outDir: OUT, fontMode: 'none' },
    );
    const svg = readFileSync(resolve(OUT, 'layout-quirks.svg'), 'utf8');
    expect(svg.match(/data:image\/png/g)?.length).toBe(1); // only the <img>; inset shadows are not rastered
    expect(svg).toContain('fill-rule="evenodd"'); // inset shadow drawn as a vector ring
    expect(svg).not.toContain('screen-reader only'); // visually-hidden text is not painted
    expect(svg).toContain('r="25"'); // svg inside a 0x0 pane is captured
    expect(r.ratio).toBeLessThan(0.005);
  }, 60_000);

  it('vectorizes styled text <input> (value, placeholder, password, alignment) instead of rastering', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'form-inputs.html')).href },
      { width: 340, height: 260, name: 'form-inputs', outDir: OUT, fontMode: 'none' },
    );
    const svg = readFileSync(resolve(OUT, 'form-inputs.svg'), 'utf8');
    expect(svg).not.toContain('data:image/png');
    for (const t of ['you@example.com', 'Search…', 'centered', 'right aligned']) expect(svg).toContain(t);
    expect(svg).not.toContain('hunter2'); // password stays masked
    expect(svg).toContain('\u2022\u2022\u2022\u2022\u2022\u2022\u2022');
    // glyph edges of five text lines: ~0.9 % locally, 1.23 % with the CI runner's fonts — the structural
    // assertions above are the vector guarantee, the pixel bound only catches gross misplacement
    expect(r.ratio).toBeLessThan(0.02);
  }, 60_000);

  it('paints z-indexed descendants in their nearest stacking context; body bg stays under negative z; fixed scrim is vector', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'stacking-order.html')).href },
      { width: 480, height: 300, name: 'stacking-order', outDir: OUT, fontMode: 'none' },
    );
    const svg = readFileSync(resolve(OUT, 'stacking-order.svg'), 'utf8');
    // text must come after the green art box in paint order (z-index:2 beats the later z:auto sibling)
    expect(svg.indexOf('Headline above art')).toBeGreaterThan(svg.indexOf('fill="rgb(34, 170, 119)"'));
    expect(svg).toContain('rgb(255, 153, 0)'); // opaque colours ending in `, 0)` (blue=0) are not transparent
    expect(svg).not.toContain('data:image/png');
    expect(r.ratio).toBeLessThan(0.005);
  }, 60_000);

  it('vectorizes radial / alpha / px-stop / corner-keyword / multi-layer gradients (no raster)', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'gradients-advanced.html')).href },
      { width: 840, height: 270, name: 'gradients-advanced', outDir: OUT, fontMode: 'none' },
    );
    const svg = readFileSync(resolve(OUT, 'gradients-advanced.svg'), 'utf8');
    expect(svg).not.toContain('data:image/png');
    expect(svg.match(/<radialGradient/g)?.length).toBeGreaterThanOrEqual(4);
    expect(svg.match(/<linearGradient/g)?.length).toBeGreaterThanOrEqual(4);
    expect(r.ratio).toBeLessThan(0.02);
  }, 60_000);

  it('vectorizes conic / repeating gradients and clip-path basic shapes (no raster)', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'clip-conic-repeat.html')).href },
      { width: 840, height: 290, name: 'clip-conic-repeat', outDir: OUT, fontMode: 'none' },
    );
    const svg = readFileSync(resolve(OUT, 'clip-conic-repeat.svg'), 'utf8');
    expect(svg).not.toContain('data:image/png');
    expect(svg).toContain('spreadMethod="repeat"');
    expect(svg.match(/<clipPath/g)?.length).toBeGreaterThanOrEqual(4); // polygon, circle, inset, ellipse
    expect(svg.match(/<path d="M[\d.]+,[\d.]+L/g)?.length).toBeGreaterThan(150); // conic slice fans
    expect(r.ratio).toBeLessThan(0.03);
  }, 60_000);

  it('embeds @font-face from a cross-origin stylesheet the page cannot read (CDN without CORS on the CSS)', async () => {
    const font = [
      '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
      '/usr/share/fonts/truetype/freefont/FreeMono.ttf',
    ].find((p) => existsSync(p));
    if (!font) return;
    const fontBytes = readFileSync(font);
    // "CDN": serves the stylesheet WITHOUT CORS headers, the font WITH them (as real font CDNs must)
    const cdn = createServer((req, res) => {
      if (req.url!.endsWith('.css')) {
        res.setHeader('Content-Type', 'text/css');
        res.end(`@font-face{font-family:'CdnMono';src:url('/mono.ttf') format('truetype')}`);
      } else {
        res.setHeader('Content-Type', 'font/ttf');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(fontBytes);
      }
    });
    await new Promise<void>((r) => cdn.listen(0, '127.0.0.1', () => r()));
    const cdnPort = (cdn.address() as any).port;
    const dir = mkdtempSync(join(tmpdir(), 'fh-cdn-'));
    writeFileSync(
      join(dir, 'index.html'),
      `<!doctype html><link rel="stylesheet" href="http://127.0.0.1:${cdnPort}/site.css"><style>body{margin:0;font:28px/1.5 'CdnMono',sans-serif;padding:24px;font-feature-settings:"liga" 0}</style><body>Embedded WWW iiii 12345</body>`,
    );
    const app = await serveDir(dir);
    try {
      const r = await validate({ url: app.url }, { width: 600, height: 100, name: 'cdn-font', outDir: OUT, fontMode: 'embed' });
      const svg = readFileSync(resolve(OUT, 'cdn-font.svg'), 'utf8');
      expect(svg).toContain("font-family:'CdnMono'");
      expect(svg).toContain('font-feature-settings:'); // glyph-selection CSS travels with the text
      expect(r.ratio).toBeLessThan(0.02);
    } finally {
      await app.close();
      await new Promise<void>((r) => cdn.close(() => r()));
    }
  }, 60_000);

  it('vectorizes blurred inset shadows (feGaussianBlur on a clipped ring, no raster)', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'inset-blur.html')).href },
      { width: 700, height: 150, name: 'inset-blur', outDir: OUT, fontMode: 'none' },
    );
    const svg = readFileSync(resolve(OUT, 'inset-blur.svg'), 'utf8');
    expect(svg).not.toContain('data:image/png');
    expect(svg.match(/<feGaussianBlur/g)?.length).toBeGreaterThanOrEqual(5);
    expect(r.ratio).toBeLessThan(0.02);
  }, 60_000);

  it('keeps rotated/skewed subtrees vector as <g transform> (text stays text, nested + clipped)', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'transform-2d.html')).href },
      { width: 560, height: 260, name: 'transform-2d', outDir: OUT, fontMode: 'none' },
    );
    const svg = readFileSync(resolve(OUT, 'transform-2d.svg'), 'utf8');
    expect(svg).not.toContain('data:image/png'); // previously the whole subtree was a screenshot
    expect(svg.match(/<g transform="matrix\(/g)?.length).toBeGreaterThanOrEqual(6);
    for (const t of ['Badge', 'Card', 'nested', 'Skew', 'clipped', 'Vertical']) expect(svg).toContain(`>${t}</text>`);
    expect(r.ratio).toBeLessThan(0.02);
  }, 60_000);

  it('vectorizes empty-content flow pseudo-elements (caret borders, dots, bars, clearfix) instead of rastering the host', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'pseudo-flow.html')).href },
      { width: 420, height: 380, name: 'pseudo-flow', outDir: OUT, fontMode: 'none' },
    );
    const svg = readFileSync(resolve(OUT, 'pseudo-flow.svg'), 'utf8');
    expect(svg).not.toContain('data:image/png');
    for (const t of ['Dropdown', 'Status online', 'Underlined title', 'Arrow tag label']) expect(svg).toContain(t);
    expect(r.ratio).toBeLessThan(0.01);
  }, 60_000);

  it('clamps huge uniform radii (9999px pills) to half the shorter side instead of a lens', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'pill-radius.html')).href },
      { width: 300, height: 140, name: 'pill-radius', outDir: OUT, fontMode: 'none' },
    );
    expect(r.ratio).toBeLessThan(0.006);
  }, 60_000);

  it('vectorizes radial and multi-layer (add / intersect) mask-image as SVG masks, no raster', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'mask-layers.html')).href },
      { width: 780, height: 150, name: 'mask-layers', outDir: OUT, fontMode: 'none' },
    );
    const svg = readFileSync(resolve(OUT, 'mask-layers.svg'), 'utf8');
    expect(svg).not.toContain('data:image/png');
    expect(svg.match(/<mask /g)?.length).toBeGreaterThanOrEqual(4);
    expect(svg.match(/<radialGradient/g)?.length).toBeGreaterThanOrEqual(3);
    expect(r.ratio).toBeLessThan(0.02);
  }, 60_000);

  it('embeds readable 2D <canvas> bitmaps as <image> (content box, borders stay vector)', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'canvas-2d.html')).href },
      { width: 440, height: 200, name: 'canvas-2d', outDir: OUT, fontMode: 'none' },
    );
    const svg = readFileSync(resolve(OUT, 'canvas-2d.svg'), 'utf8');
    expect(svg.match(/<image /g)?.length).toBe(2);
    expect(r.ratio).toBeLessThan(0.01);
  }, 60_000);

  it('renders sized / tiled / mixed url+gradient background layers as <pattern> tiles (no raster)', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'bg-layers.html')).href },
      { width: 620, height: 260, name: 'bg-layers', outDir: OUT, fontMode: 'none' },
    );
    const svg = readFileSync(resolve(OUT, 'bg-layers.svg'), 'utf8');
    expect(svg).not.toContain('data:image/png');
    expect(svg.match(/<pattern /g)?.length).toBeGreaterThanOrEqual(5);
    expect(r.ratio).toBeLessThan(0.03);
  }, 60_000);

  it('accepts `linear-gradient(in srgb, …)` (same interpolation as SVG)', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'gradient-in-srgb.html')).href },
      { width: 240, height: 120, name: 'gradient-in-srgb', outDir: OUT, fontMode: 'none' },
    );
    const svg = readFileSync(resolve(OUT, 'gradient-in-srgb.svg'), 'utf8');
    expect(svg).toContain('<linearGradient');
    expect(svg).not.toContain('data:image/png');
    expect(r.ratio).toBeLessThan(0.005);
  }, 60_000);

  it('keeps CSS filter functions and mix-blend-mode on whole subtrees as grouped SVG filters/blend (text stays vector)', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'filter-blend-groups.html')).href },
      { width: 760, height: 260, name: 'filter-blend-groups', outDir: OUT, fontMode: 'none' },
    );
    const svg = readFileSync(resolve(OUT, 'filter-blend-groups.svg'), 'utf8');
    expect(svg).not.toContain('data:image/png'); // previously every filtered/blended subtree was a screenshot
    expect(svg).toContain('<feColorMatrix');
    expect(svg).toContain('<feDropShadow');
    expect(svg).toContain('mix-blend-mode:multiply');
    for (const t of ['gray', 'sepia', 'shadow', 'blur', 'multiply']) expect(svg).toContain(`>${t}</text>`);
    expect(r.ratio).toBeLessThan(0.03);
  }, 60_000);

  it('treats 3D transforms without perspective as orthographic 2D (translateZ no-op, rotateX foreshortening), still vector', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'transform-3d-flat.html')).href },
      { width: 260, height: 260, name: 'transform-3d-flat', outDir: OUT, fontMode: 'none' },
    );
    const svg = readFileSync(resolve(OUT, 'transform-3d-flat.svg'), 'utf8');
    expect(svg).not.toContain('data:image/png');
    for (const t of ['translateZ', 'translate3d', 'rotateX ortho']) expect(svg).toContain(`>${t}</text>`);
    expect(r.ratio).toBeLessThan(0.02);
  }, 60_000);

  describe('webfont in an external stylesheet', () => {
    let base: { url: string; close: () => Promise<void> } | null = null;
    afterAll(async () => base?.close());

    it('resolves @font-face url() against the stylesheet, not the page', async () => {
      const font = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
        '/usr/share/fonts/truetype/freefont/FreeMono.ttf',
      ].find((p) => existsSync(p));
      if (!font) return;
      const dir = mkdtempSync(join(tmpdir(), 'fh-cssfont-'));
      mkdirSync(join(dir, 'static/css'), { recursive: true });
      mkdirSync(join(dir, 'static/media'), { recursive: true });
      copyFileSync(font, join(dir, 'static/media/mono.ttf'));
      // url is relative to the CSS file (../media/), exactly like Next.js / webpack output
      writeFileSync(
        join(dir, 'static/css/app.css'),
        `@media all{@font-face{font-family:'RelMono';src:url('../media/mono.ttf') format('truetype')}}` +
          `body{margin:0;font:28px/1.5 'RelMono',sans-serif;padding:24px}`,
      );
      writeFileSync(join(dir, 'index.html'), `<!doctype html><link rel="stylesheet" href="/static/css/app.css"><body>Embedded WWW iiii 12345</body>`);
      base = await serveDir(dir);
      const r = await validate({ url: base.url }, { width: 600, height: 100, name: 'css-relative-font', outDir: OUT, fontMode: 'embed' });
      const svg = readFileSync(resolve(OUT, 'css-relative-font.svg'), 'utf8');
      expect(svg).toContain("font-family:'RelMono'");
      expect(svg).toContain('@font-face');
      expect(r.ratio).toBeLessThan(0.02);
    }, 60_000);
  });
});
