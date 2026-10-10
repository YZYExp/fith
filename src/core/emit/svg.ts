import type {
  Scene,
  PaintNode,
  BoxNode,
  TextNode,
  ImageNode,
  InlineSvgNode,
  RasterNode,
  CornerRadii,
  BorderEdges,
  BgLayer,
} from '../ir/types.js';
import type { Outliner } from './outline.js';
import { n, esc, uniformRadii, noRadii, roundedRectPath } from './primitives.js';
import { Defs, clipId, filterChainId, shapeClipId, conicWedges, blurFilterId, shadowFilterId, shadowMaskId, gradientId, maskGradientId } from './defs.js';

/** Sharp inset shadows: padding box minus the (offset, spread-shrunk) hole, clipped to the padding box. */
function emitInsetShadows(node: BoxNode, defs: Defs): string {
  const { rect, radii, border } = node;
  const bt = border?.top.width ?? 0, br = border?.right.width ?? 0, bb = border?.bottom.width ?? 0, bl = border?.left.width ?? 0;
  const px = rect.x + bl, py = rect.y + bt, pw = rect.width - bl - br, ph = rect.height - bt - bb;
  if (pw <= 0 || ph <= 0) return '';
  const pr = [Math.max(0, radii[0] - Math.max(bl, bt)), Math.max(0, radii[1] - Math.max(br, bt)), Math.max(0, radii[2] - Math.max(br, bb)), Math.max(0, radii[3] - Math.max(bl, bb))] as CornerRadii;
  const clip = defs.add(`<clipPath id="{ID}"><path d="${roundedRectPath(px, py, pw, ph, pr)}"/></clipPath>`);
  let out = '';
  for (const sh of node.insetShadows!) {
    const hx = px + sh.offsetX + sh.spread, hy = py + sh.offsetY + sh.spread;
    const hw = pw - sh.spread * 2, hh = ph - sh.spread * 2;
    // the shadow ring = a large frame minus the (offset, spread-shrunk) hole; blurring the frame lets
    // the blur bleed inward across the padding-box edge, and the clip trims what falls outside
    const big = 3 * (sh.blur ?? 0) + Math.abs(sh.offsetX) + Math.abs(sh.offsetY) + sh.spread + 8;
    const frame = `M${n(px - big)},${n(py - big)}H${n(px + pw + big)}V${n(py + ph + big)}H${n(px - big)}Z`;
    let d = frame;
    if (hw > 0 && hh > 0) {
      const hr = pr.map((v) => Math.max(0, v - sh.spread)) as CornerRadii;
      d += ' ' + roundedRectPath(hx, hy, hw, hh, hr);
    } else {
      d = frame; // spread swallowed the box: solid fill
    }
    const filt = sh.blur && sh.blur > 0 ? ` filter="url(#${blurFilterId(defs, sh.blur / 2, { x: px - big, y: py - big, width: pw + big * 2, height: ph + big * 2 })})"` : '';
    out += `<g clip-path="url(#${clip})"><path fill-rule="evenodd" d="${d}" fill="${esc(sh.color)}"${filt}/></g>`;
  }
  return out;
}

