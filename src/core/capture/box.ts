/** An element's own box: background, border, shadows and generated (pseudo-element) boxes, as `box` paint nodes. */
import type { CaptureCtx } from './ctx.js';
import type { PaintNode, Clip } from '../ir/types.js';
import { radiiOf, radiiYOf, intersect, clipsContent, paddingBoxOf, layerUrl } from './background.js';
import { num, splitTopLevel } from '../../css/util.js';
import { transparent } from '../../css/color.js';
import { pureBlur } from '../../css/filter.js';
import { captureText } from './text.js';

// Build a BorderEdges object from any computed style (element or pseudo-element).
// Shared by emitBox and tryPseudoBox, which need the same four-edge shape.
export const buildBorder = (ctx: CaptureCtx, s: CSSStyleDeclaration) => {
  const bw = {
    top: num(s.borderTopWidth),
    right: num(s.borderRightWidth),
    bottom: num(s.borderBottomWidth),
    left: num(s.borderLeftWidth),
  };
  const hasBorder = bw.top + bw.right + bw.bottom + bw.left > 0;
  const border = hasBorder
    ? {
        top: { width: bw.top, color: ctx.normColor(s.borderTopColor), style: s.borderTopStyle },
        right: { width: bw.right, color: ctx.normColor(s.borderRightColor), style: s.borderRightStyle },
        bottom: { width: bw.bottom, color: ctx.normColor(s.borderBottomColor), style: s.borderBottomStyle },
        left: { width: bw.left, color: ctx.normColor(s.borderLeftColor), style: s.borderLeftStyle },
      }
    : null;
  return { hasBorder, border };
};

export const emitBox = (ctx: CaptureCtx, el: Element, cs: CSSStyleDeclaration, clip: Clip | null, opacity: number) => {
  const r = el.getBoundingClientRect();
  const textClipped = cs.backgroundClip === 'text' || cs.backgroundClip === '-webkit-text';
  // <body>'s background propagates to the canvas when <html> has none: it paints beneath everything
  // (incl. negative z-index layers) and is already the scene background.
  const canvasBg = !ctx.subtree && el === ctx.doc.body && transparent(ctx.win.getComputedStyle(ctx.doc.documentElement).backgroundColor);
  const fill = textClipped || canvasBg || transparent(cs.backgroundColor) ? null : ctx.normColor(cs.backgroundColor);
  const { border } = buildBorder(ctx, cs);
  const shadows = ctx.parseShadows(cs.boxShadow);
  const bgLayers = !textClipped && cs.backgroundImage && cs.backgroundImage !== 'none' ? ctx.parseBgLayers(cs, paddingBoxOf(el, cs)) : null;
  const bgImg0 = textClipped ? null : ctx.bgImageLayer(el, cs);
  // general engine only when neither the gradient fast path nor the single-image path applies
  const general = !bgLayers && !bgImg0 && !textClipped && cs.backgroundImage && cs.backgroundImage !== 'none' ? ctx.parseBackgroundLayers(el, cs) : null;
  const gradient: any = bgLayers
    ? bgLayers.length === 1 ? bgLayers[0] : null
    : general ? null
    : !textClipped && cs.backgroundImage && cs.backgroundImage !== 'none' ? ctx.parseFirstLinearGradient(cs.backgroundImage) : null;
  const gradients = bgLayers && bgLayers.length > 1 ? bgLayers.slice().reverse() : undefined;
  const outlineW = num(cs.outlineWidth);
  const outlineStyle = cs.outlineStyle;
  const outline =
    outlineW > 0 && outlineStyle !== 'none' && !transparent(cs.outlineColor)
      ? { width: outlineW, color: ctx.normColor(cs.outlineColor), style: outlineStyle, offset: num(cs.outlineOffset) }
      : null;
  const bgImg = general ? null : bgImg0;
  if (!fill && !gradient && !gradients && !general && !border && shadows.length === 0 && !outline && !bgImg && !(cs.boxShadow || '').includes('inset')) return;
  const blur = el.childNodes.length === 0 && !ctx.groupedEls.has(el) ? pureBlur(cs.filter) : null;
  const insetShadows = ctx.parseInsetShadows(cs.boxShadow) || [];
  if (fill || gradient || gradients || general || border || shadows.length > 0 || outline || insetShadows.length > 0)
  ctx.nodes.push({
    kind: 'box',
    id: ctx.nid(),
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    opacity,
    clip,
    blur: blur || undefined,
    fill,
    gradient,
    gradients,
    bgLayers: general || undefined,
    radii: radiiOf(cs, r.width, r.height),
    radiiY: radiiYOf(cs, r.width, r.height),
    border,
    shadows,
    insetShadows: insetShadows.length ? insetShadows : undefined,
    outline,
  });
  if (bgImg) {
    ctx.nodes.push({
      kind: 'image',
      id: ctx.nid(),
      rect: bgImg.rect,
      opacity,
      clip: intersect(clip, { ...bgImg.clipBox, radii: bgImg.radii }),
      href: bgImg.href,
      preserveAspectRatio: 'none',
    } as PaintNode);
  }
};

