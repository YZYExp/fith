import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { validate, serveDir } from '../../scripts/validate.js';

const OUT = resolve(__dirname, '__out__');

// A visually distinctive (monospace) font, embedded under a unique family with a
// sans-serif fallback. With embedding the SVG renders the mono font (matches the
// page); without it the SVG falls back to sans-serif (clearly different).
const MONO_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
  '/usr/share/fonts/truetype/freefont/FreeMono.ttf',
];

const html = `<!doctype html><html><head><style>
@font-face { font-family: 'FitTestMono'; src: url('./font.ttf') format('truetype'); }
body { margin: 0; background: #fff; }
.t { font-family: 'FitTestMono', sans-serif; font-size: 28px; color: #111; padding: 24px; line-height: 1.5; }
</style></head><body>
<div class="t">Embedded WWW iiii 12345<br>fitting-html font test</div>
</body></html>`;

describe('font embedding', () => {
  let base: { url: string; close: () => Promise<void> } | null = null;
  let fontPath = '';

  beforeAll(async () => {
    fontPath = MONO_CANDIDATES.find((p) => existsSync(p)) || '';
    if (!fontPath) return;
    const dir = mkdtempSync(join(tmpdir(), 'fh-font-'));
    copyFileSync(fontPath, join(dir, 'font.ttf'));
    writeFileSync(join(dir, 'index.html'), html);
    base = await serveDir(dir);
  });

  it('matches the source when @font-face is embedded', async () => {
    if (!fontPath || !base) return; // no suitable system font; skip
    const r = await validate({ url: base.url }, { width: 600, height: 160, name: 'webfont-embed', outDir: OUT, fontMode: 'embed' });
    expect(r.ratio).toBeLessThan(0.02);
  }, 60_000);

  it('diverges noticeably without embedding (proves embedding is doing the work)', async () => {
    if (!fontPath || !base) return;
    const r = await validate({ url: base.url }, { width: 600, height: 160, name: 'webfont-none', outDir: OUT, fontMode: 'none' });
    expect(r.ratio).toBeGreaterThan(0.03);
    await base.close();
  }, 60_000);
});
