import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validate } from '../../scripts/validate.js';

const FIXTURES = resolve(__dirname, '../fixtures');
const OUT = resolve(__dirname, '__out__');

describe('image capture', () => {
  it(
    'captures all images and preserves paint order',
    async () => {
      const r = await validate(
        { url: pathToFileURL(resolve(FIXTURES, 'images.html')).href },
        { width: 480, height: 600, name: 'images', outDir: OUT },
      );
      const svg = readFileSync(resolve(OUT, 'images.svg'), 'utf8');
      // All data-URI images should decode without issues → low pixel diff
      expect(r.ratio).toBeLessThan(0.05);
      // Images must appear in the SVG output
      expect(svg).toMatch(/<image /);
      // All 5 sequence images must be present (5 colored squares)
      const imageCount = (svg.match(/<image /g) || []).length;
      expect(imageCount).toBeGreaterThanOrEqual(5);
    },
    60_000,
  );
});
