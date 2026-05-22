import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/tmp/chrome/chrome-linux64/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('user_auth_token', 'mock-token-for-screenshot'));
const page = await ctx.newPage();
await page.goto('http://localhost:3000/agent/openai', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  // Check all elements at CSS point (498, 393) - center of model node gpt-4o
  const px = 498, py = 393;
  const elementAtPoint = document.elementFromPoint(px, py);
  
  // Walk up to collect all elements at this point
  const chain = [];
  let el = elementAtPoint;
  while (el && el !== document.body) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.left <= px && px <= r.right && r.top <= py && py <= r.bottom) {
      chain.push({
        tag: el.tagName,
        cls: (el.getAttribute('class') || '').slice(0, 60),
        bg: cs.backgroundColor,
        opacity: cs.opacity,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
      });
    }
    el = el.parentElement;
  }
  
  return {
    topElement: elementAtPoint?.tagName + ' ' + (elementAtPoint?.className || '').slice(0, 60),
    chain: chain.reverse() // from outermost to innermost
  };
});

console.log('Top element at (498, 393):', info.topElement);
console.log('\nElement chain at (498, 393):');
for (const e of info.chain) {
  const bgDisplay = e.bg !== 'rgba(0, 0, 0, 0)' ? ` [BG: ${e.bg}]` : '';
  console.log(`  ${e.tag} ${e.cls}${bgDisplay}`);
}

await browser.close();
