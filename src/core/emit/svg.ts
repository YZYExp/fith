import type {
  Scene,
  PaintNode,
  BoxNode,
  TextNode,
  ImageNode,
  InlineSvgNode,
  RasterNode,
  Clip,
  CornerRadii,
  BorderEdges,
  LinearGradientFill,
} from '../ir/types.js';
import type { Outliner } from './outline.js';

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

// CSS box-shadow is always drawn OUTSIDE the element's border box (the element
// acts as a "cutout"). We replicate this with an SVG mask: white everywhere
// (show shadow), but black inside the element box (hide shadow).
function shadowMaskId(
  defs: Defs,
  rect: { x: number; y: number; width: number; height: number },
  radii: CornerRadii,
): string {
  const innerPath = noRadii(radii)
    ? `M${n(rect.x)},${n(rect.y)} H${n(rect.x + rect.width)} V${n(rect.y + rect.height)} H${n(rect.x)} Z`
    : roundedRectPath(rect.x, rect.y, rect.width, rect.height, radii);
  // Large white rect (show everything), then black path inside element box (hide shadow there).
  return defs.add(
    `<mask id="{ID}" maskContentUnits="userSpaceOnUse">` +
      `<rect x="-9999" y="-9999" width="99999" height="99999" fill="white"/>` +
      `<path d="${innerPath}" fill="black"/>` +
      `</mask>`,
  );
}

