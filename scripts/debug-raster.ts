/**
 * Debug: understand which tingly-box elements get rasterized and why,
 * and what styles cause SVG diff issues.
 */
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
await page.evaluate(() => { const g = globalThis as any; if (!g.__name) g.__name = (t: any) => t; });

// 1. Inspect routing-graph specific elements
const info = await page.evaluate(() => {
  const results: any[] = [];

  // Walk model nodes and provider nodes
  const modelNodes = document.querySelectorAll('[class*="StyledModelNode"], [class*="MuiToggleButton"], [class*="MuiIconButton"]');
  for (const el of Array.from(modelNodes).slice(0, 20)) {
    const cs = getComputedStyle(el);
    const before = getComputedStyle(el, '::before');
    const after = getComputedStyle(el, '::after');
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;

    const beforeBg = before.backgroundColor;
    const afterBg = after.backgroundColor;
    const transparent = (c: string) => !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)' || /,\s*0\)\s*$/.test(c);

    results.push({
      tag: el.tagName,
      cls: (el.getAttribute('class') || '').split(' ').filter(c => /Mui|Styled/.test(c)).join(' ').slice(0, 60),
      bg: cs.backgroundColor,
      borderColor: cs.borderColor,
      boxShadow: cs.boxShadow.slice(0, 60),
      hasChildren: el.childElementCount > 0,
      beforeContent: before.content,
      beforeBg,
      beforeBgTransparent: transparent(beforeBg),
      afterContent: after.content,
      afterBg,
      afterBgTransparent: transparent(afterBg),
      w: Math.round(r.width),
      h: Math.round(r.height),
    });
  }
  return results;
});

console.log('=== Model/ToggleButton/IconButton nodes ===');
for (const e of info) {
  console.log(`${e.tag} [${e.cls}]`);
  console.log(`  bg=${e.bg}, hasChildren=${e.hasChildren}`);
  console.log(`  ::before content=${e.beforeContent} bg=${e.beforeBg} transparent=${e.beforeBgTransparent}`);
  console.log(`  ::after  content=${e.afterContent}  bg=${e.afterBg}  transparent=${e.afterBgTransparent}`);
  console.log();
}

// 2. Capture scene and find raster nodes
const scene = await page.evaluate(captureScene, {
  width: 1440, height: 900, deviceScaleFactor: 1, fontMode: 'none' as const,
});

const rasterNodes = scene.nodes.filter(n => n.kind === 'raster') as any[];
console.log(`\n=== Raster nodes (${rasterNodes.length} total) ===`);
for (const n of rasterNodes) {
  console.log(`  reason=${n.reason.padEnd(20)} x=${Math.round(n.rect.x)} y=${Math.round(n.rect.y)} w=${Math.round(n.rect.width)} h=${Math.round(n.rect.height)}`);
}

// 3. Check ApiStyleBadge specifically
const badgeInfo = await page.evaluate(() => {
  // Find elements with "Style" text (Anthropic Style, OpenAI Style badges)
  const allEls = document.querySelectorAll('*');
  const badges: any[] = [];
  for (const el of Array.from(allEls)) {
    const text = el.textContent?.trim() || '';
    if ((text === 'Anthropic Style' || text === 'OpenAI Style') && el.childElementCount === 0) {
      const cs = getComputedStyle(el);
      const after = getComputedStyle(el, '::after');
      const r = el.getBoundingClientRect();
      badges.push({
        tag: el.tagName,
        text,
        bg: cs.backgroundColor,
        border: cs.borderColor,
        fontSize: cs.fontSize,
        afterContent: after.content,
        afterBg: after.backgroundColor,
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
  }
  return badges;
});

console.log('\n=== ApiStyleBadge text nodes ===');
for (const b of badgeInfo) {
  console.log(`  "${b.text}" bg=${b.bg} border=${b.border} after.content=${b.afterContent} after.bg=${b.afterBg}`);
}

await browser.close();
