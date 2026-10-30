import type { ColorNorm } from './color.js';

export // CSS `filter` function list → FilterOp[] (null when it holds anything SVG can't reproduce, e.g. url()).
const parseFilterList = (v: string | undefined, norm: ColorNorm) => {
  const val = (v || '').trim();
  if (!val || val === 'none') return null;
  const toks: string[] = [];
  let depth = 0, cur = '';
  for (const ch of val) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) toks.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) toks.push(cur);
  const ops: any[] = [];
  const amt = (t: string) => (/%$/.test(t) ? parseFloat(t) / 100 : parseFloat(t));
  for (const t of toks) {
    const m = t.match(/^([\w-]+)\(([\s\S]*)\)$/);
    if (!m) return null;
    const fn = m[1], arg = m[2].trim();
    if (fn === 'blur') { if (!/px$/.test(arg)) return null; ops.push({ fn, px: parseFloat(arg) }); }
    else if (['brightness', 'contrast', 'grayscale', 'invert', 'opacity', 'saturate', 'sepia'].includes(fn)) { const a = amt(arg || '1'); if (!isFinite(a)) return null; ops.push({ fn, amount: a }); }
    else if (fn === 'hue-rotate') { const f = parseFloat(arg); if (!isFinite(f)) return null; ops.push({ fn, deg: /turn$/.test(arg) ? f * 360 : /rad$/.test(arg) ? (f * 180) / Math.PI : /grad$/.test(arg) ? f * 0.9 : f }); }
    else if (fn === 'drop-shadow') {
      const cm = arg.match(/(rgba?\([^)]*\)|#[0-9a-fA-F]+|[a-zA-Z]+(?![\w(]))/);
      const color = cm ? norm(cm[0]) : 'rgb(0, 0, 0)';
      const lens = (cm ? arg.replace(cm[0], '') : arg).match(/-?[\d.]+px/g) || [];
      if (lens.length < 2) return null;
      ops.push({ fn, x: parseFloat(lens[0] as string), y: parseFloat(lens[1] as string), blur: lens[2] ? parseFloat(lens[2] as string) : 0, color });
    } else return null;
  }
  return ops.length ? ops : null;
};
export // how far a filter chain can paint beyond the element box
const filterOverflow = (ops: any[]) => {
  let pad = 4;
  for (const o of ops) {
    if (o.fn === 'blur') pad += o.px * 3;
    else if (o.fn === 'drop-shadow') pad += Math.abs(o.x) + Math.abs(o.y) + o.blur * 1.5 + 2;
  }
  return pad;
};

export // `filter: blur(Npx)` alone (the "glow" decoration pattern) maps 1:1 to feGaussianBlur.
const pureBlur = (filter: string | undefined): number | null => {
  const m = (filter || '').trim().match(/^blur\(\s*([\d.]+)px\s*\)$/);
  return m ? parseFloat(m[1]) : null;
};
