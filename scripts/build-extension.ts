/** Bundle the MV3 extension into dist/extension/. */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const outdir = resolve('dist/extension');
mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: {
    content: resolve('src/backends/extension/content.ts'),
    background: resolve('src/backends/extension/background.ts'),
  },
  bundle: true,
  format: 'esm',
  target: 'chrome110',
  outdir,
  logLevel: 'info',
});

copyFileSync(resolve('src/backends/extension/manifest.json'), resolve(outdir, 'manifest.json'));
console.error('extension bundled to', outdir);