/** One general background layer: a <pattern> tile painted over its clip box (a single tile when not repeating). */
function emitBgLayer(L: BgLayer, defs: Defs): string {
  const { tile, clip } = L;
  if (tile.width <= 0 || tile.height <= 0 || clip.width <= 0 || clip.height <= 0) return '';
  let content = '';
  if (L.gradient) {
    const g = L.gradient;
    if (g.type === 'conic-gradient') content = conicWedges(g, { x: 0, y: 0, width: tile.width, height: tile.height });
    else content = `<rect width="${n(tile.width)}" height="${n(tile.height)}" fill="url(#${gradientId(defs, g, { x: 0, y: 0, width: tile.width, height: tile.height })})"/>`;
  } else if (L.href) {
    content = `<image width="${n(tile.width)}" height="${n(tile.height)}" preserveAspectRatio="none" href="${L.href}"/>`;
  } else return '';
  const pat = defs.add(
    `<pattern id="{ID}" patternUnits="userSpaceOnUse" x="${n(tile.x)}" y="${n(tile.y)}" width="${n(tile.width)}" height="${n(tile.height)}"` +
      `${L.gradient?.type === 'conic-gradient' ? ' overflow="hidden"' : ''}>${content}</pattern>`,
  );
  // paint only where tiles exist: the whole clip box when repeating on an axis, else the single tile span
  const x0 = L.repeatX ? clip.x : Math.max(clip.x, tile.x);
  const x1 = L.repeatX ? clip.x + clip.width : Math.min(clip.x + clip.width, tile.x + tile.width);
  const y0 = L.repeatY ? clip.y : Math.max(clip.y, tile.y);
  const y1 = L.repeatY ? clip.y + clip.height : Math.min(clip.y + clip.height, tile.y + tile.height);
  if (x1 <= x0 || y1 <= y0) return '';
  const cid = clipId(defs, { ...clip, radii: L.clipRadii });
  return `<g clip-path="url(#${cid})"><rect x="${n(x0)}" y="${n(y0)}" width="${n(x1 - x0)}" height="${n(y1 - y0)}" fill="url(#${pat})"/></g>`;
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

  if (node.fill) out += fillShape(rect, radii, esc(node.fill), node.radiiY);
  const paintGradient = (g: NonNullable<BoxNode['gradient']>) => {
    if (g.type !== 'conic-gradient') return fillShape(rect, radii, `url(#${gradientId(defs, g, rect)})`, node.radiiY);
    // wedge fan clipped to the (rounded) box
    const cid = clipId(defs, { ...rect, radii });
    return `<g clip-path="url(#${cid})">${conicWedges(g, rect)}</g>`;
  };
  if (node.bgLayers) for (const L of node.bgLayers) out += emitBgLayer(L, defs);
  if (node.gradient) out += paintGradient(node.gradient);
  for (const g of node.gradients ?? []) out += paintGradient(g);

  if (node.insetShadows && node.insetShadows.length > 0) out += emitInsetShadows(node, defs);

  if (node.border) out += emitBorder(node.border, rect, radii, defs);

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
  radiiY?: CornerRadii,
): string {
  if (radiiY) return `<path d="${roundedRectPath(rect.x, rect.y, rect.width, rect.height, radii, radiiY)}" fill="${fill}"/>`;
  if (noRadii(radii)) {
    return `<rect x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(
      rect.height,
    )}" fill="${fill}"/>`;
  }
  if (uniformRadii(radii)) {
    // SVG clamps rx to width/2 and ry (=rx) to height/2 *separately*: a 9999px pill would become a
    // lens. CSS clamps the radius itself to half the shorter side.
    const rr = Math.min(radii[0], rect.width / 2, rect.height / 2);
    return `<rect x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(
      rect.height,
    )}" rx="${n(rr)}" fill="${fill}"/>`;
  }
  return `<path d="${roundedRectPath(rect.x, rect.y, rect.width, rect.height, radii)}" fill="${fill}"/>`;
}

function dash(style: string, w: number): string {
  if (style === 'dashed') return ` stroke-dasharray="${n(w * 2)},${n(w)}"`;
  if (style === 'dotted') return ` stroke-dasharray="${n(w)},${n(w)}" stroke-linecap="round"`;
  return '';
}

function emitBorder(b: BorderEdges, rect: { x: number; y: number; width: number; height: number }, radii: CornerRadii, defs: Defs): string {
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

  // Per-side borders: each edge is a mitered trapezoid (corner to corner, like the browser draws mixed
  // widths/colours — e.g. a zero-size box with three transparent edges is a CSS triangle). Transparent
  // edges are skipped; with radii the polygons are clipped to the rounded border ring.
  const { x, y, width: w, height: h } = rect;
  const t = b.top.width, r = b.right.width, bt = b.bottom.width, l = b.left.width;
  const visible = (e: { width: number; color: string }) => e.width > 0 && !/^(transparent|rgba\([^)]*,\s*0(\.0+)?\))$/.test(e.color.trim());
  const poly = (pts: number[][], color: string) =>
    `<path d="M${pts.map((p) => `${n(p[0])},${n(p[1])}`).join('L')}Z" fill="${esc(color)}"/>`;
  let out = '';
  if (visible(b.top)) out += poly([[x, y], [x + w, y], [x + w - r, y + t], [x + l, y + t]], b.top.color);
  if (visible(b.right)) out += poly([[x + w, y], [x + w, y + h], [x + w - r, y + h - bt], [x + w - r, y + t]], b.right.color);
  if (visible(b.bottom)) out += poly([[x + w, y + h], [x, y + h], [x + l, y + h - bt], [x + w - r, y + h - bt]], b.bottom.color);
  if (visible(b.left)) out += poly([[x, y + h], [x, y], [x + l, y + t], [x + l, y + h - bt]], b.left.color);
  if (out && !noRadii(radii)) {
    const inner = [
      Math.max(0, radii[0] - Math.max(l, t)), Math.max(0, radii[1] - Math.max(r, t)),
      Math.max(0, radii[2] - Math.max(r, bt)), Math.max(0, radii[3] - Math.max(l, bt)),
    ] as CornerRadii;
    const ring = `${roundedRectPath(x, y, w, h, radii)} ${roundedRectPath(x + l, y + t, Math.max(0, w - l - r), Math.max(0, h - t - bt), inner)}`;
    out = `<g clip-path="url(#${defs.add(`<clipPath id="{ID}"><path clip-rule="evenodd" d="${ring}"/></clipPath>`)})">${out}</g>`;
  }
  return out;
}