// Attempt to vectorize a decorative ::before/::after pseudo-element as a box
// node, instead of rastering the whole host container (which turns the host's
// text into a fuzzy bitmap and double-paints it under the vector layer).
// Returns { handled:false } when the pseudo can't be reproduced as a vector
// box — text/image content, flow positioning, auto insets, un-vectorizable
// background/border — so the caller falls back to raster. Supported: the
// ubiquitous full/inset overlay & scrim pattern (absolutely-positioned,
// empty-content pseudo whose host is its containing block and whose four
// insets are all resolved lengths), which is geometry we can derive exactly.
export const tryPseudoBox = (ctx: CaptureCtx, 
  el: Element,
  csEl: CSSStyleDeclaration,
  sel: '::before' | '::after',
  clip: Clip | null,
  opacity: number,
): { handled: boolean; node?: PaintNode } => {
  const ps = ctx.win.getComputedStyle(el, sel);
  if (ps.display === 'none' || ps.visibility !== 'visible' || num(ps.opacity) === 0) return { handled: true };
  const content = ps.content;
  if (content === 'none') return { handled: true }; // generates no box at all
  // Only empty content yields a pure decorative box; text/url()/counter()/attr()
  // need real content rendering, which we can't place without flow geometry.
  if (!(content === '""' || content === "''" || content === 'normal' || content === ''))
    return { handled: false };
  const fixedPos = ps.position === 'fixed';
  if (ps.position !== 'absolute' && !fixedPos) return { handled: false };
  if (!fixedPos && csEl.position === 'static') return { handled: false }; // host isn't the containing block
  for (const s of ['top', 'right', 'bottom', 'left'] as const) {
    const v = ps.getPropertyValue(s);
    if (!v || v === 'auto') return { handled: false }; // width-based positioning → skip
  }
  const r = el.getBoundingClientRect();
  // Containing block: the host padding box for absolute; the viewport for fixed (scroll is
  // reset to 0 for the capture, so viewport px == page px).
  const cbX = fixedPos ? 0 : r.left + num(csEl.borderLeftWidth);
  const cbY = fixedPos ? 0 : r.top + num(csEl.borderTopWidth);
  const cbW = fixedPos ? ctx.doc.documentElement.clientWidth : r.width - num(csEl.borderLeftWidth) - num(csEl.borderRightWidth);
  const cbH = fixedPos ? ctx.win.innerHeight : r.height - num(csEl.borderTopWidth) - num(csEl.borderBottomWidth);
  const x = cbX + num(ps.left) + num(ps.marginLeft);
  const y = cbY + num(ps.top) + num(ps.marginTop);
  const width = cbX + cbW - num(ps.right) - num(ps.marginRight) - x;
  const height = cbY + cbH - num(ps.bottom) - num(ps.marginBottom) - y;
  if (width <= 0 || height <= 0) return { handled: true }; // collapsed → nothing visible

  const hasBgImg = ps.backgroundImage && ps.backgroundImage !== 'none';
  const pbl = hasBgImg ? ctx.parseBgLayers(ps, { x, y, width, height }) : null;
  const gradient: any = pbl ? (pbl.length === 1 ? pbl[0] : null) : hasBgImg ? ctx.parseFirstLinearGradient(ps.backgroundImage) : null;
  const pseudoGradients = pbl && pbl.length > 1 ? pbl.slice().reverse() : undefined;
  if (hasBgImg && !gradient && !pseudoGradients) return { handled: false }; // url()/conic/tiled
  if (ps.boxShadow && ps.boxShadow.includes('inset')) return { handled: false };
  const blur = ps.filter && ps.filter !== 'none' ? pureBlur(ps.filter) : 0;
  if (blur === null) return { handled: false }; // other filter functions
  const { hasBorder, border } = buildBorder(ctx, ps);
  if (hasBorder) {
    for (const st of [ps.borderTopStyle, ps.borderRightStyle, ps.borderBottomStyle, ps.borderLeftStyle])
      if (st === 'double' || st === 'groove' || st === 'ridge' || st === 'inset' || st === 'outset')
        return { handled: false };
  }
  const fill = transparent(ps.backgroundColor) ? null : ctx.normColor(ps.backgroundColor);
  const shadows = ctx.parseShadows(ps.boxShadow);
  if (!fill && !gradient && !pseudoGradients && !border && shadows.length === 0) return { handled: true }; // nothing to draw

  // Clip the pseudo to the host's rounded content box when the host clips overflow,
  // so an inset overlay follows the card's rounded corners.
  const pseudoClip = clipsContent(csEl)
    ? intersect(clip, { x: r.left, y: r.top, width: r.width, height: r.height, radii: radiiOf(csEl, r.width, r.height) })
    : clip;
  return {
    handled: true,
    node: {
      kind: 'box',
      id: ctx.nid(),
      rect: { x, y, width, height },
      opacity: opacity * num(ps.opacity),
      clip: pseudoClip,
      blur: blur || undefined,
      fill,
      gradient,
      gradients: pseudoGradients,
      radii: radiiOf(ps, width, height),
      border,
      shadows,
      outline: null,
    } as PaintNode,
  };
};

