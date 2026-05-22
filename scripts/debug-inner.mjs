import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/tmp/chrome/chrome-linux64/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem('user_auth_token', 'mock-token-for-screenshot'));
const page = await ctx.newPage();
await page.goto('http://localhost:3000/agent/openai', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  // Find css-5wnjeh and css-128wm2l and css-1ek3p20
  const el5wnjeh = document.querySelector('.css-5wnjeh');
  const el128wm2l = document.querySelector('.css-128wm2l');
  const el1ek3p20 = document.querySelector('.css-1ek3p20');
  
  const getInfo = (el, name) => {
    if (!el) return { name, error: 'not found' };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      name,
      bg: cs.backgroundColor,
      color: cs.color,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      borderRadius: cs.borderRadius,
      position: cs.position,
      width: cs.width,
      height: cs.height,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      childCount: el.childElementCount,
      text: el.textContent?.slice(0, 50)
    };
  };
  
  return {
    inner: getInfo(el5wnjeh, 'css-5wnjeh'),
    wrapper: getInfo(el128wm2l, 'css-128wm2l'),
    modelNode: getInfo(el1ek3p20, 'css-1ek3p20'),
  };
});

for (const [key, v] of Object.entries(info)) {
  console.log(`\n${key} (${v.name}):`, JSON.stringify(v, null, 2));
}

// Also check - does the shadow actually render through the transparent background?
// Sample pixels at various points INSIDE the model node but away from text/buttons
const pixels = await page.evaluate(() => {
  // Model node 1: x=388, y=357, w=220, h=72
  // Top area (above text): y=360-368
  // Left padding area: x=390-400
  const results = [];
  for (const [px, py] of [[395, 362], [498, 362], [598, 362], [395, 415], [498, 415], [598, 415]]) {
    results.push({ px, py });
  }
  return results;
});

for (const {px, py} of pixels) {
  const buf = await page.screenshot({ clip: { x: px, y: py, width: 1, height: 1 } });
  const { PNG } = await import('pngjs');
  const img = PNG.sync.read(buf);
  console.log(`Pixel at CSS(${px},${py}): RGB(${img.data[0]}, ${img.data[1]}, ${img.data[2]})`);
}

await browser.close();
