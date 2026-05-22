import { chromium } from 'playwright';
import { captureScene } from '../src/core/capture/capture.js';

const browser = await chromium.launch({
  executablePath: '/tmp/chrome/chrome-linux64/chrome',
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  localStorage.setItem('user_auth_token', 'mock-token-for-screenshot');
});
const page = await ctx.newPage();
await page.goto('http://localhost:3000/agent/openai', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.evaluate(() => { const g = globalThis; if (!g.__name) g.__name = (t) => t; });

// Capture scene and inspect box node fill colors
const scene = await page.evaluate(captureScene, {
  width: 1440, height: 900, deviceScaleFactor: 1, fontMode: 'none',
});

const dark = scene.nodes.filter(n => n.kind === 'box' && n.fill &&
  (n.fill.includes('30, 41') || n.fill.includes('55, 65') || n.fill.includes('100, 116')));

console.log(`Total nodes: ${scene.nodes.length}, dark-filled boxes: ${dark.length}`);
for (const n of dark.slice(0, 15)) {
  console.log(`  fill=${n.fill}  rect=x${Math.round(n.rect.x)},y${Math.round(n.rect.y)},w${Math.round(n.rect.width)},h${Math.round(n.rect.height)}`);
}

// Also check scene background
console.log('\nScene background:', scene.background);

// Sample all unique box fills
const fills = new Map();
for (const n of scene.nodes) {
  if (n.kind === 'box' && n.fill) fills.set(n.fill, (fills.get(n.fill) || 0) + 1);
}
console.log('\nAll box fill colors:');
for (const [f, cnt] of [...fills.entries()].sort((a,b) => b[1]-a[1])) {
  console.log(`  ${cnt}x  ${f}`);
}

await browser.close();
