import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validate } from '../../scripts/validate.js';

const FIXTURES = resolve(__dirname, '../fixtures');
const OUT = resolve(__dirname, '__out__');

describe('visual regression', () => {
  it('compares settled viewport transitions after expanding to full-page height', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'viewport-transition.html')).href },
      { width: 420, name: 'viewport-transition', outDir: OUT },
    );
    expect(r.height).toBe(1200);
    expect(r.ratio).toBeLessThan(0.001);
  }, 60_000);

  it('respects invisible and partially transparent pseudo-element overlays', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'pseudo-visibility.html')).href },
      { width: 420, height: 300, name: 'pseudo-visibility', outDir: OUT },
    );
    expect(r.ratio).toBeLessThan(0.005);
  }, 60_000);

  it('uses text fill color and clips gradient backgrounds to glyphs', async () => {
    const r = await validate(
      { url: pathToFileURL(resolve(FIXTURES, 'text-fill.html')).href },
      { width: 640, height: 220, name: 'text-fill', outDir: OUT },
    );
    expect(r.ratio).toBeLessThan(0.005);
  }, 60_000);

  it(
    'renders the smoke fixture within the fidelity threshold',
    async () => {
      const r = await validate(
        { url: pathToFileURL(resolve(FIXTURES, 'smoke.html')).href },
        { width: 420, height: 280, name: 'smoke', outDir: OUT },
      );
      expect(r.ratio).toBeLessThan(0.01);
    },
    60_000,
  );

  it(
    'vectorizes linear gradients faithfully',
    async () => {
      const r = await validate(
        { url: pathToFileURL(resolve(FIXTURES, 'gradients.html')).href },
        { width: 560, height: 300, name: 'gradients', outDir: OUT },
      );
      expect(r.ratio).toBeLessThan(0.01);
    },
    60_000,
  );

  it(
    'outlines text to glyph paths (system fonts via fontconfig)',
    async () => {
      const r = await validate(
        { url: pathToFileURL(resolve(FIXTURES, 'smoke.html')).href },
        { width: 420, height: 280, name: 'smoke-outline', outDir: OUT, fontMode: 'outline' },
      );
      const svg = readFileSync(resolve(OUT, 'smoke-outline.svg'), 'utf8');
      expect(svg).not.toContain('<text');
      expect(svg).toContain('<path');
      // outline glyphs lack hinting, so a small edge-AA delta vs rendered text is expected
      expect(r.ratio).toBeLessThan(0.05);
    },
    60_000,
  );

  it(
    'keeps vectorizing content when containers carry box-level effects (no blank page)',
    async () => {
      const r = await validate(
        { url: pathToFileURL(resolve(FIXTURES, 'container-fallback.html')).href },
        { width: 420, height: 260, name: 'container-fallback', outDir: OUT },
      );
      const svg = readFileSync(resolve(OUT, 'container-fallback.svg'), 'utf8');
      // content must be present as vector text, not collapsed into one raster
      expect(svg).toContain('Container Fallback');
      expect((svg.match(/<text/g) || []).length).toBeGreaterThan(2);
      void r;
    },
    60_000,
  );

  it(
    'normalizes modern color functions (oklch/oklab/…) to sRGB so the SVG is portable',
    async () => {
      const r = await validate(
        { url: pathToFileURL(resolve(FIXTURES, 'oklch.html')).href },
        { width: 400, height: 220, name: 'oklch', outDir: OUT },
      );
      const svg = readFileSync(resolve(OUT, 'oklch.svg'), 'utf8');
      // no color *values* (attributes or style) may use CSS Color 4 functions
      expect(svg).not.toMatch(/(?:"|:)\s*(?:oklch|oklab|lab|lch|hwb|color)\(/);
      expect(r.ratio).toBeLessThan(0.02);
    },
    60_000,
  );

  it(
    'applies text-transform so rendered text matches (MUI uppercase buttons/tabs)',
    async () => {
      const r = await validate(
        { url: pathToFileURL(resolve(FIXTURES, 'text-transform.html')).href },
        { width: 360, height: 140, name: 'text-transform', outDir: OUT },
      );
      const svg = readFileSync(resolve(OUT, 'text-transform.svg'), 'utf8');
      expect(svg).toContain('NEW REPORT');
      expect(svg).toContain('shouting text');
      expect(svg).toContain('Hello World Title');
      expect(svg).toContain('Normal Case');
      expect(r.ratio).toBeLessThan(0.02);
    },
    60_000,
  );

  it(
    'renders a complex Ant Design-style data table with badges and actions',
    async () => {
      const r = await validate(
        { url: pathToFileURL(resolve(FIXTURES, 'antd-table.html')).href },
        { width: 1200, height: 600, name: 'antd-table', outDir: OUT },
      );
      const svg = readFileSync(resolve(OUT, 'antd-table.svg'), 'utf8');
      // Key content: headers, status badges, order IDs, customer names
      expect(svg).toContain('Order Management');
      expect(svg).toContain('Orders (247)');
      expect(svg).toContain('Completed');
      expect(svg).toContain('Alice Johnson');
      expect(svg).toContain('#ORD-20241');
      // Must have many text nodes (headers + rows + pagination)
      expect((svg.match(/<text/g) || []).length).toBeGreaterThan(20);
      expect(r.ratio).toBeLessThan(0.08);
    },
    90_000,
  );

  it(
    'renders a MUI-style dashboard with sidebar, stat cards, and activity feed',
    async () => {
      const r = await validate(
        { url: pathToFileURL(resolve(FIXTURES, 'mui-dashboard.html')).href },
        { width: 1280, height: 900, name: 'mui-dashboard', outDir: OUT },
      );
      const svg = readFileSync(resolve(OUT, 'mui-dashboard.svg'), 'utf8');
      // Key structural elements — stat-label uses text-transform:uppercase so
      // "Total Revenue" appears as "TOTAL REVENUE" in the SVG
      expect(svg).toContain('Dashboard');
      expect(svg).toContain('TOTAL REVENUE');
      expect(svg).toContain('$48,352');
      expect(svg).toContain('Recent Activity');
      expect(svg).toContain('Top Products');
      expect(svg).toContain('Sales by Channel');
      expect((svg.match(/<text/g) || []).length).toBeGreaterThan(10);
      // Gradient stat cards and progress bars must not collapse the page
      expect(r.ratio).toBeLessThan(0.10);
    },
    90_000,
  );

  it(
    'vectorizes decorative pseudo-element overlays instead of rastering the host (text stays vector)',
    async () => {
      const r = await validate(
        { url: pathToFileURL(resolve(FIXTURES, 'pseudo-overlay.html')).href },
        { width: 640, height: 260, name: 'pseudo-overlay', outDir: OUT },
      );
      const svg = readFileSync(resolve(OUT, 'pseudo-overlay.svg'), 'utf8');
      // The host text must survive as vector <text>, not be swallowed by a raster.
      expect(svg).toContain('Mountain View');
      expect(svg).toContain('System Status');
      // The ::before scrim is a linear-gradient overlay → emitted as a gradient.
      expect(svg).toContain('<linearGradient');
      // The decorative pseudos must NOT have forced a raster <image> fallback.
      expect(svg).not.toContain('<image');
      expect(r.ratio).toBeLessThan(0.05);
    },
    90_000,
  );

  it(
    'captures text decorations and gradient text (text-styles fixture)',
    async () => {
      const r = await validate(
        { url: pathToFileURL(resolve(FIXTURES, 'text-styles.html')).href },
        { width: 800, height: 700, name: 'text-styles', outDir: OUT },
      );
      const svg = readFileSync(resolve(OUT, 'text-styles.svg'), 'utf8');
      // Gradient text pattern (background-clip:text)
      expect(svg).toContain('Design Systems');
      // Text decoration nodes must be present
      expect(svg).toContain('standard underline');
      expect(svg).toContain('red underline');
      // decorationColor should appear when it differs from text color
      expect(svg).toMatch(/text-decoration="underline rgb\(239,\s*68,\s*68\)"|text-decoration="underline #ef4444"/);
      // Gradient text should reference a linearGradient
      expect(svg).toContain('<linearGradient');
      expect(r.ratio).toBeLessThan(0.06);
    },
    90_000,
  );
});
