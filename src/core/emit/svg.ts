import type {
  Scene,
  PaintNode,
  BoxNode,
  TextNode,
  ImageNode,
  RasterNode,
  Clip,
  CornerRadii,
  BorderEdges,
  LinearGradientFill,
} from '../ir/types.js';

const n = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function roundedRectPath(x: number, y: number, w: number, h: number, radii: CornerRadii): string {
  let [tl, tr, br, bl] = radii;
  const maxR = Math.min(w, h) / 2;
  tl = Math.min(tl, maxR);
  tr = Math.min(tr, maxR);
  br = Math.min(br, maxR);
  bl = Math.min(bl, maxR);
  return [
    `M${n(x + tl)},${n(y)}`,
    `H${n(x + w - tr)}`,
    tr ? `A${n(tr)},${n(tr)} 0 0 1 ${n(x + w)},${n(y + tr)}` : '',
    `V${n(y + h - br)}`,
    br ? `A${n(br)},${n(br)} 0 0 1 ${n(x + w - br)},${n(y + h)}` : '',
    `H${n(x + bl)}`,
    bl ? `A${n(bl)},${n(bl)} 0 0 1 ${n(x)},${n(y + h - bl)}` : '',
    `V${n(y + tl)}`,
    tl ? `A${n(tl)},${n(tl)} 0 0 1 ${n(x + tl)},${n(y)}` : '',
    'Z',
  ]
    .filter(Boolean)
    .join(' ');
}

const uniformRadii = (r: CornerRadii) => r[0] === r[1] && r[1] === r[2] && r[2] === r[3];
const noRadii = (r: CornerRadii) => r[0] === 0 && r[1] === 0 && r[2] === 0 && r[3] === 0;

class Defs {
  private items = new Map<string, string>();
  private seq = 0;
  add(content: string): string {
    const existing = this.items.get(content);
    if (existing) return existing;
    const id = 'd' + this.seq++;
    this.items.set(content, id);
    return id;
  }
  render(): string {
    if (this.items.size === 0) return '';
    const body = Array.from(this.items.entries())
      .map(([content, id]) => content.replace('{ID}', id))
      .join('');
    return `<defs>${body}</defs>`;
  }
}

function clipId(defs: Defs, clip: Clip): string {
  const inner = noRadii(clip.radii)
    ? `<rect x="${n(clip.x)}" y="${n(clip.y)}" width="${n(clip.width)}" height="${n(clip.height)}"/>`
    : `<path d="${roundedRectPath(clip.x, clip.y, clip.width, clip.height, clip.radii)}"/>`;
  return defs.add(`<clipPath id="{ID}">${inner}</clipPath>`);
}

function shadowFilterId(defs: Defs, blur: number): string {
  const std = n(blur / 2);
  return defs.add(
    `<filter id="{ID}" x="-50%" y="-50%" width="200%" height="200%">` +
      `<feGaussianBlur stdDeviation="${std}"/></filter>`,
  );
}

function emitBox(node: BoxNode, defs: Defs): string {
  const { rect, radii } = node;
  let out = '';

  for (const sh of node.shadows || []) {
    const sx = rect.x + sh.offsetX - sh.spread;
    const sy = rect.y + sh.offsetY - sh.spread;
    const sw = rect.width + sh.spread * 2;
    const sh2 = rect.height + sh.spread * 2;
    if (sw <= 0 || sh2 <= 0) continue;
    const shape = noRadii(radii)
      ? `<rect x="${n(sx)}" y="${n(sy)}" width="${n(sw)}" height="${n(sh2)}" fill="${esc(sh.color)}"/>`
      : `<path d="${roundedRectPath(sx, sy, sw, sh2, radii)}" fill="${esc(sh.color)}"/>`;
    const filt = sh.blur > 0 ? ` filter="url(#${shadowFilterId(defs, sh.blur)})"` : '';
    out += `<g${filt}>${shape}</g>`;
  }

  if (node.fill) out += fillShape(rect, radii, esc(node.fill));
  if (node.gradient) out += fillShape(rect, radii, `url(#${gradientId(defs, node.gradient, rect)})`);

  if (node.border) out += emitBorder(node.border, rect, radii);
  return out;
}

