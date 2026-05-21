import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
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
});
