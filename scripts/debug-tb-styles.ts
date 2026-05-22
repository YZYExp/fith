/**
 * Comprehensive tingly-box style study: capture what captureScene records
 * for each node type vs what the browser actually renders.
 * Goal: identify gaps that cause the 8% diff in validate-tb.
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

// Inspect elements that are likely causing the diff
const study = await page.evaluate(() => {
  const results: Record<string, any> = {};

  // 1. ModelNode (StyledModelNode) - gpt-4o
  const modelNodes = document.querySelectorAll('[class*="MuiBox-root"]');
  for (const el of Array.from(modelNodes)) {
    const r = el.getBoundingClientRect();
    if (r.width > 200 && r.width < 250 && r.height > 60 && r.height < 100) {
      const cs = getComputedStyle(el);
      if (cs.backgroundColor === 'rgb(255, 255, 255)' && cs.borderStyle === 'solid') {
        results.modelNode = {
          bg: cs.backgroundColor,
          borderColor: cs.borderColor,
          borderWidth: cs.borderTopWidth,
          borderRadius: cs.borderRadius,
          boxShadow: cs.boxShadow,
          backgroundImage: cs.backgroundImage,
          overflow: cs.overflow,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        };
        break;
      }
    }
  }

  // 2. ToggleButton (Direct) - the selected one
  const toggleBtns = document.querySelectorAll('.MuiToggleButton-root.Mui-selected');
  if (toggleBtns.length > 0) {
    const el = toggleBtns[0];
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    results.toggleSelected = {
      bg: cs.backgroundColor,
      color: cs.color,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      text: el.textContent?.trim(),
      borderRadius: cs.borderRadius,
      borderColor: cs.borderColor,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  }

  // 3. Text with text-overflow: ellipsis check
  const allEls = Array.from(document.querySelectorAll('*'));
  const ellipsisEls: any[] = [];
  for (const el of allEls) {
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis' && cs.overflow === 'hidden' && (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        ellipsisEls.push({
          tag: el.tagName,
          cls: el.className.split(' ').find(c => /Mui/.test(c)) || '',
          textContent: el.textContent?.slice(0, 30),
          scrollWidth: (el as HTMLElement).scrollWidth,
          clientWidth: (el as HTMLElement).clientWidth,
          rect: { w: Math.round(r.width), h: Math.round(r.height) },
        });
      }
    }
  }
  results.ellipsisElements = ellipsisEls;

  // 4. ProviderNode container
  const providerNodes = document.querySelectorAll('[class*="MuiBox-root"]');
  for (const el of Array.from(providerNodes)) {
    const r = el.getBoundingClientRect();
    if (r.width > 200 && r.width < 250 && r.height > 60 && r.height < 100) {
      const cs = getComputedStyle(el);
      if (cs.boxShadow !== 'none' && cs.boxShadow.includes('rgba')) {
        const shadows = cs.boxShadow;
        results.nodeBoxShadow = { shadows, numLayers: shadows.split('), rgba').length };
        break;
      }
    }
  }

  // 5. Check what actual font is used
  const sampleText = document.querySelector('.MuiTypography-root');
  if (sampleText) {
    const cs = getComputedStyle(sampleText);
    results.fontInfo = {
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      color: cs.color,
    };
  }

  // 6. ApiStyleBadge PARENT Box
  const spans = Array.from(document.querySelectorAll('span'));
  for (const span of spans) {
    if (span.textContent?.trim() === 'Anthropic Style') {
      const parent = span.parentElement!;
      const pcs = getComputedStyle(parent);
      const r = parent.getBoundingClientRect();
      results.badgeBox = {
        bg: pcs.backgroundColor,
        borderColor: pcs.borderColor,
        borderWidth: pcs.borderTopWidth,
        borderRadius: pcs.borderRadius,
        overflow: pcs.overflow,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      };
      break;
    }
  }

  return results;
});

console.log('=== ModelNode styles ===');
console.log(JSON.stringify(study.modelNode, null, 2));

console.log('\n=== ToggleButton selected (Direct) ===');
console.log(JSON.stringify(study.toggleSelected, null, 2));

console.log('\n=== Node box-shadow layers ===');
console.log(JSON.stringify(study.nodeBoxShadow, null, 2));

console.log('\n=== ApiStyleBadge box ===');
console.log(JSON.stringify(study.badgeBox, null, 2));

console.log('\n=== Font info ===');
console.log(JSON.stringify(study.fontInfo, null, 2));

console.log(`\n=== Text-overflow: ellipsis elements (${study.ellipsisElements?.length || 0}) ===`);
for (const e of study.ellipsisElements || []) {
  console.log(`  ${e.tag} "${e.textContent}" scrollW=${e.scrollWidth} clientW=${e.clientWidth}`);
}

// 7. Capture scene and check raster nodes
const scene = await page.evaluate(captureScene, {
  width: 1440, height: 900, deviceScaleFactor: 1, fontMode: 'none' as const,
});
console.log(`\n=== Scene summary ===`);
console.log(`Total nodes: ${scene.nodes.length}`);
const byKind = scene.nodes.reduce((acc, n) => { acc[n.kind] = (acc[n.kind]||0)+1; return acc; }, {} as Record<string, number>);
console.log('By kind:', byKind);

const boxNodes = scene.nodes.filter(n => n.kind === 'box') as any[];
console.log(`\nBox nodes with shadows: ${boxNodes.filter(b => b.shadows?.length > 0).length}`);
console.log(`Box nodes without fill: ${boxNodes.filter(b => !b.fill).length}`);
console.log(`Box nodes with gradient: ${boxNodes.filter(b => b.gradient).length}`);

await browser.close();