// Pseudo-elements with text content (icon fonts: `::before{content:"\e900"}`)
// have no DOM node to measure. Temporarily replace the pseudo with a real <span>
// carrying its exact computed style, capture that as a normal box + text node,
// then restore the DOM. Returns the produced nodes, or null if not applicable.
export const materializePseudo = (ctx: CaptureCtx, 
  el: Element,
  sel: '::before' | '::after',
  clip: Clip | null,
  opacity: number,
): PaintNode[] | null => {
  const ps = ctx.win.getComputedStyle(el, sel);
  // content: "text" | "" (decorative box: carets, dots, bars, clearfix) | attr(name)
  const m = ps.content.match(/^(["'])([\s\S]*)\1$/);
  const am = ps.content.match(/^attr\(\s*([\w-]+)\s*\)$/);
  if (!m && !am) return null; // url()/counter()/quotes: not plain text
  // url() backgrounds are pre-loaded by walkNode (prepareImageLayers on the pseudo style); an unloaded one → raster
  if ((ps.backgroundImage || '').includes('url(') && !splitTopLevel(ps.backgroundImage).every((l) => l.trim() === 'none' || /gradient\(/.test(l) || (layerUrl(l) !== null && ctx.imgInfo.get(layerUrl(l)!)))) return null;
  const text = am
    ? el.getAttribute(am[1]) || ''
    : m![2]
        .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/\\([\s\S])/g, '$1');
  if (!text && ps.display === 'inline') return null; // empty inline pseudo paints nothing
  const span = ctx.doc.createElement('span');
  for (let i = 0; i < ps.length; i++) span.style.setProperty(ps[i], ps.getPropertyValue(ps[i]));
  span.style.setProperty('animation', 'none');
  span.style.setProperty('transition', 'none');
  span.textContent = text;
  const host = el as HTMLElement;
  const attr = 'data-fith-pseudo-host';
  const style = ctx.doc.createElement('style');
  style.textContent = `[${attr}]${sel}{content:none !important}`;
  ctx.doc.head.appendChild(style);
  host.setAttribute(attr, '');
  if (sel === '::before') host.insertBefore(span, host.firstChild);
  else host.appendChild(span);
  const start = ctx.nodes.length;
  try {
    const scs = ctx.win.getComputedStyle(span);
    const op = opacity * num(ps.opacity);
    emitBox(ctx, span, scs, clip, op);
    captureText(ctx, span, scs, clip, op);
  } finally {
    span.remove();
    style.remove();
    host.removeAttribute(attr);
  }
  return ctx.nodes.splice(start);
};
