import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/tmp/chrome/chrome-linux64/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('user_auth_token', 'mock-token-for-screenshot'));
const page = await ctx.newPage();
await page.goto('http://localhost:3000/agent/openai', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  const results = {};
  const allEls = Array.from(document.querySelectorAll('*'));
  
  // Find model nodes (StyledModelNode) - white boxes 220x48 or 220x72
  const modelNodes = allEls.filter(el => {
    const r = el.getBoundingClientRect();
    return Math.round(r.width) === 220 && (Math.round(r.height) === 48 || Math.round(r.height) === 72);
  });
  results.modelNodes = modelNodes.map(el => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      bg: cs.backgroundColor,
      borderColor: cs.borderTopColor,
      borderWidth: cs.borderTopWidth,
      borderStyle: cs.borderTopStyle,
      boxShadow: cs.boxShadow.slice(0, 120),
      borderRadius: cs.borderRadius,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    };
  }).slice(0, 6);

  // Find GraphContainer - something that wraps the graph rows
  // It's a Box with padding inside CardContent
  // Search for elements in the y=310-760 range with width ~1000 and some background
  const graphArea = allEls.filter(el => {
    const r = el.getBoundingClientRect();
    return r.x > 300 && r.width > 800 && r.y > 290 && r.y < 500 && r.height > 50 && r.height < 200;
  });
  results.graphAreaBoxes = graphArea.map(el => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      cls: (el.getAttribute('class') || '').slice(0, 60),
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage.slice(0, 80),
      borderRadius: cs.borderRadius,
      padding: cs.padding,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    };
  });

  // Also check all areas around y=300-800 with any background
  const bgEls = allEls.filter(el => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const bg = cs.backgroundColor;
    return r.x > 300 && r.y > 290 && r.y < 800 && r.width > 500 &&
      bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
  });
  results.bgAreas = bgEls.map(el => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      bg: cs.backgroundColor,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    };
  }).slice(0, 20);

  // Count all distinct box-shadow values 
  const shadowMap = {};
  for (const el of allEls) {
    const cs = getComputedStyle(el);
    if (cs.boxShadow && cs.boxShadow !== 'none') {
      const shadow = cs.boxShadow;
      shadowMap[shadow] = (shadowMap[shadow] || 0) + 1;
    }
  }
  results.shadowDistribution = Object.entries(shadowMap).map(([s, c]) => `${c}x: ${s.slice(0,100)}`);

  return results;
});

console.log('=== Model Nodes (220x48 or 220x72) ===');
for (const n of info.modelNodes) console.log(JSON.stringify(n));

console.log('\n=== Graph area boxes ===');
for (const b of info.graphAreaBoxes) console.log(JSON.stringify(b));

console.log('\n=== All bg elements in routing area ===');
for (const b of info.bgAreas) console.log(JSON.stringify(b));

console.log('\n=== Box shadow distribution ===');
for (const s of info.shadowDistribution) console.log(' ', s);

await browser.close();
