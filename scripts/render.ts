/**
 * Dev/validation helper: render an HTML file or URL to SVG using the bundled
 * @sparticuz/chromium binary (the network policy blocks Playwright's CDN).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import sparticuz from '@sparticuz/chromium';
import { renderToSvg, type RenderInput } from '../src/backends/node/playwright.js';

export async function chromiumPath(): Promise<string> {
  return process.env.CHROMIUM_PATH || (await sparticuz.executablePath());
}

async function main() {
  const [src, dest = 'out.svg', widthArg, heightArg] = process.argv.slice(2);
  if (!src) {
    console.error('usage: tsx scripts/render.ts <input.html|url> [out.svg] [width] [height]');
    process.exit(1);
  }
  const isUrl = /^https?:\/\//.test(src);
  const input: RenderInput = isUrl ? { url: src } : { html: readFileSync(src, 'utf8') };
  const svg = await renderToSvg(input, {
    width: widthArg ? parseInt(widthArg, 10) : 1280,
    height: heightArg ? parseInt(heightArg, 10) : undefined,
    deviceScaleFactor: 2,
    executablePath: await chromiumPath(),
    launchArgs: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--single-process'],
  });
  writeFileSync(dest, svg);
  console.error(`wrote ${dest} (${(svg.length / 1024).toFixed(1)} KB)`);
}

if (process.argv[1] && process.argv[1].endsWith('render.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
