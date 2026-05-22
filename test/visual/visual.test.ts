import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validate } from '../../scripts/validate.js';

const FIXTURES = resolve(__dirname, '../fixtures');
const OUT = resolve(__dirname, '__out__');

describe('visual regression', () => {
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
});
