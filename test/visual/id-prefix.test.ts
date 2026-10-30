import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderToSvg } from '../../src/backends/node/playwright.js';
import { emitSvg } from '../../src/core/emit/svg.js';
import type { Scene } from '../../src/core/ir/types.js';

const GRADIENTS = pathToFileURL(resolve(__dirname, '../fixtures/gradients-advanced.html')).href;
const ids = (svg: string) => [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const refs = (svg: string) => [...svg.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].map((m) => m[1] ?? m[2]);

describe('idPrefix', () => {
  it('prefixes every generated id and every reference to it', async () => {
    const render = (idPrefix?: string) => renderToSvg({ url: GRADIENTS }, { width: 640, fontMode: 'none', idPrefix, executablePath: process.env.CHROMIUM_PATH });
    const [plain, a, b] = [await render(), await render('one-'), await render('two_')];

    expect(ids(plain).length).toBeGreaterThan(3);
    expect(ids(a).length).toBe(ids(plain).length);
    expect(ids(a).every((id) => id.startsWith('one-'))).toBe(true);
    // every reference points at an id the same SVG defines
    for (const svg of [a, b]) expect(refs(svg).every((r) => ids(svg).includes(r))).toBe(true);
    // two SVGs of one page can sit in one document
    expect(ids(a).filter((id) => ids(b).includes(id))).toEqual([]);
    // the default is unchanged
    expect(ids(plain)[0]).toMatch(/^d\d+$/);
  }, 90_000);

  it('rejects a prefix that is not a valid id start', () => {
    const scene = { width: 1, height: 1, deviceScaleFactor: 1, background: '', nodes: [], rasterTargets: [], fonts: [] } as unknown as Scene;
    expect(() => emitSvg(scene, { idPrefix: '1bad' })).toThrow(/idPrefix/);
    expect(() => emitSvg(scene, { idPrefix: 'a b' })).toThrow(/idPrefix/);
    expect(() => emitSvg(scene, { idPrefix: 'ok-1_' })).not.toThrow();
  });
});
