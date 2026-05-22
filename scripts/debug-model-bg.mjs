import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/tmp/chrome/chrome-linux64/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('user_auth_token', 'mock-token-for-screenshot'));
const page = await ctx.newPage();
await page.goto('http://localhost:3000/agent/openai', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  // Find the div with border 1px solid, boxShadow, and width=220
  const allDivs = Array.from(document.querySelectorAll('div'));
  const modelNodes = allDivs.filter(el => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return Math.round(r.width) === 220 && cs.borderTopWidth === '1px' && cs.borderTopStyle === 'solid';
  });
  
  return modelNodes.map(el => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    // Get element's CSS classes
    const classes = el.className;
    // Check inline style
    const inlineStyle = el.getAttribute('style') || '';
    // Get the APPLIED stylesheets for backgroundColor
    let bgFromSheet = '';
    try {
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText && el.matches(rule.selectorText)) {
            if (rule.style.backgroundColor) {
              bgFromSheet = rule.style.backgroundColor;
            }
          }
        }
      }
    } catch(e) {}
    
    // Take a pixel sample at the center via canvas
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const ctx2d = canvas.getContext('2d', { willReadFrequently: true });
    const cx = Math.round(r.x + r.width/2);
    const cy = Math.round(r.y + r.height/2);
    
    return {
      cls: classes.slice(0, 80),
      style: inlineStyle.slice(0, 80),
      computedBg: cs.backgroundColor,
      computedBorderColor: cs.borderTopColor,
      computedBoxShadow: cs.boxShadow.slice(0, 80),
      childCount: el.childElementCount,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  });
});

console.log(`Found ${info.length} model node candidates:`);
for (const n of info) {
  console.log(`\ncls: ${n.cls}`);
  console.log(`bg: ${n.computedBg}`);
  console.log(`borderColor: ${n.computedBorderColor}`);
  console.log(`boxShadow: ${n.computedBoxShadow}`);
  console.log(`children: ${n.childCount}`);
  console.log(`rect: ${JSON.stringify(n.rect)}`);
}

// Use Playwright's pixel sampling to check actual rendered color at model node center
const center = await page.evaluate(() => {
  const divs = Array.from(document.querySelectorAll('div')).filter(el => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return Math.round(r.width) === 220 && cs.borderTopWidth === '1px' && cs.borderTopStyle === 'solid' && cs.boxShadow.includes('rgba(0, 0, 0, 0.2)');
  });
  if (divs.length === 0) return null;
  const r = divs[0].getBoundingClientRect();
  return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
});

if (center) {
  // Screenshot a 1x1 pixel at the center of the model node
  const buf = await page.screenshot({ clip: { x: center.x, y: center.y, width: 1, height: 1 } });
  const { PNG } = await import('pngjs');
  const img = PNG.sync.read(buf);
  console.log(`\nActual pixel at center (${center.x},${center.y}): RGB(${img.data[0]}, ${img.data[1]}, ${img.data[2]})`);
}

await browser.close();
