/**
 * Per-element decisions and the elements that are not plain boxes or text: visibility, what must be rastered,
 * inline SVG, images and canvases, plus the raster targets a backend fills with screenshots.
 */
import { TransformBail } from './ctx.js';
import type { CaptureCtx } from './ctx.js';
import type { PaintNode, Clip, CornerRadii } from '../ir/types.js';
import { radiiOf, intersect, clipsContent, paddingBoxOf, singleUrl, layerUrl } from './background.js';
import { fetchDataURL, normDataUrl } from './images.js';
import { num, splitTopLevel } from '../../css/util.js';
import { transparent } from '../../css/color.js';
import { parseMatrix } from '../../css/transform.js';
import { rrPath } from '../../css/clip.js';
import { vectorTextInput, nativeControl } from './text.js';

export const isVisible = (ctx: CaptureCtx, el: Element, cs: CSSStyleDeclaration) => {
  // display:none removes element from layout entirely — no descent possible
  if (cs.display === 'none') return false;
  // opacity:0 composites to invisible and cannot be overridden by children
  if (num(cs.opacity) === 0) return false;
  // Ancestors of a picked element only provide context (their own rendering is
  // skipped), and their boxes say nothing about where the root is: <body> is
  // routinely 0px tall when the app shell is position:fixed/absolute, and a wrapper
  // can sit entirely outside the captured region. Culling them by geometry would
  // drop the whole subtree and export an empty SVG.
  if (ctx.rootAncestors.has(el)) return true;
  // visually-hidden pattern: `clip: rect(...)` with no visible area (sr-only / aria-live regions)
  const clipRect = cs.getPropertyValue('clip').match(/^rect\(\s*(-?[\d.]+)(?:px)?[,\s]+(-?[\d.]+)(?:px)?[,\s]+(-?[\d.]+)(?:px)?[,\s]+(-?[\d.]+)(?:px)?\s*\)$/);
  if (clipRect && (cs.position === 'absolute' || cs.position === 'fixed') &&
      (parseFloat(clipRect[2]) - parseFloat(clipRect[4]) <= 0 || parseFloat(clipRect[3]) - parseFloat(clipRect[1]) <= 0)) return false;
  const r = el.getBoundingClientRect();
  // A 0×0 box with visible overflow can still hold painted descendants (Leaflet panes,
  // absolutely-positioned overlay roots), so only cull it when it has nothing to descend into.
  if (r.width === 0 && r.height === 0) return el.childElementCount > 0 && !clipsContent(cs);
  // inside a transform-cleared subtree rects are in local (untransformed) space, not page space
  if (ctx.transformDepth === 0 && (r.bottom < ctx.cullTop || r.right < ctx.cullLeft || r.top > ctx.cullBottom || r.left > ctx.cullRight))
    return false;
  return true;
  // NOTE: visibility:hidden is intentionally NOT checked here. Children can
  // override it with visibility:visible, so descent must continue. The walk()
  // function skips emitBox/captureText for the hidden element itself.
};

export const pseudoVisible = (ctx: CaptureCtx, el: Element, sel: string) => {
  const cs = ctx.win.getComputedStyle(el, sel);
  if (cs.display === 'none' || cs.visibility !== 'visible' || num(cs.opacity) === 0) return false;
  const content = cs.content;
  if (content === 'none' || content === 'normal') return false;
  const hasText = content && content !== 'none' && content !== 'normal' && content !== '""' && content !== "''";
  const hasBg = !transparent(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== 'none');
  const hasBorder =
    num(cs.borderTopWidth) + num(cs.borderRightWidth) + num(cs.borderBottomWidth) + num(cs.borderLeftWidth) > 0;
  return Boolean(hasText || hasBg || hasBorder);
};