function emitBox(node: BoxNode, defs: Defs): string {
  const { rect, radii } = node;
  let out = '';

  const shadows = node.shadows || [];
  if (shadows.length > 0) {
    // All shadow layers share the same mask (they all mask to the same element box).
    const mask = shadowMaskId(defs, rect, radii);
    for (const sh of shadows) {
      const sx = rect.x + sh.offsetX - sh.spread;
      const sy = rect.y + sh.offsetY - sh.spread;
      const sw = rect.width + sh.spread * 2;
      const sh2 = rect.height + sh.spread * 2;
      if (sw <= 0 || sh2 <= 0) continue;
      const shape = noRadii(radii)
        ? `<rect x="${n(sx)}" y="${n(sy)}" width="${n(sw)}" height="${n(sh2)}" fill="${esc(sh.color)}"/>`
        : `<path d="${roundedRectPath(sx, sy, sw, sh2, radii)}" fill="${esc(sh.color)}"/>`;
      // Apply mask to prevent shadow from appearing inside the element box.
      // Use nested groups: outer group has the mask, inner group applies the blur filter.
      if (sh.blur > 0) {
        out += `<g mask="url(#${mask})"><g filter="url(#${shadowFilterId(defs, sh.blur)})">${shape}</g></g>`;
      } else {
        out += `<g mask="url(#${mask})">${shape}</g>`;
      }
    }
  }

  if (node.fill) out += fillShape(rect, radii, esc(node.fill));
  if (node.gradient) out += fillShape(rect, radii, `url(#${gradientId(defs, node.gradient, rect)})`);

  if (node.border) out += emitBorder(node.border, rect, radii);

  if (node.outline) {
    const o = node.outline;
    // Stroke center is outlineOffset + outlineWidth/2 outside the border box.
    const exp = o.offset + o.width / 2;
    const ox = rect.x - exp;
    const oy = rect.y - exp;
    const ow = rect.width + 2 * exp;
    const oh = rect.height + 2 * exp;
    const d = dash(o.style, o.width);
    if (noRadii(radii)) {
      out += `<rect x="${n(ox)}" y="${n(oy)}" width="${n(ow)}" height="${n(oh)}" fill="none" stroke="${esc(o.color)}" stroke-width="${n(o.width)}"${d}/>`;
    } else {
      // Outline follows border-radius; the radius at the stroke center grows by outlineOffset.
      const adj = radii.map((r) => Math.max(0, r + o.offset)) as CornerRadii;
      out += `<path d="${roundedRectPath(ox, oy, ow, oh, adj)}" fill="none" stroke="${esc(o.color)}" stroke-width="${n(o.width)}"${d}/>`;
    }
  }

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

function emitText(node: TextNode, defs: Defs, outline?: Outliner): string {
  const fill = node.gradientFill
    ? `url(#${gradientId(defs, node.gradientFill, node.rect)})`
    : esc(node.color);

  if (outline && !node.gradientFill) {
    const paths: string[] = [];
    let allOutlined = true;
    for (const l of node.lines) {
      const d = outline(node, l);
      if (d) paths.push(`<path d="${d}" fill="${esc(node.color)}"/>`);
      else {
        allOutlined = false;
        break;
      }
    }
    if (allOutlined) return paths.join('');
    // fall through to <text> if any line couldn't be outlined
  }
  const weightAttr = node.fontWeight === '400' || node.fontWeight === 'normal' ? '' : ` font-weight="${esc(node.fontWeight)}"`;
  const styleAttr = node.fontStyle === 'normal' ? '' : ` font-style="${esc(node.fontStyle)}"`;
  const attrs =
    `font-family="${esc(node.fontFamily)}" font-size="${n(node.fontSize)}"${weightAttr}${styleAttr} fill="${fill}"` +
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

function splitInlineSvg(markup: string): { open: string; rest: string; x: string; y: string } {
  const gt = markup.indexOf('>');
  let open = markup.slice(0, gt + 1);
  const rest = markup.slice(gt + 1);
  const x = (open.match(/\sx="([^"]*)"/) || [])[1] ?? '0';
  const y = (open.match(/\sy="([^"]*)"/) || [])[1] ?? '0';
  open = open.replace(/\sx="[^"]*"/, '').replace(/\sy="[^"]*"/, '');
  return { open, rest, x, y };
}

function emitInlineSvg(node: InlineSvgNode, defs: Defs, dedupe: boolean): string {
  if (!dedupe) return node.markup;
  const { open, rest, x, y } = splitInlineSvg(node.markup);
  const symbol = open.replace(/^<svg/, '<svg id="{ID}"') + rest;
  const id = defs.add(symbol);
  return `<use href="#${id}" x="${x}" y="${y}"/>`;
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

export interface EmitOptions {
  /** When provided, text is converted to glyph <path> outlines where possible. */
  outline?: Outliner;
}

export function emitSvg(scene: Scene, opts: EmitOptions = {}): string {
  const defs = new Defs();
  const body: string[] = [];

  // count repeated icons (position-independent) so only repeats go to defs+use
  const iconCounts = new Map<string, number>();
  for (const node of scene.nodes) {
    if (node.kind !== 'inline-svg') continue;
    const { open, rest } = splitInlineSvg(node.markup);
    const key = open + rest;
    iconCounts.set(key, (iconCounts.get(key) || 0) + 1);
  }

  for (const node of scene.nodes) {
    let inner = '';
    switch (node.kind) {
      case 'box':
        inner = emitBox(node, defs);
        break;
      case 'text':
        inner = emitText(node, defs, opts.outline);
        break;
      case 'image':
        inner = emitImage(node);
        break;
      case 'inline-svg': {
        const { open, rest } = splitInlineSvg(node.markup);
        inner = emitInlineSvg(node, defs, (iconCounts.get(open + rest) || 0) >= 2);
        break;
      }
      case 'raster':
        inner = emitRaster(node);
        break;
    }
    body.push(wrap(node, inner, defs));
  }

  const ox = scene.originX ?? 0;
  const oy = scene.originY ?? 0;

  // Base layer: full-page screenshot painted before everything else.
  // When present it acts as a visual floor — content the DOM walk missed stays visible.
  const baseLayerEl = scene.baseLayer
    ? `<image x="${n(ox)}" y="${n(oy)}" width="${n(scene.width)}" height="${n(scene.height)}" preserveAspectRatio="none" href="${scene.baseLayer}"/>`
    : '';

  // Skip the solid background rect when a base layer is present — the screenshot
  // already contains the page background at pixel-perfect quality.
  const bg =
    !scene.baseLayer && scene.background
      ? `<rect x="${n(ox)}" y="${n(oy)}" width="${n(scene.width)}" height="${n(scene.height)}" fill="${esc(
          scene.background,
        )}"/>`
      : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(scene.width)}" height="${n(
      scene.height,
    )}" viewBox="${n(ox)} ${n(oy)} ${n(scene.width)} ${n(scene.height)}">` +
    emitFonts(scene.fonts) +
    defs.render() +
    baseLayerEl +
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
