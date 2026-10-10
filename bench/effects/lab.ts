/**
 * Effects lab: `pnpm bench:effects` — for each CSS effect, render the real CSS and a candidate SVG
 * implementation side by side in Chromium and report the pixel diff. This is the evidence behind
 * docs/svg-effects.md ("can SVG do it, and how exactly?"). Each case is independent so a technique can
 * later become a standalone emitter component.
 */
import { chromium } from 'playwright';
import sparticuz from '@sparticuz/chromium';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const W = 240, H = 140;
const BG = `<rect width="${W}" height="${H}" fill="#f4f1ea"/><circle cx="60" cy="50" r="34" fill="#e8553d"/><rect x="100" y="30" width="110" height="70" fill="#2a7fd4"/><text x="20" y="120" font-family="sans-serif" font-size="26" font-weight="700" fill="#222">Sphinx of quartz</text>`;
const bgHtml = `<svg width="${W}" height="${H}" style="position:absolute;left:0;top:0">${BG}</svg>`;

// 5x4 feColorMatrix per CSS filter function (values from the Filter Effects spec)
const gray = (a: number) => [0.2126 + 0.7874 * (1 - a), 0.7152 - 0.7152 * (1 - a), 0.0722 - 0.0722 * (1 - a), 0.2126 - 0.2126 * (1 - a), 0.7152 + 0.2848 * (1 - a), 0.0722 - 0.0722 * (1 - a), 0.2126 - 0.2126 * (1 - a), 0.7152 - 0.7152 * (1 - a), 0.0722 + 0.9278 * (1 - a)];
const mat = (m: number[]) => `<feColorMatrix type="matrix" values="${m[0]} ${m[1]} ${m[2]} 0 0 ${m[3]} ${m[4]} ${m[5]} 0 0 ${m[6]} ${m[7]} ${m[8]} 0 0 0 0 0 1 0"/>`;

