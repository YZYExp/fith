/** Bundle the MV3 extension into dist/extension/. */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const src = (f: string) => resolve('src/backends/extension', f);
const outdir = resolve('dist/extension');
mkdirSync(outdir, { recursive: true });

// content.js is injected via chrome.scripting.executeScript → must be a classic
// (IIFE) script, not an ES module.
await build({
  entryPoints: { content: src('content.ts') },
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  outdir,
  logLevel: 'info',
});

// background (service_worker type:module), popup + viewer (loaded as modules).
await build({
  entryPoints: {
    background: src('background.ts'),
    popup: src('popup.ts'),
    viewer: src('viewer.ts'),
  },
  bundle: true,
  format: 'esm',
  target: 'chrome110',
  outdir,
  logLevel: 'info',
});

for (const f of ['manifest.json', 'popup.html', 'viewer.html']) copyFileSync(src(f), resolve(outdir, f));
console.error('extension bundled to', outdir);
