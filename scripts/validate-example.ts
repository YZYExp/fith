/**
 * One-command end-to-end validation for an example app:
 *   pnpm validate:example <name> [width] [height] [embed|outline|none]
 *
 * Builds examples/<name>, serves its dist over http, renders both the page and
 * the generated SVG in the same Chromium, pixel-diffs them, and writes
 * expected/actual/diff PNGs to test/visual/__out__/. Exits non-zero if the diff
 * ratio exceeds the threshold.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validate, serveDir } from './validate.js';

const THRESHOLD = Number(process.env.FH_THRESHOLD ?? 0.02);

async function main() {
  const [name = 'mui-app', widthArg, heightArg, fontModeArg] = process.argv.slice(2);
  const appDir = resolve('examples', name);
  if (!existsSync(appDir)) {
    console.error(`no example at examples/${name}`);
    process.exit(1);
  }

  if (!existsSync(resolve(appDir, 'node_modules'))) {
    console.error(`[${name}] installing deps…`);
    execSync('pnpm install', { cwd: appDir, stdio: 'inherit' });
  }
  console.error(`[${name}] building…`);
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit' });

  const server = await serveDir(resolve(appDir, 'dist'));
  try {
    const r = await validate(
      { url: server.url },
      {
        width: widthArg ? parseInt(widthArg, 10) : 1280,
        height: heightArg ? parseInt(heightArg, 10) : undefined,
        name,
        outDir: resolve('test/visual/__out__'),
        fontMode: (fontModeArg as 'embed' | 'outline' | 'none') || 'embed',
      },
    );
    const pct = (r.ratio * 100).toFixed(3);
    console.error(
      `[${name}] ${r.width}x${r.height}  diff=${r.diffPixels}/${r.totalPixels} (${pct}%)  -> ${r.outDir}`,
    );
    if (r.ratio > THRESHOLD) {
      console.error(`[${name}] FAIL: ${pct}% > ${(THRESHOLD * 100).toFixed(3)}% threshold`);
      process.exit(1);
    }
    console.error(`[${name}] OK`);
  } finally {
    await server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
