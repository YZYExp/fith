/**
 * Regressions found by running the bench corpus (bench/) against real sites
 * (nodejs.org, pypi.org). Each pins one capture behaviour with a pixel diff AND
 * a structural assertion so a silent fall-back to raster/fallback fonts fails.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { resolve, join } from 'node:path';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
