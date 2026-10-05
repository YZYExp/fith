import { readFileSync, writeFileSync } from 'node:fs';
import { renderDetailed, type RenderInput } from './playwright.js';

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
    else if (a === '-o') out.out = argv[++i];
    else positional.push(a);
  }
  return { out, positional };
}

async function main() {
  const { out, positional } = parseArgs(process.argv.slice(2));
  const src = positional[0];
  if (!src) {
    console.error(
      'usage: fitting-html <input.html|url> -o out.svg [--width N] [--height N] [--scale N] [--font-mode embed|outline|none] [--source-html page.html]',
    );
    process.exit(1);
  }
  const isUrl = /^https?:\/\//.test(src);
  const input: RenderInput = isUrl ? { url: src } : { html: readFileSync(src, 'utf8') };
  const { svg, sourceHtml } = await renderDetailed(input, {
    width: out.width ? parseInt(out.width, 10) : 1280,
    height: out.height ? parseInt(out.height, 10) : undefined,
    deviceScaleFactor: out.scale ? parseFloat(out.scale) : 1,
    fontMode: (out['font-mode'] as 'embed' | 'outline' | 'none') || 'embed',
    executablePath: process.env.CHROMIUM_PATH || undefined,
    captureSourceHtml: !!out['source-html'],
  });
  const dest = out.out || 'out.svg';
  writeFileSync(dest, svg);
  console.error(`wrote ${dest} (${svg.length} bytes)`);
  if (sourceHtml !== undefined) {
    writeFileSync(out['source-html'], sourceHtml);
    console.error(`wrote ${out['source-html']} (${sourceHtml.length} bytes, source HTML snapshot — contains page content)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