interface Case { id: string; effect: string; css: string; svg: string; note?: string }
const CASES: Case[] = [
  { id: 'filter-grayscale', effect: 'filter: grayscale(.8)', css: `<div style="position:absolute;inset:0;filter:grayscale(.8)">${bgHtml}</div>`, svg: `<defs><filter id="f" color-interpolation-filters="sRGB">${mat(gray(0.8))}</filter></defs><g filter="url(#f)">${BG}</g>` },
  { id: 'filter-brightness', effect: 'filter: brightness(1.4) contrast(1.2)', css: `<div style="position:absolute;inset:0;filter:brightness(1.4) contrast(1.2)">${bgHtml}</div>`, svg: `<defs><filter id="f" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="linear" slope="1.4"/><feFuncG type="linear" slope="1.4"/><feFuncB type="linear" slope="1.4"/></feComponentTransfer><feComponentTransfer><feFuncR type="linear" slope="1.2" intercept="-0.1"/><feFuncG type="linear" slope="1.2" intercept="-0.1"/><feFuncB type="linear" slope="1.2" intercept="-0.1"/></feComponentTransfer></filter></defs><g filter="url(#f)">${BG}</g>` },
  { id: 'filter-hue-invert', effect: 'filter: hue-rotate(90deg) invert(.5)', css: `<div style="position:absolute;inset:0;filter:hue-rotate(90deg) invert(.5)">${bgHtml}</div>`, svg: `<defs><filter id="f" color-interpolation-filters="sRGB"><feColorMatrix type="hueRotate" values="90"/><feComponentTransfer><feFuncR type="table" tableValues="0.5 0.5"/><feFuncG type="table" tableValues="0.5 0.5"/><feFuncB type="table" tableValues="0.5 0.5"/></feComponentTransfer></filter></defs><g filter="url(#f)">${BG}</g>`, note: 'invert(.5) is constant 0.5 grey in CSS — table with 0.5 0.5 is the exact equivalent' },
  { id: 'filter-drop-shadow', effect: 'filter: drop-shadow(6px 6px 5px rgba(0,0,0,.5))', css: `<div style="position:absolute;inset:0;filter:drop-shadow(6px 6px 5px rgba(0,0,0,.5))"><svg width="${W}" height="${H}"><rect x="30" y="30" width="90" height="60" fill="#e8553d"/><text x="130" y="80" font-family="sans-serif" font-size="30" font-weight="700">Ab</text></svg></div>`, svg: `<rect width="${W}" height="${H}" fill="#fff"/><defs><filter id="f" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="6" dy="6" stdDeviation="2.5" flood-color="#000" flood-opacity=".5"/></filter></defs><g filter="url(#f)"><rect x="30" y="30" width="90" height="60" fill="#e8553d"/><text x="130" y="80" font-family="sans-serif" font-size="30" font-weight="700">Ab</text></g>` },
  { id: 'blend-multiply', effect: 'mix-blend-mode: multiply', css: `${bgHtml}<div style="position:absolute;left:40px;top:20px;width:130px;height:70px;background:#f6c;mix-blend-mode:multiply"></div>`, svg: `${BG}<rect x="40" y="20" width="130" height="70" fill="#f6c" style="mix-blend-mode:multiply"/>`, note: 'SVG elements honour CSS mix-blend-mode against the same-document backdrop' },
  { id: 'blend-difference-text', effect: 'mix-blend-mode: difference on text', css: `${bgHtml}<div style="position:absolute;left:20px;top:10px;font:700 40px sans-serif;color:#fff;mix-blend-mode:difference">Blend</div>`, svg: `${BG}<text x="20" y="48" font-family="sans-serif" font-size="40" font-weight="700" fill="#fff" style="mix-blend-mode:difference">Blend</text>` },
  { id: 'backdrop-blur', effect: 'backdrop-filter: blur(6px)', css: `${bgHtml}<div style="position:absolute;left:50px;top:20px;width:150px;height:90px;border-radius:14px;backdrop-filter:blur(6px);background:rgba(255,255,255,.25)"></div>`, svg: `${BG}<defs><clipPath id="c"><rect x="50" y="20" width="150" height="90" rx="14"/></clipPath><filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6" edgeMode="duplicate"/></filter></defs><g clip-path="url(#c)"><g filter="url(#b)">${BG}</g></g><rect x="50" y="20" width="150" height="90" rx="14" fill="rgba(255,255,255,.25)"/>`, note: 'Re-emit everything painted below inside a blurred, clipped group (BackgroundImage is unsupported in browsers)' },
  { id: 'text-stroke', effect: '-webkit-text-stroke: 3px + transparent fill', css: `<div style="position:absolute;left:10px;top:30px;font:800 64px sans-serif;color:transparent;-webkit-text-stroke:3px #c22">Ink</div>`, svg: `<rect width="${W}" height="${H}" fill="#fff"/><text x="10" y="92" font-family="sans-serif" font-size="64" font-weight="800" fill="none" stroke="#c22" stroke-width="3">Ink</text>` },
  { id: 'text-shadow', effect: 'text-shadow: 3px 3px 4px #000a', css: `<div style="position:absolute;left:10px;top:30px;font:800 54px sans-serif;color:#2a7fd4;text-shadow:3px 3px 4px #000a">Shade</div>`, svg: `<rect width="${W}" height="${H}" fill="#fff"/><defs><filter id="f" x="-10%" y="-20%" width="130%" height="160%"><feDropShadow dx="3" dy="3" stdDeviation="2" flood-color="#000" flood-opacity=".667"/></filter></defs><text x="10" y="82" font-family="sans-serif" font-size="54" font-weight="800" fill="#2a7fd4" filter="url(#f)">Shade</text>`, note: 'blur radius 4px ⇒ stdDeviation 2' },
  { id: 'clip-text-gradient', effect: 'background-clip:text gradient', css: `<div style="position:absolute;left:10px;top:30px;font:800 60px sans-serif;background:linear-gradient(90deg,#e8553d,#2a7fd4);-webkit-background-clip:text;background-clip:text;color:transparent">Clip</div>`, svg: `<rect width="${W}" height="${H}" fill="#fff"/><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="10" y1="0" x2="${10 + 118}" y2="0"><stop offset="0" stop-color="#e8553d"/><stop offset="1" stop-color="#2a7fd4"/></linearGradient></defs><text x="10" y="80" font-family="sans-serif" font-size="60" font-weight="800" fill="url(#g)">Clip</text>` },
  { id: 'rotate-group', effect: 'transform: rotate(-12deg) about centre', css: `<div style="position:absolute;left:40px;top:35px;width:150px;height:60px;background:#e8553d;color:#fff;font:700 24px/60px sans-serif;text-align:center;border-radius:8px;transform:rotate(-12deg)">Badge</div>`, svg: `<rect width="${W}" height="${H}" fill="#fff"/><g transform="rotate(-12 115 65)"><rect x="40" y="35" width="150" height="60" rx="8" fill="#e8553d"/><text x="115" y="75" text-anchor="middle" font-family="sans-serif" font-size="24" font-weight="700" fill="#fff">Badge</text></g>`, note: 'transform-origin = box centre by default → rotate(a cx cy)' },
  { id: 'skew', effect: 'transform: skewX(-20deg)', css: `<div style="position:absolute;left:60px;top:35px;width:120px;height:60px;background:#2a7fd4;transform:skewX(-20deg)"></div>`, svg: `<rect width="${W}" height="${H}" fill="#fff"/><g transform="translate(120 65) skewX(-20) translate(-120 -65)"><rect x="60" y="35" width="120" height="60" fill="#2a7fd4"/></g>` },
  { id: 'inset-blur-shadow', effect: 'box-shadow: inset 0 0 14px 2px #000a', css: `<div style="position:absolute;left:30px;top:20px;width:180px;height:100px;border-radius:16px;background:#fff;box-shadow:inset 0 0 14px 2px #000a"></div>`, svg: `<rect width="${W}" height="${H}" fill="#fff"/><defs><clipPath id="c"><rect x="30" y="20" width="180" height="100" rx="16"/></clipPath><filter id="b" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter></defs><rect x="30" y="20" width="180" height="100" rx="16" fill="#fff"/><g clip-path="url(#c)"><path fill-rule="evenodd" d="M-100,-100H400V300H-100Z M${30 + 2},${20 + 2}H${210 - 2}V${120 - 2}H${32}Z" fill="rgba(0,0,0,.667)" filter="url(#b)"/></g>`, note: 'ring (outer minus spread-shrunk hole) blurred and clipped to the padding box' },
  { id: 'dashed-wavy-underline', effect: 'text-decoration: underline wavy red', css: `<div style="position:absolute;left:10px;top:40px;font:700 40px sans-serif;text-decoration:underline wavy #c22;text-underline-offset:6px">Wavy</div>`, svg: `<rect width="${W}" height="${H}" fill="#fff"/><text x="10" y="78" font-family="sans-serif" font-size="40" font-weight="700">Wavy</text><path d="M10,92 q2.5,-3 5,0 t5,0 t5,0 t5,0 t5,0 t5,0 t5,0 t5,0 t5,0 t5,0 t5,0 t5,0 t5,0 t5,0 t5,0 t5,0 t5,0 t5,0 t5,0 t5,0 t5,0 t5,0" fill="none" stroke="#c22" stroke-width="2"/>`, note: 'path approximation of Chrome\'s wave — needs tuning, expect small diff' },
];

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (await sparticuz.executablePath()), args: ['--no-sandbox', '--disable-gpu'] });
  const out = resolve('bench/out/effects');
  mkdirSync(out, { recursive: true });
  const rows: string[] = ['| case | CSS effect | diff | note |', '|---|---|---|---|'];
  for (const c of CASES) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.setContent(`<!doctype html><body style="margin:0;background:#fff;position:relative;width:${W}px;height:${H}px;overflow:hidden">${c.css}</body>`);
    const exp = PNG.sync.read(await page.screenshot());
    await page.setContent(`<!doctype html><body style="margin:0;background:#fff"><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${c.svg}</svg></body>`);
    const act = PNG.sync.read(await page.screenshot());
    const diff = new PNG({ width: W, height: H });
    const n = pixelmatch(exp.data, act.data, diff.data, W, H, { threshold: 0.1 });
    writeFileSync(resolve(out, `${c.id}.css.png`), PNG.sync.write(exp));
    writeFileSync(resolve(out, `${c.id}.svg.png`), PNG.sync.write(act));
    rows.push(`| ${c.id} | \`${c.effect}\` | ${((n / (W * H)) * 100).toFixed(2)}% | ${c.note ?? ''} |`);
    console.error(`${c.id.padEnd(24)} ${((n / (W * H)) * 100).toFixed(2)}%`);
    await ctx.close();
  }
  await browser.close();
  writeFileSync(resolve(out, 'report.md'), rows.join('\n') + '\n');
  console.log(rows.join('\n'));
}
main();
