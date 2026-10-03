/** Bundle the MV3 extension into dist/extension/ (or a given outdir). */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const src = (f: string) => resolve('src/backends/extension', f);

/** Static files copied verbatim into the bundle (HTML pages + manifest). */
export const COPIED_FILES = ['manifest.json', 'popup.html', 'viewer.html', 'ui.css'];

/**
 * Build the extension. `content.js` is injected via chrome.scripting and must be
 * a classic (IIFE) script; the rest load as ES modules. Returns the output dir.
 */
export async function buildExtension(outdir = resolve('dist/extension')): Promise<string> {
  mkdirSync(outdir, { recursive: true });

  await build({
    entryPoints: { content: src('content.ts') },
    bundle: true,
    format: 'iife',
    target: 'chrome110',
    outdir,
    logLevel: 'silent',
  });

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
    logLevel: 'silent',
  });

  for (const f of COPIED_FILES) copyFileSync(src(f), resolve(outdir, f));
  return outdir;
}

// Run as a script: build into dist/extension and log.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  buildExtension()
    .then((outdir) => console.error('extension bundled to', outdir))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