export const parseClipShape = (el: Element, cs: CSSStyleDeclaration): { d: string; evenodd?: boolean } | null => {
  const v = (cs.clipPath || '').trim();
  const m = v.match(/^(inset|circle|ellipse|polygon)\((.*)\)\s*(border-box)?$/);
  if (!m) return null;
  const r = el.getBoundingClientRect();
  const w = r.width, h = r.height;
  if (w <= 0 || h <= 0) return null;
  const f = (n2: number) => String(Math.round(n2 * 100) / 100);
  const len = (t: string, ref: number) => (/%$/.test(t) ? (parseFloat(t) / 100) * ref : /px$/.test(t) ? parseFloat(t) : t === '0' ? 0 : NaN);
  const pos = (t: string[] | undefined, dw: number, dh: number): [number, number] | null => {
    if (!t || t.length === 0) return [r.left + dw / 2, r.top + dh / 2];
    const kx = (a: string) => (a === 'center' ? dw / 2 : a === 'left' ? 0 : a === 'right' ? dw : len(a, dw));
    const ky = (a: string) => (a === 'center' ? dh / 2 : a === 'top' ? 0 : a === 'bottom' ? dh : len(a, dh));
    let tx = t[0], ty = t[1] ?? 'center';
    if (t.length === 1 && (t[0] === 'top' || t[0] === 'bottom')) { ty = t[0]; tx = 'center'; }
    else if (/^(top|bottom)$/.test(t[0]) && t[1]) { tx = t[1]; ty = t[0]; }
    const px = kx(tx), py = ky(ty);
    return isFinite(px) && isFinite(py) ? [r.left + px, r.top + py] : null;
  };
  const body = m[2].trim();
  if (m[1] === 'inset') {
    const [offs, rnd] = body.split(/\bround\b/);
    const o = offs.trim().split(/\s+/).map((t, i, a) => len(t, (i % 2 === 0 ? (a.length === 1 ? 0 : h) : w)));
    const raw = offs.trim().split(/\s+/);
    const T = raw[0], R = raw[1] ?? raw[0], B = raw[2] ?? raw[0], L = raw[3] ?? raw[1] ?? raw[0];
    const top = len(T, h), right = len(R, w), bottom = len(B, h), left = len(L, w);
    if ([top, right, bottom, left].some((x) => !isFinite(x)) || o.length === 0) return null;
    const x = r.left + left, y = r.top + top, ww = w - left - right, hh = h - top - bottom;
    if (ww <= 0 || hh <= 0) return { d: 'M0,0Z' };
    let rad = [0, 0, 0, 0];
    if (rnd && rnd.trim()) {
      const rt = rnd.trim().split('/')[0].trim().split(/\s+/);
      const rv = rt.map((t) => len(t, Math.min(w, h)));
      if (rv.some((q) => !isFinite(q))) return null;
      rad = [rv[0], rv[1] ?? rv[0], rv[2] ?? rv[0], rv[3] ?? rv[1] ?? rv[0]];
    }
    return { d: rrPath(x, y, ww, hh, rad) };
  }
  if (m[1] === 'polygon') {
    let evenodd = false;
    let pts = body;
    const fr = pts.match(/^(nonzero|evenodd)\s*,\s*/);
    if (fr) { evenodd = fr[1] === 'evenodd'; pts = pts.slice(fr[0].length); }
    const out: string[] = [];
    for (const pr of splitTopLevel(pts)) {
      const [a, b] = pr.trim().split(/\s+/);
      const x = len(a, w), y = len(b, h);
      if (!isFinite(x) || !isFinite(y)) return null;
      out.push(`${out.length ? 'L' : 'M'}${f(r.left + x)},${f(r.top + y)}`);
    }
    return out.length >= 3 ? { d: out.join('') + 'Z', evenodd } : null;
  }
  // circle(r at x y) / ellipse(rx ry at x y)
  const [shp, at] = body.split(/\bat\b/);
  const c = pos(at ? at.trim().split(/\s+/) : undefined, w, h);
  if (!c) return null;
  const toks = shp.trim().split(/\s+/).filter(Boolean);
  const cxl = c[0] - r.left, cyl = c[1] - r.top;
  const near = (a: number, b: number) => Math.min(a, b), far = (a: number, b: number) => Math.max(a, b);
  const side = (kw: string, horiz: boolean) => {
    const a = horiz ? cxl : cyl, b = (horiz ? w : h) - a;
    return kw === 'closest-side' ? near(a, b) : far(a, b);
  };
  let rx: number, ry: number;
  if (m[1] === 'circle') {
    const t = toks[0];
    if (!t || t === 'farthest-side') rx = ry = far(far(cxl, w - cxl), far(cyl, h - cyl)); // default is closest-side per spec
    else if (t === 'closest-side') rx = ry = near(near(cxl, w - cxl), near(cyl, h - cyl));
    else rx = ry = len(t, Math.sqrt((w * w + h * h) / 2));
    if (!t) rx = ry = near(near(cxl, w - cxl), near(cyl, h - cyl));
  } else {
    const kx = toks[0], ky = toks[1];
    rx = !kx || /side$/.test(kx) ? side(kx || 'closest-side', true) : len(kx, w);
    ry = !ky || /side$/.test(ky) ? side(ky || 'closest-side', false) : len(ky, h);
  }
  if (!(rx > 0) || !(ry > 0) || !isFinite(rx) || !isFinite(ry)) return null;
  return { d: `M${f(c[0] - rx)},${f(c[1])}A${f(rx)},${f(ry)} 0 1 0 ${f(c[0] + rx)},${f(c[1])}A${f(rx)},${f(ry)} 0 1 0 ${f(c[0] - rx)},${f(c[1])}Z` };
};

