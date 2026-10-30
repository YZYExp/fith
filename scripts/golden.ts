/**
 * Golden SVGs for refactoring: render every test fixture through the public Node API and write the
 * normalised SVG text to <outdir>. Run it before and after a change and diff the two folders —
 * `pnpm golden /tmp/before` … `pnpm golden /tmp/after && diff -r /tmp/before /tmp/after`.
 *
 * The output depends on the machine's fonts and Chromium, so goldens are compared between runs on the
 * SAME machine and are not committed. Embedded raster data and font bytes are replaced by their length
 * and hash so a diff stays readable.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderToSvg } from '../src/backends/node/playwright.js';

const out = resolve(process.argv[2] ?? 'golden-out');
const only = process.argv.slice(3);
const SKIP = new Set(['viewport-transition']); // animates, so two runs differ
const dir = resolve('test/fixtures');
mkdirSync(out, { recursive: true });

const digest = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 10);
const normalise = (svg: string) =>
  svg.replace(/data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)/g, (_m, mime: string, b64: string) => `data:${mime};base64,#${b64.length}:${digest(b64)}`);

const files = readdirSync(dir).filter((f) => f.endsWith('.html') && !SKIP.has(basename(f, '.html')) && (!only.length || only.includes(basename(f, '.html'))));
for (const f of files) {
  for (const fontMode of ['embed', 'none'] as const) {
    const svg = await renderToSvg({ url: pathToFileURL(resolve(dir, f)).href }, {
      width: 800,
      fontMode,
      executablePath: process.env.CHROMIUM_PATH,
      settleMs: 200,
    });
    writeFileSync(resolve(out, `${basename(f, '.html')}.${fontMode}.svg`), normalise(svg));
  }
  console.error('golden', f);
}
