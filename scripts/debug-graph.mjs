import { chromium } from 'playwright';

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

const info = await page.evaluate(() => {
  const results = {};

  // Find the main routing graph container (ReactFlow pane area)
  // Look for the large white/light area below the header
  const allBoxes = Array.from(document.querySelectorAll('*'));
  
  // Find the ReactFlow container
  const rfContainers = allBoxes.filter(el => {
    const cls = el.className || '';
    return typeof cls === 'string' && (cls.includes('react-flow') || cls.includes('ReactFlow'));
  });
  results.rfCount = rfContainers.length;
  if (rfContainers.length > 0) {
    const rf = rfContainers[0];
    const cs = getComputedStyle(rf);
    const r = rf.getBoundingClientRect();
    results.rfFirst = { bg: cs.backgroundColor, cls: rf.className.slice(0,80), w: Math.round(r.width), h: Math.round(r.height) };
  }

  // Find the GraphContainer (the grey.50 box around the routing rows)
  // It's likely a MuiBox between the header/summary area and the graph rows
  const contentPanel = document.querySelector('[class*="MuiPaper-root"]');
  if (contentPanel) {
    // Walk its children to find the routing graph area
    const kids = Array.from(contentPanel.querySelectorAll('[class*="MuiBox"]'));
    const graphBoxes = kids.filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 800 && r.height > 100 && r.height < 600;
    });
    results.graphBoxes = graphBoxes.slice(0,5).map(el => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        bg: cs.backgroundColor,
        bgImage: cs.backgroundImage.slice(0,80),
        borderRadius: cs.borderRadius,
        padding: cs.padding,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
      };
    });
  }

  // Check model node boxes - look for white boxes with border
  const modelBoxes = [];
  for (const el of allBoxes) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width > 150 && r.width < 300 && r.height > 80 && r.height < 150 && 
        !transparent(cs.backgroundColor) && cs.borderTopWidth !== '0px') {
      modelBoxes.push({
        tag: el.tagName,
        bg: cs.backgroundColor,
        border: cs.borderTopWidth + ' ' + cs.borderTopColor,
        borderRadius: cs.borderRadius,
        boxShadow: cs.boxShadow.slice(0,100),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
      });
    }
  }
  results.modelBoxes = modelBoxes.slice(0,6);

  function transparent(c) {
    return !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)' || /,\s*0\)\s*$/.test(c);
  }

  // Check the exact background of the routing graph background panel
  const bgCheckAreas = [];
  for (const el of allBoxes) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    // Look for any element with repeating-linear-gradient or the grey.50 background
    if (cs.backgroundImage && cs.backgroundImage !== 'none' && r.width > 500) {
      bgCheckAreas.push({
        tag: el.tagName,
        bg: cs.backgroundColor,
        bgImage: cs.backgroundImage.slice(0, 120),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
      });
    }
  }
  results.bgCheckAreas = bgCheckAreas.slice(0,5);

  // Find the area at center ~500-700y (routing graph rows)
  const midAreaEls = allBoxes.filter(el => {
    const r = el.getBoundingClientRect();
    return r.x > 300 && r.y > 280 && r.y < 400 && r.width > 400 && r.height > 80;
  });
  results.midArea = midAreaEls.slice(0,5).map(el => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage ? cs.backgroundImage.slice(0,80) : '',
      cls: (el.getAttribute('class') || '').slice(0,60),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    };
  });

  return results;
});

console.log('ReactFlow containers:', info.rfCount);
if (info.rfFirst) console.log('RF first:', JSON.stringify(info.rfFirst));
console.log('\nGraph boxes:', JSON.stringify(info.graphBoxes, null, 2));
console.log('\nModel boxes (white w/ border):', JSON.stringify(info.modelBoxes, null, 2));
console.log('\nbg areas with backgroundImage:', JSON.stringify(info.bgCheckAreas, null, 2));
console.log('\nmidArea elements:', JSON.stringify(info.midArea, null, 2));

await browser.close();