// A matrix3d is only a true 3D effect under perspective (its own perspective() term or a perspective
// ancestor). Without one it is an orthographic projection — z is dropped, the (a,b,c,d,e,f) part is exact.
export const inPerspective = (ctx: CaptureCtx, el: Element, p: number[]): boolean => {
  if (Math.abs(p[3]) > 1e-6 || Math.abs(p[7]) > 1e-6 || Math.abs(p[11]) > 1e-6) return true;
  for (let a = el.parentElement; a; a = a.parentElement) {
    const pp = ctx.win.getComputedStyle(a).perspective;
    if (pp && pp !== 'none') return true;
  }
  return false;
};

export const needsSubtreeRaster = (ctx: CaptureCtx, el: Element, cs: CSSStyleDeclaration) => {
  const tag = el.tagName.toUpperCase();
  if (['CANVAS', 'VIDEO', 'IFRAME', 'OBJECT', 'EMBED'].includes(tag)) return 'media:' + tag;
  if (['INPUT', 'SELECT', 'TEXTAREA', 'PROGRESS', 'METER'].includes(tag) && !vectorTextInput(el, cs) && !nativeControl(el)) return 'form-control';
  if (cs.filter && cs.filter !== 'none' && !ctx.parseFilterList(cs.filter)) return 'filter';
  // backdrop-filter (frosted nav bars) can't be reproduced in SVG, but rastering the element would
  // freeze its whole subtree (all text) into pixels — keep it vector, with its own translucent fill.
  if (
    (cs as any).maskImage &&
    (cs as any).maskImage !== 'none' &&
    (cs as any).maskImage !== undefined &&
    !ctx.parseElementMask(el, cs)
  )
    return 'mask';
  if (cs.clipPath && cs.clipPath !== 'none' && !parseClipShape(el, cs)) return 'clip-path';
  const tf = cs.transform;
  if (tf && tf !== 'none') {
    // Detect 3D transforms (rotateX/Y, perspective…) via the matrix3d coefficients that
    // a pure-2D transform leaves at zero. These can't be flattened to SVG's 2D canvas.
    const m3match = tf.match(/matrix3d\(([^)]+)\)/);
    if (m3match) {
      const p = m3match[1].split(',').map((x) => parseFloat(x));
      // A pure 2D-equivalent matrix3d has p[2]=p[3]=p[6]=p[7]=p[8]=p[9]=p[14]=0
      const has3D =
        Math.abs(p[2]) > 1e-3 || Math.abs(p[6]) > 1e-3 ||
        Math.abs(p[8]) > 1e-3 || Math.abs(p[9]) > 1e-3 || Math.abs(p[14]) > 1e-3;
      if (has3D && inPerspective(ctx, el, p)) return 'transform-3d';
    }
    const m = parseMatrix(tf);
    if (m && (Math.abs(m.b) > 1e-3 || Math.abs(m.c) > 1e-3)) return 'transform-rotate';
  }
  // Custom elements (hyphenated tag) with no light-DOM children and no accessible
  // shadow root are likely using closed shadow DOM — raster to capture their rendering.
  if (el.tagName.includes('-') && el.childElementCount === 0 && !(el as HTMLElement).shadowRoot)
    return 'custom-element';
  return null;
};