function emitText(node: TextNode, defs: Defs, outline?: Outliner): string {
  const fill = node.gradientFill
    ? `url(#${gradientId(defs, node.gradientFill, node.gradientRect ?? node.rect)})`
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
  const decoVal = node.decoration
    ? node.decorationColor && node.decorationColor !== node.color
      ? `${node.decoration} ${esc(node.decorationColor)}`
      : node.decoration
    : null;
  const attrs =
    `font-family="${esc(node.fontFamily)}" font-size="${n(node.fontSize)}"${weightAttr}${styleAttr} fill="${fill}"` +
    (node.letterSpacing ? ` letter-spacing="${n(node.letterSpacing)}"` : '') +
    (node.wordSpacing ? ` word-spacing="${n(node.wordSpacing)}"` : '') +
    (decoVal ? ` text-decoration="${decoVal}"` : '') +
    (node.preserveSpace ? ' xml:space="preserve"' : '') +
    (node.fontExtra ? ` style="${esc(node.fontExtra)}"` : '') +
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
  // CSS applies filter before clip/opacity, so blur wraps the content innermost
  if (node.blur && node.blur > 0) inner = `<g filter="url(#${blurFilterId(defs, node.blur, node.rect)})">${inner}</g>`;
  const parts: string[] = [];
  if (node.opacity < 0.999) parts.push(`opacity="${n(node.opacity)}"`);
  if (node.clip && node.clip.width > 0 && node.clip.height > 0)
    parts.push(`clip-path="url(#${clipId(defs, node.clip)})"`);
  let out = parts.length === 0 ? inner : `<g ${parts.join(' ')}>${inner}</g>`;
  // transformed ancestors (rotate/skew), innermost first; each one's outer clip lives in the parent space
  for (const L of node.layers ?? []) {
    out = `<g transform="matrix(${L.matrix.map((v) => String(Math.round(v * 1e6) / 1e6)).join(' ')})">${out}</g>`;
    if (L.outerClip && L.outerClip.width > 0 && L.outerClip.height > 0) out = `<g clip-path="url(#${clipId(defs, L.outerClip)})">${out}</g>`;
  }
  // one nested <g> per mask: SVG allows a single mask per element
  for (const m of node.masks ?? []) out = `<g mask="url(#${maskGradientId(defs, m)})">${out}</g>`;
  for (const sh of node.clipShapes ?? []) out = `<g clip-path="url(#${shapeClipId(defs, sh)})">${out}</g>`;
  return out;
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

  // Group stack: consecutive nodes sharing an outer group id are wrapped in ONE <g> (filter / blend apply
  // to the composited subtree, not per node).
  const open: string[] = [];
  const closeTo = (keep: number) => {
    while (open.length > keep) {
      open.pop();
      body.push('</g>');
    }
  };
  for (const node of scene.nodes) {
    const chain = node.groups ? node.groups.slice().reverse() : []; // outermost first
    let common = 0;
    while (common < open.length && common < chain.length && open[common] === chain[common]) common++;
    closeTo(common);
    for (let gi = common; gi < chain.length; gi++) {
      const g = scene.groups?.[chain[gi]];
      let attrs = '';
      if (g?.filter && g.filter.length && g.region) attrs += ` filter="url(#${filterChainId(defs, g.filter, g.region)})"`;
      if (g?.blend) attrs += ` style="mix-blend-mode:${esc(g.blend)}"`;
      body.push(`<g${attrs}>`);
      open.push(chain[gi]);
    }
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
  closeTo(0);

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

  const content = emitFonts(scene.fonts) + defs.render() + baseLayerEl + bg + body.join('');

  // Transplanted inline-SVG icons (e.g. MUI/Material icons) may use the legacy
  // `xlink:href` form on <use>/<image>. Standalone SVG parsers treat an
  // undeclared namespace prefix as a fatal error — the whole document fails to
  // render past the first occurrence. Declare xmlns:xlink only when the content
  // actually references it, so plain SVGs stay free of the extra attribute.
  const xlinkNs = content.includes('xlink:') ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${xlinkNs} width="${n(scene.width)}" height="${n(
      scene.height,
    )}" viewBox="${n(ox)} ${n(oy)} ${n(scene.width)} ${n(scene.height)}">` +
    content +
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
        (f.unicodeRange ? `unicode-range:${f.unicodeRange};` : '') +
        `src:url(${f.src}) format('${f.format}');}`,
    )
    .join('');
  return `<style>${faces}</style>`;
}
