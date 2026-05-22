/**
 * Visual regression: render tingly-box routing-graph pages and pixel-diff them
 * against their SVG conversion output.
 *
 * Requires tingly-box dev server running in mock mode:
 *   cd <tingly-box>/frontend && USE_MOCK=true npm run dev:mock
 *
 * Usage:
 *   CHROMIUM_PATH=/tmp/chrome/chrome-linux64/chrome pnpm exec tsx scripts/validate-tb.ts [base-url]
 *
 * Env:
 *   CHROMIUM_PATH   path to Chrome/Chromium binary (defaults to @sparticuz/chromium)
 *   TB_BASE         tingly-box dev server base URL (default: http://localhost:3000)
 *   FH_THRESHOLD    max allowed diff ratio 0–1 (default: 0.05)
 */
import { resolve } from 'node:path';
import { validate } from './validate.js';

const BASE = process.env.TB_BASE ?? 'http://localhost:3000';
const THRESHOLD = Number(process.env.FH_THRESHOLD ?? 0.05);
const OUT_DIR = resolve('test/visual/__out__/tingly-box');

// Mock auth token — matches what the tingly-box mock server expects
const INIT_SCRIPT = `localStorage.setItem('user_auth_token', 'mock-token-for-screenshot');`;

const PAGES = [
  { path: '/agent/openai',      name: 'tb-openai' },
  { path: '/agent/anthropic',   name: 'tb-anthropic' },
  { path: '/agent/claude_code', name: 'tb-claude-code' },
  { path: '/agent/codex',       name: 'tb-codex' },
  { path: '/agent/agent',       name: 'tb-agent' },
];

async function main() {
  let anyFail = false;

  for (const { path, name } of PAGES) {
    const r = await validate(
      { url: `${BASE}${path}` },
      {
        width: 1440,
        height: 900,
        name,
        outDir: OUT_DIR,
        fontMode: 'embed',
        initScript: INIT_SCRIPT,
        settleMs: 3000,
      },
    );
    const pct = (r.ratio * 100).toFixed(3);
    const status = r.ratio > THRESHOLD ? 'FAIL' : 'OK';
    console.error(
      `[${name}] ${r.width}x${r.height}  diff=${r.diffPixels}/${r.totalPixels} (${pct}%)  ${status}`,
    );
    if (r.ratio > THRESHOLD) anyFail = true;
  }

  if (anyFail) {
    console.error(`\nDiff images written to: ${OUT_DIR}`);
    process.exit(1);
  }
  console.error('\nAll pages within threshold.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