export const loadImgInfo = async (ctx: CaptureCtx, url: string) => {
  if (ctx.imgInfo.has(url)) return;
  ctx.imgInfo.set(url, null);
  const fetched = await fetchDataURL(url);
  if (!fetched) return;
  const href = normDataUrl(fetched);
  const dim = await new Promise<{ w: number; h: number } | null>((res) => {
    const im = new ctx.win.Image();
    im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => res(null);
    im.src = href;
  });
  if (dim) ctx.imgInfo.set(url, { href, w: dim.w, h: dim.h });
};

export const prepareImageLayers = async (ctx: CaptureCtx, cs: CSSStyleDeclaration) => {
  const bgv = cs.backgroundImage;
  if (bgv && bgv !== 'none') for (const layer of splitTopLevel(bgv)) { const u = layerUrl(layer); if (u) await loadImgInfo(ctx, u); }
  const a = singleUrl(cs.backgroundImage);
  if (a) await loadImgInfo(ctx, a);
  const b = singleUrl((cs as any).maskImage);
  if (b) await loadImgInfo(ctx, b);
};

// Box-level effects we can't vectorize. Safe to raster only on a LEAF element
// (no element children), where rastering the box loses nothing. On containers
// we skip these (keep descending, vectorize the content) rather than nuke the
// subtree.
export const needsBoxRaster = (ctx: CaptureCtx, el: Element, cs: CSSStyleDeclaration) => {
  if (
    cs.backgroundImage &&
    cs.backgroundImage !== 'none' &&
    !ctx.parseBgLayers(cs, paddingBoxOf(el, cs)) &&
    !ctx.parseFirstLinearGradient(cs.backgroundImage) &&
    !ctx.bgImageLayer(el, cs) &&
    !ctx.parseBackgroundLayers(el, cs)
  )
    return 'background-image';
  // blur-free inset layers (table-row tints `inset 0 0 0 9999px`, rings) are vector; blurred ones raster
  if (cs.boxShadow && cs.boxShadow.includes('inset') && !ctx.parseInsetShadows(cs.boxShadow)) return 'inset-shadow';
  if (cs.borderTopStyle === 'double' || cs.borderTopStyle === 'groove' || cs.borderTopStyle === 'ridge')
    return 'border-style';
  if (pseudoVisible(ctx, el, '::before') || pseudoVisible(ctx, el, '::after')) return 'pseudo';
  return null;
};

// Clamp a DOMRect to the captured region (whole-px snap); null when nothing overlaps.
export const clampToCapture = (ctx: CaptureCtx, rect: DOMRect) => {
  const x = Math.max(ctx.cullLeft, Math.floor(rect.left));
  const y = Math.max(ctx.cullTop, Math.floor(rect.top));
  const width = Math.min(ctx.cullRight, Math.ceil(rect.right)) - x;
  const height = Math.min(ctx.cullBottom, Math.ceil(rect.bottom)) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
};

