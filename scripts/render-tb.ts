/**
 * Render tingly-box pages to SVG, injecting mock auth token first.
 * Usage: CHROMIUM_PATH=... pnpm exec tsx scripts/render-tb.ts
 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { renderToSvg } from '../src/backends/node/playwright.js';

const BASE = 'http://localhost:3000';
const EXEC = process.env.CHROMIUM_PATH || '/tmp/chrome/chrome-linux64/chrome';
const WIDTH = 1440;
const HEIGHT = 900;

const PAGES = [
  { path: '/agent/openai',    out: '/tmp/svg-openai.svg' },
  { path: '/agent/anthropic', out: '/tmp/svg-anthropic.svg' },
  { path: '/agent/claude_code', out: '/tmp/svg-claude-code.svg' },
  { path: '/agent/codex',     out: '/tmp/svg-codex.svg' },
  { path: '/agent/agent',     out: '/tmp/svg-agent.svg' },
];

async function main() {
  const browser = await chromium.launch({
    executablePath: EXEC,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  for (const { path, out } of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
    // Inject mock auth token before navigation
    await ctx.addInitScript(() => {
      localStorage.setItem('user_auth_token', 'mock-token-for-screenshot');
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    // Extra settle for MUI animations
    await page.waitForTimeout(3000);

    const svg = await renderToSvg({ page }, {
      width: WIDTH,
      height: HEIGHT,
      settleMs: 0,
      fontMode: 'none',
    });
    writeFileSync(out, svg);
    console.error(`wrote ${out} (${(svg.length / 1024).toFixed(1)} KB)`);
    await ctx.close();
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
