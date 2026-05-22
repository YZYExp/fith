/**
 * Debug: inspect background colors on tingly-box live page to diagnose SVG rendering issue
 */
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
  const html = document.documentElement;
  const body = document.body;
  const htmlBg = getComputedStyle(html).backgroundColor;
  const bodyBg = getComputedStyle(body).backgroundColor;
  const colorScheme = getComputedStyle(html).colorScheme || 'not set';
  const htmlStyle = html.getAttribute('style') || '';
  const bodyStyle = body.getAttribute('style') || '';

  // sample some MuiBox/MuiCard elements for their bg
  const els = document.querySelectorAll('[class*="MuiBox"],[class*="MuiCard"],[class*="MuiPaper"]');
  const bgSamples = Array.from(els).slice(0, 12).map(el => ({
    tag: el.tagName,
    cls: (el.getAttribute('class') || '').split(' ').find(c => /Mui/.test(c)) || '',
    bg: getComputedStyle(el).backgroundColor,
    bgImage: getComputedStyle(el).backgroundImage,
  }));

  // check CSS custom properties on :root
  const rootStyle = getComputedStyle(document.documentElement);
  const muiBgDefault = rootStyle.getPropertyValue('--mui-palette-background-default').trim();
  const muiBgPaper = rootStyle.getPropertyValue('--mui-palette-background-paper').trim();

  return { htmlBg, bodyBg, colorScheme, htmlStyle: htmlStyle.slice(0, 300), bodyStyle: bodyStyle.slice(0, 300), bgSamples, muiBgDefault, muiBgPaper };
});

console.log('html bg:', info.htmlBg);
console.log('body bg:', info.bodyBg);
console.log('color-scheme:', info.colorScheme);
console.log('--mui-palette-background-default:', info.muiBgDefault || '(not set)');
console.log('--mui-palette-background-paper:', info.muiBgPaper || '(not set)');
console.log('html style attr:', info.htmlStyle);
console.log('body style attr:', info.bodyStyle);
console.log('\nMUI element bg samples:');
for (const s of info.bgSamples) {
  console.log(`  ${s.tag} ${s.cls.padEnd(35)} bg=${s.bg}`);
}

await browser.close();