export const pushRaster = (ctx: CaptureCtx, rect: DOMRect, clip: Clip | null, opacity: number, reason: string, el?: Element) => {
  if (ctx.transformDepth > 0) throw new TransformBail();
  const r = clampToCapture(ctx, rect);
  if (!r) return;
  const id = ctx.nid();
  const desc = el ? el.tagName.toLowerCase() + (typeof (el as any).className === 'string' && (el as any).className ? '.' + (el as any).className.trim().split(/\s+/).slice(0, 2).join('.') : '') : undefined;
  const detail = el && reason === 'background-image' ? ' ' + ctx.win.getComputedStyle(el).backgroundImage.slice(0, 90) : el && reason === 'clip-path' ? ' ' + ctx.win.getComputedStyle(el).clipPath.slice(0, 60) : el && reason === 'mask' ? (() => { const c: any = ctx.win.getComputedStyle(el); return ' ' + String(c.maskImage || c.webkitMaskImage).slice(0, 80) + ' | ' + (c.maskSize || '') + ' | ' + (c.maskComposite || ''); })() : '';
  ctx.nodes.push({ kind: 'raster', id, rect: r, opacity, clip, reason, desc: desc && (desc.slice(0, 50) + detail) } as PaintNode);
  ctx.rasterTargets.push({ id, ...r });
  // in-page backends can re-render this element themselves when no screenshot is available
  if (el) ctx.opts.rasterElements?.set(id, el);
};

// SVG presentation properties to inline onto transplanted inline-svg nodes.
export const SVG_PAINT = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'opacity',
  'visibility',
  'paint-order',
  'stop-color',
  'stop-opacity',
  'text-anchor',
  'dominant-baseline',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
];

export const COLOR_PROPS = new Set(['fill', 'stroke', 'stop-color']);

export const inlineSvgStyles = (ctx: CaptureCtx, srcRoot: Element, cloneRoot: Element) => {
  const src = [srcRoot, ...Array.from(srcRoot.querySelectorAll('*'))];
  const dst = [cloneRoot, ...Array.from(cloneRoot.querySelectorAll('*'))];
  for (let i = 0; i < src.length && i < dst.length; i++) {
    const scs = ctx.win.getComputedStyle(src[i]);
    if (scs.display === 'none') {
      dst[i].setAttribute('display', 'none');
      continue;
    }
    for (const prop of SVG_PAINT) {
      const v = scs.getPropertyValue(prop);
      if (!v || v === 'normal') continue;
      dst[i].setAttribute(prop, COLOR_PROPS.has(prop) ? ctx.normColor(v) : v);
    }
  }
};

// Transplant an <svg> element: clone it, position/size it, resolve currentColor
// and inline computed presentation styles so it survives without the page's CSS.
export const captureSvgEl = (ctx: CaptureCtx, el: Element, cs: CSSStyleDeclaration, r: DOMRect, clip: Clip | null, opacity: number) => {
  const clone = el.cloneNode(true) as SVGElement;
  clone.setAttribute('x', String(r.left));
  clone.setAttribute('y', String(r.top));
  clone.setAttribute('width', String(r.width));
  clone.setAttribute('height', String(r.height));
  // resolve currentColor used by icon fonts/icons
  (clone as any).style.color = ctx.normColor(cs.color);
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // Inline computed presentation styles so CSS-class-styled SVG (e.g. MUI
  // x-charts line strokes / bar fills) survives transplanting without the
  // page's stylesheet. Walk original + clone in lockstep (same structure).
  inlineSvgStyles(ctx, el, clone);
  // walk() already includes the SVG root's opacity in the Scene wrapper.
  // Keep descendant opacity, but avoid applying the root opacity twice.
  clone.style.opacity = '1';
  // r (getBoundingClientRect) already includes the element's own CSS transform; keeping
  // it on the clone would apply it twice (Leaflet overlay panes, translate3d-positioned icons).
  clone.style.transform = 'none';
  clone.style.translate = 'none';
  clone.style.scale = 'none';
  clone.style.rotate = 'none';
  ctx.nodes.push({
    kind: 'inline-svg',
    id: ctx.nid(),
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    opacity,
    clip,
    markup: clone.outerHTML,
  });
};

