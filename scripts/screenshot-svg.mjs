/**
 * Render the SVG files to PNG for visual comparison
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const CHROME = '/tmp/chrome/chrome-linux64/chrome';
const SVGS = [
  ['/tmp/svg-openai.svg', '/tmp/cmp-openai.png'],
  ['/tmp/svg-anthropic.svg', '/tmp/cmp-anthropic.png'],
  ['/tmp/svg-claude-code.svg', '/tmp/cmp-claude-code.png'],
  ['/tmp/svg-codex.svg', '/tmp/cmp-codex.png'],
  ['/tmp/svg-agent.svg', '/tmp/cmp-agent.png'],
];

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

for (const [svgPath, outPath] of SVGS) {
  const svg = readFileSync(svgPath, 'utf8');
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;">${svg}</body></html>`;
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: outPath });
  await page.close();
  console.log(`Saved: ${outPath}`);
}

await browser.close();
