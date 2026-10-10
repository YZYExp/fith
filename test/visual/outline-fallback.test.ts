import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import opentype from 'opentype.js';
import { validate, serveDir } from '../../scripts/validate.js';
import { acceptsSubstitute, readFont } from '../../src/backends/node/fonts.js';

const OUT = resolve(__dirname, '__out__');
const FIXTURES = resolve(__dirname, '../fixtures');

const TTF_CANDIDATES = [
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
];

const hasCjkFont = (() => {
  try {
    return execFileSync('fc-list', [':lang=zh', 'family'], { encoding: 'utf8' }).trim().length > 0;
  } catch {
    return false;
  }
})();

describe('outline font resolution (unit)', () => {
  it('accepts a fontconfig substitute only where Chromium would', () => {
    // fc-match answers "Noto Serif CJK SC" with e.g. Inter when it is absent
    expect(acceptsSubstitute('Noto Serif CJK SC', ['Inter'])).toBe(false);
    expect(acceptsSubstitute('Georgia', ['DejaVu Serif'])).toBe(false);
    expect(acceptsSubstitute('Inter', ['Inter'])).toBe(true);
    expect(acceptsSubstitute('Arial', ['Liberation Sans'])).toBe(true);
    expect(acceptsSubstitute('Times New Roman', ['Liberation Serif'])).toBe(true);
    expect(acceptsSubstitute('serif', ['DejaVu Serif'])).toBe(true);
    expect(acceptsSubstitute('WenQuanYi Zen Hei', ['文泉驿正黑', 'WenQuanYi Zen Hei'])).toBe(true);
  });

  it('extracts a face from a TrueType collection (.ttc, as CJK system fonts ship)', () => {
    const ttf = TTF_CANDIDATES.find((p) => existsSync(p));
    if (!ttf) return; // no system font to wrap; skip
    // Wrap the TTF in a one-face collection: TTC table offsets are file-absolute.
    const font = readFileSync(ttf);
    const header = Buffer.alloc(16);
    header.write('ttcf', 0, 'latin1');
    header.writeUInt32BE(0x00010000, 4);
    header.writeUInt32BE(1, 8);
    header.writeUInt32BE(16, 12);
    const body = Buffer.from(font);
    const tables = body.readUInt16BE(4);
    for (let t = 0; t < tables; t++) body.writeUInt32BE(body.readUInt32BE(12 + 16 * t + 8) + 16, 12 + 16 * t + 8);
    const file = join(mkdtempSync(join(tmpdir(), 'fh-ttc-')), 'wrapped.ttc');
    writeFileSync(file, Buffer.concat([header, body]));

    const parsed = opentype.parse(readFont(file, 0));
    expect(parsed.charToGlyph('A').index).not.toBe(0);
    expect(parsed.charToGlyph('A').getPath(0, 0, 20).toPathData(2)).not.toBe('');
  });
});

describe('outline mode: per-glyph font fallback (visual)', () => {
  let server: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    server = await serveDir(FIXTURES);
  });
  afterAll(async () => {
    await server?.close();
  });

  it('outlines with the fonts Chromium actually used — no substitutes, no .notdef boxes', async () => {
    const r = await validate(
      { url: server.url + 'outline-font-fallback.html' },
      { width: 800, height: 300, name: 'outline-font-fallback', outDir: OUT, fontMode: 'outline' },
    );
    const svg = readFileSync(join(OUT, 'outline-font-fallback.svg'), 'utf8');
    // Latin lines are always coverable, so they must be outlined (not left as <text>)
    expect(svg).not.toMatch(/<text[^>]*>[^<]*(Keep the|Mixed stacks|metric-compatible)/);
    if (hasCjkFont) {
      // with a CJK system font every glyph is outlined; before the fix CJK became tofu
      expect(svg).not.toContain('<text');
      expect(r.ratio).toBeLessThan(0.01);
    } else {
      // without one, CJK lines stay <text> rather than being drawn as .notdef
      expect(r.ratio).toBeLessThan(0.03);
    }
  }, 90_000);
});