function fillShape(
  rect: { x: number; y: number; width: number; height: number },
  radii: CornerRadii,
  fill: string,
): string {
  if (noRadii(radii)) {
    return `<rect x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(
      rect.height,
    )}" fill="${fill}"/>`;
  }
  if (uniformRadii(radii)) {
    return `<rect x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(
      rect.height,
    )}" rx="${n(radii[0])}" fill="${fill}"/>`;
  }
  return `<path d="${roundedRectPath(rect.x, rect.y, rect.width, rect.height, radii)}" fill="${fill}"/>`;
}

function splitColor(c: string): { color: string; opacity: string } {
  const m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/i);
  if (m && m[4] !== undefined && parseFloat(m[4]) < 1) {
    return { color: `rgb(${m[1]}, ${m[2]}, ${m[3]})`, opacity: m[4] };
  }
  return { color: c, opacity: '1' };
}

function gradientId(
  defs: Defs,
  g: LinearGradientFill,
  rect: { x: number; y: number; width: number; height: number },
): string {
  // CSS 0deg = to top; direction vector in screen coords (y down) = (sinθ, -cosθ)
  const dx = Math.sin((g.angle * Math.PI) / 180);
  const dy = -Math.cos((g.angle * Math.PI) / 180);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const len = (Math.abs(rect.width * dx) + Math.abs(rect.height * dy)) / 2;
  const x1 = cx - dx * len;
  const y1 = cy - dy * len;
  const x2 = cx + dx * len;
  const y2 = cy + dy * len;
  const stops = g.stops
    .map((s) => {
      const { color, opacity } = splitColor(s.color);
      const op = opacity !== '1' ? ` stop-opacity="${opacity}"` : '';
      return `<stop offset="${n(s.offset * 100)}%" stop-color="${esc(color)}"${op}/>`;
    })
    .join('');
  return defs.add(
    `<linearGradient id="{ID}" gradientUnits="userSpaceOnUse" x1="${n(x1)}" y1="${n(y1)}" x2="${n(
      x2,
    )}" y2="${n(y2)}">${stops}</linearGradient>`,
  );
}

function dash(style: string, w: number): string {
  if (style === 'dashed') return ` stroke-dasharray="${n(w * 2)},${n(w)}"`;
  if (style === 'dotted') return ` stroke-dasharray="${n(w)},${n(w)}" stroke-linecap="round"`;
  return '';
}

function emitBorder(b: BorderEdges, rect: { x: number; y: number; width: number; height: number }, radii: CornerRadii): string {
  const sameW = b.top.width === b.right.width && b.right.width === b.bottom.width && b.bottom.width === b.left.width;
  const sameC = b.top.color === b.right.color && b.right.color === b.bottom.color && b.bottom.color === b.left.color;
  const allSolid = [b.top, b.right, b.bottom, b.left].every((e) => e.style === 'solid' || e.width === 0);

  if (sameW && sameC && b.top.width > 0 && (allSolid || b.top.style === 'dashed' || b.top.style === 'dotted')) {
    const w = b.top.width;
    const half = w / 2;
    const x = rect.x + half;
    const y = rect.y + half;
    const ww = rect.width - w;
    const hh = rect.height - w;
    const d = dash(b.top.style, w);
    if (noRadii(radii)) {
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(ww)}" height="${n(hh)}" fill="none" stroke="${esc(
        b.top.color,
      )}" stroke-width="${n(w)}"${d}/>`;
    }
    const adj = radii.map((r) => Math.max(0, r - half)) as CornerRadii;
    return `<path d="${roundedRectPath(x, y, ww, hh, adj)}" fill="none" stroke="${esc(
      b.top.color,
    )}" stroke-width="${n(w)}"${d}/>`;
  }

  // per-side approximation: filled rectangles along each edge
  let out = '';
  const { x, y, width: w, height: h } = rect;
  if (b.top.width > 0)
    out += `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(b.top.width)}" fill="${esc(b.top.color)}"/>`;
  if (b.bottom.width > 0)
    out += `<rect x="${n(x)}" y="${n(y + h - b.bottom.width)}" width="${n(w)}" height="${n(
      b.bottom.width,
    )}" fill="${esc(b.bottom.color)}"/>`;
  if (b.left.width > 0)
    out += `<rect x="${n(x)}" y="${n(y)}" width="${n(b.left.width)}" height="${n(h)}" fill="${esc(
      b.left.color,
    )}"/>`;
  if (b.right.width > 0)
    out += `<rect x="${n(x + w - b.right.width)}" y="${n(y)}" width="${n(b.right.width)}" height="${n(
      h,
    )}" fill="${esc(b.right.color)}"/>`;
  return out;
}