// Capture an <img>: emit an image node now and resolve its href asynchronously
// (canvas extraction → fetch → in-place raster fallback for tainted/failed loads).
export const captureImageEl = (ctx: CaptureCtx, el: Element, cs: CSSStyleDeclaration, r: DOMRect, clip: Clip | null, opacity: number) => {
  const img = el as HTMLImageElement;
  const objFit = cs.objectFit || 'fill';
  const preserveAspectRatio =
    objFit === 'contain' || objFit === 'scale-down'
      ? 'xMidYMid meet'
      : objFit === 'cover'
        ? 'xMidYMid slice'
        : 'none';
  const id = ctx.nid();
  // The bitmap paints in the content box (inside border + padding) and is rounded by
  // border-radius (avatars: .rounded-circle, thumbnails) — shrink radii by the border.
  const bl = num(cs.borderLeftWidth), br = num(cs.borderRightWidth), bt = num(cs.borderTopWidth), bb = num(cs.borderBottomWidth);
  const cl = bl + num(cs.paddingLeft), cr = br + num(cs.paddingRight), ct = bt + num(cs.paddingTop), cb = bb + num(cs.paddingBottom);
  const rad = radiiOf(cs, r.width, r.height);
  let imgClip = clip;
  if (rad.some((v) => v > 0)) {
    const px = r.left + bl, py = r.top + bt, pw = r.width - bl - br, ph = r.height - bt - bb;
    // CSS scales radii down when they exceed half the box (a 50%/9999px circle)
    const f = Math.min(1, pw / Math.max(1e-6, Math.max(rad[0] + rad[1], rad[3] + rad[2])), ph / Math.max(1e-6, Math.max(rad[0] + rad[3], rad[1] + rad[2])));
    const rr = rad.map((v) => Math.max(0, v * f - Math.max(bl, br, bt, bb))) as CornerRadii;
    imgClip = intersect(clip, { x: px, y: py, width: pw, height: ph, radii: rr });
  }
  const node: any = {
    kind: 'image',
    id,
    rect: { x: r.left + cl, y: r.top + ct, width: Math.max(0, r.width - cl - cr), height: Math.max(0, r.height - ct - cb) },
    opacity,
    clip: imgClip,
    href: null,
    preserveAspectRatio,
  };
  ctx.nodes.push(node);
  ctx.imgTasks.push(
    (async () => {
      const src = img.currentSrc || img.src;
      // 1) Try canvas extraction (instant, no network, works for decoded images)
      const canvas = ctx.canvasExtractDataURL(img);
      if (canvas) { node.href = canvas; return; }
      // 2) Fall back to fetch
      const fetched = await fetchDataURL(src);
      if (fetched) { node.href = fetched; return; }
      // 3) CORS / network failure: convert this node in-place to a raster target
      //    so it keeps its paint-order position rather than appending at the end.
      const clamped = clampToCapture(ctx, r);
      if (clamped) {
        const imgFallback = { src, rect: { ...node.rect }, preserveAspectRatio };
        Object.assign(node, { kind: 'raster', rect: clamped, reason: 'img-cors', imgFallback });
        ctx.rasterTargets.push({ id, ...clamped });
      } else {
        // image is entirely outside the capture bounds — remove the placeholder
        const idx = ctx.nodes.indexOf(node);
        if (idx >= 0) ctx.nodes.splice(idx, 1);
      }
    })(),
  );
};