function emitText(node: TextNode): string {
  const attrs =
    `font-family="${esc(node.fontFamily)}" font-size="${n(node.fontSize)}" ` +
    `font-weight="${esc(node.fontWeight)}" font-style="${esc(node.fontStyle)}" fill="${esc(node.color)}"` +
    (node.letterSpacing ? ` letter-spacing="${n(node.letterSpacing)}"` : '') +
    (node.wordSpacing ? ` word-spacing="${n(node.wordSpacing)}"` : '') +
    (node.decoration ? ` text-decoration="${esc(node.decoration)}"` : '') +
    (node.textAnchor && node.textAnchor !== 'start' ? ` text-anchor="${node.textAnchor}"` : '');
  return node.lines
    .map((l) => `<text x="${n(l.x)}" y="${n(l.baseline)}" ${attrs}>${esc(l.text)}</text>`)
    .join('');
}

function emitImage(node: ImageNode): string {
  if (!node.href) return '';
  const { rect } = node;
  return `<image x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(
    rect.height,
  )}" preserveAspectRatio="${node.preserveAspectRatio || 'none'}" href="${node.href}"/>`;
}

function emitRaster(node: RasterNode): string {
  if (!node.href) return '';
  const { rect } = node;
  return `<image x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(
    rect.height,
  )}" preserveAspectRatio="none" href="${node.href}"/>`;
}

function wrap(node: PaintNode, inner: string, defs: Defs): string {
  if (!inner) return '';
  const parts: string[] = [];
  if (node.opacity < 0.999) parts.push(`opacity="${n(node.opacity)}"`);
  if (node.clip && node.clip.width > 0 && node.clip.height > 0)
    parts.push(`clip-path="url(#${clipId(defs, node.clip)})"`);
  if (parts.length === 0) return inner;
  return `<g ${parts.join(' ')}>${inner}</g>`;
}

export function emitSvg(scene: Scene): string {
  const defs = new Defs();
  const body: string[] = [];

  for (const node of scene.nodes) {
    let inner = '';
    switch (node.kind) {
      case 'box':
        inner = emitBox(node, defs);
        break;
      case 'text':
        inner = emitText(node);
        break;
      case 'image':
        inner = emitImage(node);
        break;
      case 'raster':
        inner = emitRaster(node);
        break;
    }
    body.push(wrap(node, inner, defs));
  }

  const bg = scene.background
    ? `<rect x="0" y="0" width="${n(scene.width)}" height="${n(scene.height)}" fill="${esc(
        scene.background,
      )}"/>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(scene.width)}" height="${n(
      scene.height,
    )}" viewBox="0 0 ${n(scene.width)} ${n(scene.height)}">` +
    emitFonts(scene.fonts) +
    defs.render() +
    bg +
    body.join('') +
    `</svg>`
  );
}

function emitFonts(fonts: Scene['fonts']): string {
  if (!fonts || fonts.length === 0) return '';
  const faces = fonts
    .map(
      (f) =>
        `@font-face{font-family:'${f.family.replace(/'/g, '')}';` +
        `font-weight:${f.weight};font-style:${f.style};` +
        `src:url(${f.src}) format('${f.format}');}`,
    )
    .join('');
  return `<style>${faces}</style>`;
}
