import type { Scene, PaintNode, Clip, CornerRadii, CaptureOptions, BgLayer } from '../ir/types.js';
import { bindEnv, type BgEnv, type GBox, radiiOf, radiiYOf, intersect, clipsContent, paddingBoxOf, singleUrl, layerUrl, placeImageLayer, tileOf, bgImageLayer as bgBgImageLayer, parseBackgroundLayers as bgParseBackgroundLayers, parseBgLayers as bgParseBgLayers, parseElementMask as bgParseElementMask, parseGradientLayer as bgParseGradientLayer, parseMaskLayers as bgParseMaskLayers } from './background.js';
import { unfurlScrollContainers, resetScrollAndContentVisibility } from './unfurl.js';
import { createColorNormalizer } from './colorNorm.js';
import { blobToDataURL, fetchDataURL, normDataUrl, canvasDataUrl as domCanvasDataUrl, canvasExtractDataURL as domCanvasExtractDataURL } from './images.js';
import { collectFonts } from './fonts.js';
import { num, splitTopLevel, splitTopLevelWs, lenToPx } from '../../css/util.js';
import { transparent, rgbaOf } from '../../css/color.js';
import { parseMatrix } from '../../css/transform.js';
import {
  sideToAngle,
  parseLinearGradient as cssParseLinearGradient,
  parseFirstLinearGradient as cssParseFirstLinearGradient,
  parseGradientStops as cssParseGradientStops,
} from '../../css/gradient.js';
import { parseShadows as cssParseShadows, parseInsetShadows as cssParseInsetShadows } from '../../css/shadow.js';
import { parseFilterList as cssParseFilterList, filterOverflow, pureBlur } from '../../css/filter.js';
import { rrPath } from '../../css/clip.js';

/**
 * Captures the current page into a Scene IR. Runs INSIDE the page context (bundled into
 * the IIFE the Node backend injects, see src/inject/entry.ts), so it must not use Node
 * APIs. The same function is reused by the extension and in-page-library backends, where
 * it is simply called directly.
 */
export async function captureScene(opts: CaptureOptions, root?: Element): Promise<Scene> {
  const dpr = opts.deviceScaleFactor || 1;
  // The element's own document and window, not the globals of the page this code was loaded into:
  // the editor that embeds fith captures a same-origin <iframe>, and `instanceof HTMLElement` is false across realms.
  const doc = root?.ownerDocument ?? document;
  const win = (doc.defaultView ?? window) as Window & typeof globalThis;
  const rootEl = root ?? doc.documentElement;
  const subtree = rootEl !== doc.documentElement;

  const restoreUnfurl =
    subtree && (opts as any).captureScrollableContent && (opts as any).unfurlScrollContainers !== false
      ? unfurlScrollContainers(win, rootEl)
      : () => {};
  let restoreScroll = () => {};
  try {
  const rootRect = rootEl.getBoundingClientRect();
  const W = subtree ? rootRect.width : opts.width;
  const H = subtree
    ? rootRect.height
    : opts.height ||
      Math.max(
        doc.documentElement.scrollHeight,
        doc.body ? doc.body.scrollHeight : 0,
      );
  const originX = subtree ? rootRect.left : 0;
  const originY = subtree ? rootRect.top : 0;

  // In subtree mode, collect all DOM ancestors of rootEl. walk() skips rendering
  // for these elements (to suppress container backgrounds) but still descends into
  // their children, so siblings and cousins that visually overlap the capture area
  // are captured with correct paint order. We walk from document.documentElement
  // instead of rootEl so those out-of-subtree elements are naturally visited.
  const rootAncestors = new Set<Element>();
  if (subtree) {
    let a: Element | null = rootEl.parentElement;
    while (a) { rootAncestors.add(a); a = a.parentElement; }
  }

  const nodes: PaintNode[] = [];
  const rasterTargets: { id: string; x: number; y: number; width: number; height: number }[] = [];
  const collectGlyphX = !!opts.collectGlyphX;
  let counter = 0;
  const nid = () => 'n' + counter++;

  const metricsCanvas = doc.createElement('canvas');
  const mctx = metricsCanvas.getContext('2d')!;

  const normColor = createColorNormalizer(doc);

  // CSS parsers live in src/css (pure, unit-tested); these bind the page's colour normaliser.
  const parseLinearGradient = (value: string) => cssParseLinearGradient(value, normColor);
  const parseFirstLinearGradient = (value: string) => cssParseFirstLinearGradient(value, normColor);
  const parseGradientStops = (parts: string[], lineLen: number, repeating = false) => cssParseGradientStops(parts, lineLen, normColor, repeating);
  const parseShadows = (value: string) => cssParseShadows(value, normColor);
  const parseInsetShadows = (value: string) => cssParseInsetShadows(value, normColor);
  const parseFilterList = (v: string | undefined) => cssParseFilterList(v, normColor);











  // cull against the captured region: the document box for full-page, the root
  // element's box for a subtree (coords are absolute viewport px in both cases)
  const cullRight = subtree ? originX + W : W;
  const cullBottom = subtree ? originY + H : H;
  const cullLeft = subtree ? originX : 0;
  const cullTop = subtree ? originY : 0;
  const isVisible = (el: Element, cs: CSSStyleDeclaration) => {
    // display:none removes element from layout entirely — no descent possible
    if (cs.display === 'none') return false;
    // opacity:0 composites to invisible and cannot be overridden by children
    if (num(cs.opacity) === 0) return false;
    // Ancestors of a picked element only provide context (their own rendering is
    // skipped), and their boxes say nothing about where the root is: <body> is
    // routinely 0px tall when the app shell is position:fixed/absolute, and a wrapper
    // can sit entirely outside the captured region. Culling them by geometry would
    // drop the whole subtree and export an empty SVG.
    if (rootAncestors.has(el)) return true;
    // visually-hidden pattern: `clip: rect(...)` with no visible area (sr-only / aria-live regions)
    const clipRect = cs.getPropertyValue('clip').match(/^rect\(\s*(-?[\d.]+)(?:px)?[,\s]+(-?[\d.]+)(?:px)?[,\s]+(-?[\d.]+)(?:px)?[,\s]+(-?[\d.]+)(?:px)?\s*\)$/);
    if (clipRect && (cs.position === 'absolute' || cs.position === 'fixed') &&
        (parseFloat(clipRect[2]) - parseFloat(clipRect[4]) <= 0 || parseFloat(clipRect[3]) - parseFloat(clipRect[1]) <= 0)) return false;
    const r = el.getBoundingClientRect();
    // A 0×0 box with visible overflow can still hold painted descendants (Leaflet panes,
    // absolutely-positioned overlay roots), so only cull it when it has nothing to descend into.
    if (r.width === 0 && r.height === 0) return el.childElementCount > 0 && !clipsContent(cs);
    // inside a transform-cleared subtree rects are in local (untransformed) space, not page space
    if (transformDepth === 0 && (r.bottom < cullTop || r.right < cullLeft || r.top > cullBottom || r.left > cullRight))
      return false;
    return true;
    // NOTE: visibility:hidden is intentionally NOT checked here. Children can
    // override it with visibility:visible, so descent must continue. The walk()
    // function skips emitBox/captureText for the hidden element itself.
  };

  const pseudoVisible = (el: Element, sel: string) => {
    const cs = win.getComputedStyle(el, sel);
    if (cs.display === 'none' || cs.visibility !== 'visible' || num(cs.opacity) === 0) return false;
    const content = cs.content;
    if (content === 'none' || content === 'normal') return false;
    const hasText = content && content !== 'none' && content !== 'normal' && content !== '""' && content !== "''";
    const hasBg = !transparent(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== 'none');
    const hasBorder =
      num(cs.borderTopWidth) + num(cs.borderRightWidth) + num(cs.borderBottomWidth) + num(cs.borderLeftWidth) > 0;
    return Boolean(hasText || hasBg || hasBorder);
  };

  // Reasons that require rendering the WHOLE element as one image (children
  // included). Returning one of these stops descent — so it must only be used
  // for genuinely subtree-wide effects, never for box-level ones, otherwise a
  // <body>/wrapper carrying the property would collapse the entire page to a
  // single raster (and a blank SVG if that raster can't be produced).
  // Single-line text inputs with author-styled chrome (appearance:none, or a solid border) are
  // just a box + one line of text, so they vectorize. Native-looking ones (inset border) stay raster.
  const TEXT_INPUT = /^(text|email|password|search|url|tel|number|)$/;
  const vectorTextInput = (el: Element, cs: CSSStyleDeclaration): boolean => {
    if (el.tagName !== 'INPUT') return false;
    const inp = el as HTMLInputElement;
    if (!TEXT_INPUT.test(inp.getAttribute('type') || '') && !TEXT_INPUT.test(inp.type)) return false;
    if (inp.list || inp.type === 'number') return false; // datalist arrow / spin buttons
    if (['inset', 'outset', 'groove', 'ridge'].includes(cs.borderTopStyle)) return false;
    if (cs.direction === 'rtl') return false;
    return true;
  };

  // Native controls drawn as vector primitives: 'check' (checkbox/radio), 'select' (single), 'textarea'.
  const nativeControl = (el: Element): 'check' | 'select' | 'textarea' | null => {
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'SELECT') { const s = el as HTMLSelectElement; return !s.multiple && !(s.size > 1) ? 'select' : null; }
    if (tag === 'INPUT') { const t = (el as HTMLInputElement).type; return t === 'checkbox' || t === 'radio' ? 'check' : null; }
    return null;
  };

  const groupedEls = new WeakSet<Element>();


  const parseClipShape = (el: Element, cs: CSSStyleDeclaration): { d: string; evenodd?: boolean } | null => {
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
  const inPerspective = (el: Element, p: number[]): boolean => {
    if (Math.abs(p[3]) > 1e-6 || Math.abs(p[7]) > 1e-6 || Math.abs(p[11]) > 1e-6) return true;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const pp = win.getComputedStyle(a).perspective;
      if (pp && pp !== 'none') return true;
    }
    return false;
  };

  const needsSubtreeRaster = (el: Element, cs: CSSStyleDeclaration) => {
    const tag = el.tagName.toUpperCase();
    if (['CANVAS', 'VIDEO', 'IFRAME', 'OBJECT', 'EMBED'].includes(tag)) return 'media:' + tag;
    if (['INPUT', 'SELECT', 'TEXTAREA', 'PROGRESS', 'METER'].includes(tag) && !vectorTextInput(el, cs) && !nativeControl(el)) return 'form-control';
    if (cs.filter && cs.filter !== 'none' && !parseFilterList(cs.filter)) return 'filter';
    // backdrop-filter (frosted nav bars) can't be reproduced in SVG, but rastering the element would
    // freeze its whole subtree (all text) into pixels — keep it vector, with its own translucent fill.
    if (
      (cs as any).maskImage &&
      (cs as any).maskImage !== 'none' &&
      (cs as any).maskImage !== undefined &&
      !parseElementMask(el, cs)
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
        if (has3D && inPerspective(el, p)) return 'transform-3d';
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






  // CSS mask-image: linear-gradient(...) is the ubiquitous "fade out the end of a
  // truncated label" pattern. Computed values keep px/calc() stop positions, which
  // parseLinearGradient rejects, so resolve them here against the gradient line
  // length. Only the alpha channel of a mask matters, so stops become white+alpha
  // and the emitter renders it as an SVG <mask>. Returns null for anything we can't
  // reproduce exactly (multiple layers, custom size/position/repeat, url() masks…),
  // which keeps the old raster fallback.
  // ---- raster-image layers (mask-image:url(), background-image:url()) ----------
  // Images are fetched once, normalised to a base64 data URI (raw `data:` URIs
  // may hold quotes/`<` that would break the SVG attribute) and measured, so the
  // layer can be placed exactly (size/position) and embedded as an <image>.
  const imgInfo = new Map<string, { href: string; w: number; h: number } | null>();
  const bgEnv: BgEnv = { doc, win, normColor, imgInfo };
  const bgImageLayer = bindEnv(bgEnv, bgBgImageLayer);
  const parseBackgroundLayers = bindEnv(bgEnv, bgParseBackgroundLayers);
  const parseBgLayers = bindEnv(bgEnv, bgParseBgLayers);
  const parseElementMask = bindEnv(bgEnv, bgParseElementMask);
  const parseGradientLayer = bindEnv(bgEnv, bgParseGradientLayer);
  const parseMaskLayers = bindEnv(bgEnv, bgParseMaskLayers);
  const loadImgInfo = async (url: string) => {
    if (imgInfo.has(url)) return;
    imgInfo.set(url, null);
    const fetched = await fetchDataURL(url);
    if (!fetched) return;
    const href = normDataUrl(fetched);
    const dim = await new Promise<{ w: number; h: number } | null>((res) => {
      const im = new win.Image();
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => res(null);
      im.src = href;
    });
    if (dim) imgInfo.set(url, { href, w: dim.w, h: dim.h });
  };
  const prepareImageLayers = async (cs: CSSStyleDeclaration) => {
    const bgv = cs.backgroundImage;
    if (bgv && bgv !== 'none') for (const layer of splitTopLevel(bgv)) { const u = layerUrl(layer); if (u) await loadImgInfo(u); }
    const a = singleUrl(cs.backgroundImage);
    if (a) await loadImgInfo(a);
    const b = singleUrl((cs as any).maskImage);
    if (b) await loadImgInfo(b);
  };






  // Box-level effects we can't vectorize. Safe to raster only on a LEAF element
  // (no element children), where rastering the box loses nothing. On containers
  // we skip these (keep descending, vectorize the content) rather than nuke the
  // subtree.
  const needsBoxRaster = (el: Element, cs: CSSStyleDeclaration) => {
    if (
      cs.backgroundImage &&
      cs.backgroundImage !== 'none' &&
      !parseBgLayers(cs, paddingBoxOf(el, cs)) &&
      !parseFirstLinearGradient(cs.backgroundImage) &&
      !bgImageLayer(el, cs) &&
      !parseBackgroundLayers(el, cs)
    )
      return 'background-image';
    // blur-free inset layers (table-row tints `inset 0 0 0 9999px`, rings) are vector; blurred ones raster
    if (cs.boxShadow && cs.boxShadow.includes('inset') && !parseInsetShadows(cs.boxShadow)) return 'inset-shadow';
    if (cs.borderTopStyle === 'double' || cs.borderTopStyle === 'groove' || cs.borderTopStyle === 'ridge')
      return 'border-style';
    if (pseudoVisible(el, '::before') || pseudoVisible(el, '::after')) return 'pseudo';
    return null;
  };


  const canvasDataUrl = (cv: HTMLCanvasElement) => domCanvasDataUrl(doc, cv);
  const canvasExtractDataURL = (img: HTMLImageElement) => domCanvasExtractDataURL(doc, img);

  // Clamp a DOMRect to the captured region (whole-px snap); null when nothing overlaps.
  const clampToCapture = (rect: DOMRect) => {
    const x = Math.max(cullLeft, Math.floor(rect.left));
    const y = Math.max(cullTop, Math.floor(rect.top));
    const width = Math.min(cullRight, Math.ceil(rect.right)) - x;
    const height = Math.min(cullBottom, Math.ceil(rect.bottom)) - y;
    return width > 0 && height > 0 ? { x, y, width, height } : null;
  };

  const pushRaster = (rect: DOMRect, clip: Clip | null, opacity: number, reason: string, el?: Element) => {
    if (transformDepth > 0) throw new TransformBail();
    const r = clampToCapture(rect);
    if (!r) return;
    const id = nid();
    const desc = el ? el.tagName.toLowerCase() + (typeof (el as any).className === 'string' && (el as any).className ? '.' + (el as any).className.trim().split(/\s+/).slice(0, 2).join('.') : '') : undefined;
    const detail = el && reason === 'background-image' ? ' ' + win.getComputedStyle(el).backgroundImage.slice(0, 90) : el && reason === 'clip-path' ? ' ' + win.getComputedStyle(el).clipPath.slice(0, 60) : el && reason === 'mask' ? (() => { const c: any = win.getComputedStyle(el); return ' ' + String(c.maskImage || c.webkitMaskImage).slice(0, 80) + ' | ' + (c.maskSize || '') + ' | ' + (c.maskComposite || ''); })() : '';
    nodes.push({ kind: 'raster', id, rect: r, opacity, clip, reason, desc: desc && (desc.slice(0, 50) + detail) } as PaintNode);
    rasterTargets.push({ id, ...r });
    // in-page backends can re-render this element themselves when no screenshot is available
    if (el) opts.rasterElements?.set(id, el);
  };



  // Synthesize a text node for the CSS ::marker pseudo-element on list items.
  // Markers are pseudo-elements not in the DOM — getComputedStyle(el,'::marker')
  // exposes their computed content and color in Chrome 86+/FF 68+/Safari 13.1+.
  const captureListMarker = (el: Element, cs: CSSStyleDeclaration, clip: Clip | null, opacity: number) => {
    if (cs.display !== 'list-item') return;
    const ms = win.getComputedStyle(el, '::marker');
    let markerText = ms.content || '';
    if (!markerText || markerText === 'none' || markerText === 'normal') {
      // Fallback: infer from list-style-type
      const lstyle = cs.listStyleType || win.getComputedStyle(el.parentElement || el).listStyleType || '';
      if (!lstyle || lstyle === 'none') return;
      if (lstyle === 'disc') markerText = '•';
      else if (lstyle === 'circle') markerText = '○';
      else if (lstyle === 'square') markerText = '▪';
      else if (lstyle === 'decimal') {
        let n = 1;
        let sib = el.previousElementSibling;
        while (sib) { if (sib.tagName === el.tagName) n++; sib = sib.previousElementSibling; }
        markerText = n + '.';
      } else return;
    } else {
      // Computed content is a CSS quoted string like '"• "' — strip outer quotes
      markerText = markerText.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
    markerText = markerText.trim();
    if (!markerText) return;

    const r = el.getBoundingClientRect();
    const markerFontSize = num(ms.fontSize) || num(cs.fontSize);
    mctx.font = `${ms.fontStyle || cs.fontStyle} ${ms.fontWeight || cs.fontWeight} ${markerFontSize}px ${ms.fontFamily || cs.fontFamily}`;
    const mfm = mctx.measureText('Mg');
    const masc = (mfm as any).fontBoundingBoxAscent || markerFontSize * 0.8;
    const mdsc = (mfm as any).fontBoundingBoxDescent || markerFontSize * 0.2;
    const markerW = mctx.measureText(markerText).width;

    // Approximate baseline from the first text node in this li (or its first child element)
    let baseline = r.top + (markerFontSize - (masc + mdsc)) / 2 + masc;
    const firstTN = (() => {
      for (const c of Array.from(el.childNodes))
        if (c.nodeType === Node.TEXT_NODE && (c.textContent || '').trim()) return c;
      const fc = el.firstElementChild;
      if (fc) for (const c of Array.from(fc.childNodes))
        if (c.nodeType === Node.TEXT_NODE && (c.textContent || '').trim()) return c;
      return null;
    })();
    if (firstTN) {
      const rng = doc.createRange();
      rng.setStart(firstTN, 0);
      rng.setEnd(firstTN, Math.min(1, (firstTN.textContent || '').length));
      const rs = rng.getClientRects();
      if (rs.length > 0) baseline = rs[0].top + (rs[0].height - (masc + mdsc)) / 2 + masc;
    }

    // list-style-position:outside (default) → marker sits just left of the content box
    const markerX = (cs.listStylePosition || 'outside') === 'inside'
      ? r.left + num(cs.paddingLeft)
      : r.left - markerW - 2;

    const markerColor = normColor(ms.color || cs.color);
    if (transparent(markerColor)) return;

    nodes.push({
      kind: 'text',
      id: nid(),
      rect: { x: markerX, y: r.top, width: markerW, height: markerFontSize },
      opacity,
      clip,
      lines: [{ text: markerText, x: markerX, baseline }],
      fontFamily: ms.fontFamily || cs.fontFamily,
      fontSize: markerFontSize,
      fontWeight: ms.fontWeight || cs.fontWeight,
      fontStyle: ms.fontStyle || cs.fontStyle,
      color: markerColor,
      letterSpacing: 0,
      wordSpacing: 0,
      decoration: null,
    });
  };

  // Bucket each character of a text node into visual lines, keyed by rounded top,
  // recording every character's left x. Shared by glyph-outline capture (needs the
  // exact per-glyph xs) and the multi-line fallback (needs the leftmost x). Returns
  // buckets sorted top→bottom; each bucket always has ≥1 char.
  const bucketCharsByLine = (child: ChildNode, raw: string) => {
    const buckets = new Map<number, { chars: string[]; xs: number[]; top: number; height: number }>();
    for (let i = 0; i < raw.length; i++) {
      const cr = doc.createRange();
      cr.setStart(child, i);
      cr.setEnd(child, i + 1);
      const rb = cr.getBoundingClientRect();
      if (rb.width === 0 && rb.height === 0) continue;
      const key = Math.round(rb.top);
      let b = buckets.get(key);
      if (!b) {
        b = { chars: [], xs: [], top: rb.top, height: rb.height };
        buckets.set(key, b);
      }
      b.chars.push(raw[i]);
      b.xs.push(rb.left);
    }
    return Array.from(buckets.values()).sort((a, c) => a.top - c.top);
  };

  // Effective uniform scale from ancestor CSS transforms (slide decks, zoomed previews):
  // rects are post-transform but computed lengths (font-size, spacing) are not.
  const elScale = (el: Element): number => {
    const h = el as HTMLElement;
    const ow = h.offsetWidth, oh = h.offsetHeight;
    if (!ow || !oh || !(el instanceof win.HTMLElement)) return 1;
    const r = el.getBoundingClientRect();
    const sx = r.width / ow, sy = r.height / oh;
    // only trust a uniform, non-degenerate scale (rotations/skews are rastered elsewhere)
    if (Math.abs(sx - sy) > 0.01 || Math.abs(sx - 1) < 0.002 || sx <= 0.05 || sx > 20) return 1;
    return sx;
  };

  // value / placeholder of a vectorizable <input>: no text node exists, so synthesize one line
  const captureInputText = (el: HTMLInputElement, cs: CSSStyleDeclaration, clip: Clip | null, opacity: number) => {
    const sc = elScale(el);
    const isPh = !el.value;
    const raw = isPh ? el.placeholder || '' : el.type === 'password' ? '\u2022'.repeat(el.value.length) : el.value;
    if (!raw) return;
    const ps = isPh ? win.getComputedStyle(el, '::placeholder') : cs;
    const fontSize = num(cs.fontSize) * sc;
    if (fontSize <= 0) return;
    const r = el.getBoundingClientRect();
    const bl = num(cs.borderLeftWidth) * sc, br = num(cs.borderRightWidth) * sc, bt = num(cs.borderTopWidth) * sc, bb = num(cs.borderBottomWidth) * sc;
    const cx = r.left + bl + num(cs.paddingLeft) * sc, cy0 = r.top + bt + num(cs.paddingTop) * sc;
    const cw = r.width - bl - br - (num(cs.paddingLeft) + num(cs.paddingRight)) * sc;
    const ch = r.height - bt - bb - (num(cs.paddingTop) + num(cs.paddingBottom)) * sc;
    if (cw <= 0 || ch <= 0) return;
    mctx.font = `${cs.fontStyle} ${cs.fontWeight} ${fontSize}px ${cs.fontFamily}`;
    const fm = mctx.measureText('Mg');
    const ascent = (fm as any).fontBoundingBoxAscent || fontSize * 0.8;
    const descent = (fm as any).fontBoundingBoxDescent || fontSize * 0.2;
    const ls = cs.letterSpacing === 'normal' ? 0 : num(cs.letterSpacing) * sc;
    let shown = raw;
    let textW = mctx.measureText(raw).width + ls * raw.length;
    if (textW > cw && cs.textOverflow === 'ellipsis') {
      // same truncation as the browser: longest prefix that fits next to the ellipsis
      const ell = '\u2026', ellW = mctx.measureText(ell).width;
      let lo = 0, hi = raw.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (mctx.measureText(raw.slice(0, mid)).width + ls * mid + ellW <= cw) lo = mid; else hi = mid - 1;
      }
      shown = raw.slice(0, lo) + ell;
      textW = mctx.measureText(shown).width + ls * shown.length;
    }
    const align = cs.textAlign;
    const x = align === 'center' ? cx + (cw - textW) / 2 : align === 'right' || align === 'end' ? cx + cw - textW : cx;
    const baseline = cy0 + (ch - (ascent + descent)) / 2 + ascent;
    const color = normColor(isPh ? ps.color : cs.color);
    if (transparent(color)) return;
    nodes.push({
      kind: 'text',
      id: nid(),
      rect: { x, y: baseline - ascent, width: textW, height: ascent + descent },
      opacity: opacity * (isPh ? num(ps.opacity || '1') : 1),
      clip: intersect(clip, { x: cx, y: cy0, width: cw, height: ch, radii: [0, 0, 0, 0] }),
      lines: [{ text: shown, x, baseline }],
      fontFamily: cs.fontFamily,
      fontSize,
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
      color,
      letterSpacing: ls,
      wordSpacing: 0,
      preserveSpace: true,
    } as PaintNode);
  };

  // font properties that alter glyph choice/metrics but aren't part of the SVG presentation attrs
  const fontExtraOf = (cs: CSSStyleDeclaration): string => {
    const d: string[] = [];
    const add = (prop: string, v: string | undefined, dflt: string) => { if (v && v !== dflt) d.push(`${prop}:${v}`); };
    add('font-feature-settings', cs.fontFeatureSettings, 'normal');
    add('font-variation-settings', cs.fontVariationSettings, 'normal');
    add('font-stretch', cs.fontStretch, '100%');
    add('font-kerning', cs.fontKerning, 'auto');
    add('font-optical-sizing', (cs as any).fontOpticalSizing, 'auto');
    add('font-variant-ligatures', cs.fontVariantLigatures, 'normal');
    add('font-variant-numeric', cs.fontVariantNumeric, 'normal');
    add('text-rendering', cs.textRendering, 'auto');
    return d.join(';');
  };

  // checkbox / radio / select / textarea: the box comes from emitBox (computed bg/border); here we add what
  // Chrome paints natively — check glyphs, the select's selected text + chevron, textarea wrapped lines.
  const captureNative = (kind: 'check' | 'select' | 'textarea', el: Element, cs: CSSStyleDeclaration, clip: Clip | null, opacity: number) => {
    const r = el.getBoundingClientRect();
    const auto = cs.appearance !== 'none';
    const svg = (rect: { x: number; y: number; width: number; height: number }, inner: string) => nodes.push({
      kind: 'inline-svg', id: nid(), rect, opacity, clip,
      markup: `<svg xmlns="http://www.w3.org/2000/svg" x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" viewBox="0 0 ${rect.width} ${rect.height}" overflow="visible">${inner}</svg>`,
    } as PaintNode);
    if (kind === 'check') {
      if (!auto) return; // author-drawn: emitBox already painted the checked/unchecked styles
      const inp = el as HTMLInputElement;
      const w = r.width, h = r.height, dis = inp.disabled;
      const ac = (cs as any).accentColor;
      const accent = dis ? 'rgba(16,16,16,0.3)' : ac && ac !== 'auto' ? normColor(ac) : 'rgb(0, 117, 255)';
      const on = inp.checked || (inp.type === 'checkbox' && inp.indeterminate);
      const stroke = dis ? 'rgba(118,118,118,0.3)' : 'rgb(118,118,118)';
      const fill = dis ? 'rgba(239,239,239,0.3)' : '#fff';
      const round = inp.type === 'radio';
      const sh = (f: string, s: string, sw: number) => round
        ? `<circle cx="${w / 2}" cy="${h / 2}" r="${(Math.min(w, h) - sw) / 2}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`
        : `<rect x="${sw / 2}" y="${sw / 2}" width="${w - sw}" height="${h - sw}" rx="2" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
      let inner: string;
      if (!on) inner = sh(fill, stroke, 1);
      else if (round) inner = sh(dis ? 'rgba(239,239,239,0.3)' : '#fff', accent, 1) + `<circle cx="${w / 2}" cy="${h / 2}" r="${w * 0.27}" fill="${accent}"/>`;
      else inner = `<rect width="${w}" height="${h}" rx="2" fill="${accent}"/>` + (inp.indeterminate && !inp.checked
        ? `<rect x="${w * 0.22}" y="${h / 2 - 1}" width="${w * 0.56}" height="2" fill="#fff"/>`
        : `<path d="M${w * 0.2} ${h * 0.5} L${w * 0.42} ${h * 0.72} L${w * 0.8} ${h * 0.28}" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`);
      svg({ x: r.left, y: r.top, width: w, height: h }, inner);
      return;
    }
    const sc = elScale(el);
    const bl = num(cs.borderLeftWidth) * sc, br = num(cs.borderRightWidth) * sc, bt = num(cs.borderTopWidth) * sc, bb = num(cs.borderBottomWidth) * sc;
    const padL = num(cs.paddingLeft) * sc, padR = num(cs.paddingRight) * sc, padT = num(cs.paddingTop) * sc, padB = num(cs.paddingBottom) * sc;
    if (kind === 'select') {
      const sel = el as HTMLSelectElement;
      const raw = sel.selectedOptions[0]?.text || '';
      const fontSize = num(cs.fontSize) * sc;
      const color = normColor(cs.color);
      if (auto) { // Chrome's menulist: chevron at the right edge
        const cx = r.right - br - 10 * sc, cy = r.top + r.height / 2;
        svg({ x: cx - 6 * sc, y: cy - 6 * sc, width: 12 * sc, height: 12 * sc },
          `<path d="M${6 - 3.2 * sc} ${6 - 1.6 * sc} L6 ${6 + 1.6 * sc} L${6 + 3.2 * sc} ${6 - 1.6 * sc}" fill="none" stroke="${color}" stroke-width="${1.5 * sc}" stroke-linecap="round" stroke-linejoin="round"/>`);
      }
      if (!raw || fontSize <= 0 || transparent(color)) return;
      const left = r.left + bl + (auto ? Math.max(padL, 4 * sc) : padL);
      const cw = r.right - br - (auto ? Math.max(padR, 14 * sc) : padR) - left;
      const cy0 = r.top + bt + padT, ch = r.height - bt - bb - padT - padB;
      if (cw <= 0 || ch <= 0) return;
      mctx.font = `${cs.fontStyle} ${cs.fontWeight} ${fontSize}px ${cs.fontFamily}`;
      const fm = mctx.measureText('Mg');
      const ascent = (fm as any).fontBoundingBoxAscent || fontSize * 0.8;
      const descent = (fm as any).fontBoundingBoxDescent || fontSize * 0.2;
      const text = cs.textTransform === 'uppercase' ? raw.toUpperCase() : cs.textTransform === 'lowercase' ? raw.toLowerCase() : raw;
      const textW = mctx.measureText(text).width;
      const baseline = cy0 + (ch - (ascent + descent)) / 2 + ascent;
      nodes.push({
        kind: 'text', id: nid(), rect: { x: left, y: baseline - ascent, width: textW, height: ascent + descent },
        opacity, clip: intersect(clip, { x: left, y: cy0, width: cw, height: ch, radii: [0, 0, 0, 0] }),
        lines: [{ text, x: left, baseline }], fontFamily: cs.fontFamily, fontSize, fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle, color, letterSpacing: cs.letterSpacing === 'normal' ? 0 : num(cs.letterSpacing) * sc,
        wordSpacing: 0, preserveSpace: true,
      } as PaintNode);
      return;
    }
    // textarea: resize grip (two short diagonals in the bottom-right corner), then the text
    if (auto && cs.resize !== 'none' && r.width > 20 && r.height > 20) {
      const gx = r.right - bl - 1, gy = r.bottom - bb - 1;
      svg({ x: gx - 10, y: gy - 10, width: 10, height: 10 },
        `<path d="M9 1 L1 9 M9 5 L5 9" fill="none" stroke="rgb(118,118,118)" stroke-width="1"/>`);
    }
    // textarea: lay the value out in a throw-away mirror <div> with the same computed style, then capture it
    const ta = el as HTMLTextAreaElement;
    const isPh = !ta.value;
    const content = isPh ? ta.placeholder : ta.value;
    if (!content) return;
    const cl = r.left + bl + padL, ct = r.top + bt + padT;
    const cw = ta.clientWidth * sc - padL - padR, ch = ta.clientHeight * sc - padT - padB;
    if (cw <= 0 || ch <= 0) return;
    const mir = doc.createElement('div');
    for (let i = 0; i < cs.length; i++) mir.style.setProperty(cs[i], cs.getPropertyValue(cs[i]));
    const ps = isPh ? win.getComputedStyle(el, '::placeholder') : cs;
    const mset = (k: string, v: string) => mir.style.setProperty(k, v, 'important');
    mset('position', 'fixed'); mset('left', cl / sc + 'px'); mset('top', (ct - ta.scrollTop * sc) / sc + 'px');
    mset('margin', '0'); mset('border', '0'); mset('padding', '0'); mset('box-sizing', 'content-box');
    mset('width', (cw / sc) + 'px'); mset('height', 'auto'); mset('min-height', '0'); mset('max-height', 'none');
    mset('overflow', 'visible'); mset('background', 'none'); mset('box-shadow', 'none'); mset('outline', 'none');
    mset('transform', 'none'); mset('translate', 'none'); mset('rotate', 'none'); mset('scale', 'none'); mset('resize', 'none');
    mset('display', 'block'); mset('animation', 'none'); mset('transition', 'none'); mset('appearance', 'none');
    mset('white-space', cs.whiteSpace === 'pre' ? 'pre' : 'pre-wrap'); mset('overflow-wrap', cs.whiteSpace === 'pre' ? 'normal' : 'break-word');
    mset('color', ps.color); mset('-webkit-text-fill-color', ps.color); mset('opacity', '1');
    mir.textContent = content;
    doc.documentElement.appendChild(mir);
    try {
      const mcs = win.getComputedStyle(mir);
      captureText(mir, mcs, intersect(clip, { x: cl, y: ct, width: cw, height: ch, radii: [0, 0, 0, 0] }), opacity * (isPh ? num(ps.opacity || '1') : 1));
    } finally { mir.remove(); }
  };

  const captureText = (el: Element, cs: CSSStyleDeclaration, clip: Clip | null, opacity: number) => {
    const nc = nativeControl(el);
    if (nc) { captureNative(nc, el, cs, clip, opacity); return; }
    if (el.tagName === 'INPUT' && vectorTextInput(el, cs)) {
      captureInputText(el as HTMLInputElement, cs, clip, opacity);
      return;
    }
    const sc = elScale(el);
    const fontSize = num(cs.fontSize) * sc;
    if (fontSize <= 0) return;
    mctx.font = `${cs.fontStyle} ${cs.fontWeight} ${fontSize}px ${cs.fontFamily}`;
    const fm = mctx.measureText('Mg');
    const ascent = (fm as any).fontBoundingBoxAscent || fontSize * 0.8;
    const descent = (fm as any).fontBoundingBoxDescent || fontSize * 0.2;
    const ls = cs.letterSpacing === 'normal' ? 0 : num(cs.letterSpacing) * sc;
    const ws = cs.wordSpacing === 'normal' ? 0 : num(cs.wordSpacing) * sc;
    const decoration =
      cs.textDecorationLine && cs.textDecorationLine !== 'none' ? cs.textDecorationLine : null;
    // glyphs are measured from the rendered (transformed) text, so the stored
    // string must be transformed too (MUI buttons/tabs use text-transform:uppercase)
    const tt = cs.textTransform;
    const xform = (s: string) =>
      tt === 'uppercase'
        ? s.toUpperCase()
        : tt === 'lowercase'
          ? s.toLowerCase()
          : tt === 'capitalize'
            ? s.replace(/(^|\s)(\S)/g, (_m, p, c) => p + c.toUpperCase())
            : s;

    // white-space: pre / pre-wrap / break-spaces keep runs of spaces (code blocks, <pre>)
    const preserveSpace = /^(pre|pre-wrap|break-spaces)$/.test(cs.whiteSpace);
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const raw = child.textContent || '';
      if (!raw.trim()) continue;
      const range = doc.createRange();
      range.selectNodeContents(child);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      if (rects.length === 0) continue;

      const lines: { text: string; x: number; baseline: number; glyphX?: number[] }[] = [];
      if (collectGlyphX) {
        // capture each glyph's exact x so outline mode matches the browser's
        // shaping (kerning/hinting) instead of accumulating advance-width drift
        for (const b of bucketCharsByLine(child, raw)) {
          const baseline = b.top + (b.height - (ascent + descent)) / 2 + ascent;
          lines.push({ text: xform(b.chars.join('')), x: b.xs[0], baseline, glyphX: b.xs });
        }
      } else if (rects.length === 1) {
        const r = rects[0];
        let text = xform(preserveSpace ? raw.replace(/[\r\n]+$/, '') : raw.replace(/\s+/g, ' ').trim());
        // The rect starts at the collapsed leading space (e.g. " {" after an inline
        // sibling); the trimmed text must start where its first glyph is drawn.
        let left = r.left;
        if (!preserveSpace) {
          const lead = raw.search(/\S/);
          if (lead > 0) {
            const cr = doc.createRange();
            cr.setStart(child, lead);
            cr.setEnd(child, lead + 1);
            const rb = cr.getBoundingClientRect();
            if (rb.width > 0) left = rb.left;
          }
        }
        // Reproduce CSS text-overflow:ellipsis — the DOM always contains the full text
        // but the browser visually truncates it with "..." when overflow is hidden.
        if (
          cs.textOverflow === 'ellipsis' &&
          (cs.overflow === 'hidden' || cs.overflowX === 'hidden') &&
          (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth
        ) {
          const maxW = (el as HTMLElement).clientWidth - num(cs.paddingLeft) - num(cs.paddingRight);
          const ellipsis = '...';
          const ellipsisW = mctx.measureText(ellipsis).width + ls * Math.max(0, ellipsis.length - 1);
          // Binary search for the longest prefix that fits alongside the ellipsis.
          let lo = 0;
          let hi = text.length;
          while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            const w = mctx.measureText(text.slice(0, mid)).width + ls * Math.max(0, mid - 1);
            if (w + ellipsisW <= maxW) lo = mid;
            else hi = mid - 1;
          }
          text = text.slice(0, lo) + ellipsis;
        }
        const baseline = r.top + (r.height - (ascent + descent)) / 2 + ascent;
        lines.push({ text, x: left, baseline });
      } else {
        // multi-line: bucket characters to lines via per-char ranges
        for (const b of bucketCharsByLine(child, raw)) {
          const joined = b.chars.join('');
          const text = xform(preserveSpace ? joined.replace(/[\r\n]+$/, '') : joined.replace(/\s+/g, ' ').trim());
          if (!text.trim()) continue;
          // leftmost x of the first kept glyph (skips collapsed leading whitespace)
          const first = preserveSpace ? 0 : joined.search(/\S/);
          const left = preserveSpace
            ? b.xs.reduce((m, v) => Math.min(m, v), Infinity)
            : b.xs[Math.max(0, first)];
          const baseline = b.top + (b.height - (ascent + descent)) / 2 + ascent;
          lines.push({ text, x: left, baseline });
        }
      }
      if (lines.length === 0) continue;

      // A transparent text fill reveals the background clipped to the glyphs.
      // Preserve both gradient headings and solid background colors.
      let textColor = normColor(cs.webkitTextFillColor || cs.color);
      let gradientFill = null;
      let gradientRect;
      // Background clipping includes descendant glyphs even when nested spans
      // inherit transparent text fill without inheriting the background itself.
      let backgroundEl: Element | null = null;
      let backgroundStyle = cs;
      if (transparent(textColor)) {
        for (let candidate: Element | null = el; candidate; candidate = candidate.parentElement) {
          const style = candidate === el ? cs : win.getComputedStyle(candidate);
          const clip = style.backgroundClip || (style as any).webkitBackgroundClip;
          if ((clip === 'text' || clip === '-webkit-text') &&
              (!transparent(style.backgroundColor) || style.backgroundImage !== 'none')) {
            backgroundEl = candidate;
            backgroundStyle = style;
            break;
          }
        }
      }
      if (backgroundEl) {
        const bg = backgroundStyle;
        const grad = bg.backgroundImage && bg.backgroundImage !== 'none'
          ? parseFirstLinearGradient(bg.backgroundImage)
          : null;
        if (grad) {
          gradientFill = grad;
          // CSS gradients are sized against the background positioning area,
          // not the first line's text bounds. Preserve that area across wraps.
          const r = backgroundEl.getBoundingClientRect();
          const origin = bg.backgroundOrigin;
          const borderBox = origin === 'border-box';
          const contentBox = origin === 'content-box';
          const left = (borderBox ? 0 : num(bg.borderLeftWidth)) + (contentBox ? num(bg.paddingLeft) : 0);
          const right = (borderBox ? 0 : num(bg.borderRightWidth)) + (contentBox ? num(bg.paddingRight) : 0);
          const top = (borderBox ? 0 : num(bg.borderTopWidth)) + (contentBox ? num(bg.paddingTop) : 0);
          const bottom = (borderBox ? 0 : num(bg.borderBottomWidth)) + (contentBox ? num(bg.paddingBottom) : 0);
          gradientRect = {
            x: r.left + left, y: r.top + top,
            width: Math.max(0, r.width - left - right),
            height: Math.max(0, r.height - top - bottom),
          };
          // Solid fallback: midpoint stop color for renderers that ignore gradientFill.
          textColor = grad.stops[Math.floor(grad.stops.length / 2)].color;
        } else if (!bg.backgroundImage || bg.backgroundImage === 'none') {
          textColor = normColor(bg.backgroundColor);
        }
      }

      nodes.push({
        kind: 'text',
        id: nid(),
        rect: { x: rects[0].left, y: rects[0].top, width: rects[0].width, height: rects[0].height },
        opacity,
        clip,
        lines,
        fontFamily: cs.fontFamily,
        fontSize,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        color: textColor,
        letterSpacing: ls,
        wordSpacing: ws,
        decoration,
        preserveSpace: preserveSpace || undefined,
        fontExtra: fontExtraOf(cs) || undefined,
        decorationColor: normColor(cs.textDecorationColor || cs.color),
        gradientFill,
        gradientRect,
      });
    }
  };

  // Build a BorderEdges object from any computed style (element or pseudo-element).
  // Shared by emitBox and tryPseudoBox, which need the same four-edge shape.
  const buildBorder = (s: CSSStyleDeclaration) => {
    const bw = {
      top: num(s.borderTopWidth),
      right: num(s.borderRightWidth),
      bottom: num(s.borderBottomWidth),
      left: num(s.borderLeftWidth),
    };
    const hasBorder = bw.top + bw.right + bw.bottom + bw.left > 0;
    const border = hasBorder
      ? {
          top: { width: bw.top, color: normColor(s.borderTopColor), style: s.borderTopStyle },
          right: { width: bw.right, color: normColor(s.borderRightColor), style: s.borderRightStyle },
          bottom: { width: bw.bottom, color: normColor(s.borderBottomColor), style: s.borderBottomStyle },
          left: { width: bw.left, color: normColor(s.borderLeftColor), style: s.borderLeftStyle },
        }
      : null;
    return { hasBorder, border };
  };

  const emitBox = (el: Element, cs: CSSStyleDeclaration, clip: Clip | null, opacity: number) => {
    const r = el.getBoundingClientRect();
    const textClipped = cs.backgroundClip === 'text' || cs.backgroundClip === '-webkit-text';
    // <body>'s background propagates to the canvas when <html> has none: it paints beneath everything
    // (incl. negative z-index layers) and is already the scene background.
    const canvasBg = !subtree && el === doc.body && transparent(win.getComputedStyle(doc.documentElement).backgroundColor);
    const fill = textClipped || canvasBg || transparent(cs.backgroundColor) ? null : normColor(cs.backgroundColor);
    const { border } = buildBorder(cs);
    const shadows = parseShadows(cs.boxShadow);
    const bgLayers = !textClipped && cs.backgroundImage && cs.backgroundImage !== 'none' ? parseBgLayers(cs, paddingBoxOf(el, cs)) : null;
    const bgImg0 = textClipped ? null : bgImageLayer(el, cs);
    // general engine only when neither the gradient fast path nor the single-image path applies
    const general = !bgLayers && !bgImg0 && !textClipped && cs.backgroundImage && cs.backgroundImage !== 'none' ? parseBackgroundLayers(el, cs) : null;
    const gradient: any = bgLayers
      ? bgLayers.length === 1 ? bgLayers[0] : null
      : general ? null
      : !textClipped && cs.backgroundImage && cs.backgroundImage !== 'none' ? parseFirstLinearGradient(cs.backgroundImage) : null;
    const gradients = bgLayers && bgLayers.length > 1 ? bgLayers.slice().reverse() : undefined;
    const outlineW = num(cs.outlineWidth);
    const outlineStyle = cs.outlineStyle;
    const outline =
      outlineW > 0 && outlineStyle !== 'none' && !transparent(cs.outlineColor)
        ? { width: outlineW, color: normColor(cs.outlineColor), style: outlineStyle, offset: num(cs.outlineOffset) }
        : null;
    const bgImg = general ? null : bgImg0;
    if (!fill && !gradient && !gradients && !general && !border && shadows.length === 0 && !outline && !bgImg && !(cs.boxShadow || '').includes('inset')) return;
    const blur = el.childNodes.length === 0 && !groupedEls.has(el) ? pureBlur(cs.filter) : null;
    const insetShadows = parseInsetShadows(cs.boxShadow) || [];
    if (fill || gradient || gradients || general || border || shadows.length > 0 || outline || insetShadows.length > 0)
    nodes.push({
      kind: 'box',
      id: nid(),
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
      nodes.push({
        kind: 'image',
        id: nid(),
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
  const tryPseudoBox = (
    el: Element,
    csEl: CSSStyleDeclaration,
    sel: '::before' | '::after',
    clip: Clip | null,
    opacity: number,
  ): { handled: boolean; node?: PaintNode } => {
    const ps = win.getComputedStyle(el, sel);
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
    const cbW = fixedPos ? doc.documentElement.clientWidth : r.width - num(csEl.borderLeftWidth) - num(csEl.borderRightWidth);
    const cbH = fixedPos ? win.innerHeight : r.height - num(csEl.borderTopWidth) - num(csEl.borderBottomWidth);
    const x = cbX + num(ps.left) + num(ps.marginLeft);
    const y = cbY + num(ps.top) + num(ps.marginTop);
    const width = cbX + cbW - num(ps.right) - num(ps.marginRight) - x;
    const height = cbY + cbH - num(ps.bottom) - num(ps.marginBottom) - y;
    if (width <= 0 || height <= 0) return { handled: true }; // collapsed → nothing visible

    const hasBgImg = ps.backgroundImage && ps.backgroundImage !== 'none';
    const pbl = hasBgImg ? parseBgLayers(ps, { x, y, width, height }) : null;
    const gradient: any = pbl ? (pbl.length === 1 ? pbl[0] : null) : hasBgImg ? parseFirstLinearGradient(ps.backgroundImage) : null;
    const pseudoGradients = pbl && pbl.length > 1 ? pbl.slice().reverse() : undefined;
    if (hasBgImg && !gradient && !pseudoGradients) return { handled: false }; // url()/conic/tiled
    if (ps.boxShadow && ps.boxShadow.includes('inset')) return { handled: false };
    const blur = ps.filter && ps.filter !== 'none' ? pureBlur(ps.filter) : 0;
    if (blur === null) return { handled: false }; // other filter functions
    const { hasBorder, border } = buildBorder(ps);
    if (hasBorder) {
      for (const st of [ps.borderTopStyle, ps.borderRightStyle, ps.borderBottomStyle, ps.borderLeftStyle])
        if (st === 'double' || st === 'groove' || st === 'ridge' || st === 'inset' || st === 'outset')
          return { handled: false };
    }
    const fill = transparent(ps.backgroundColor) ? null : normColor(ps.backgroundColor);
    const shadows = parseShadows(ps.boxShadow);
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
        id: nid(),
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
  const materializePseudo = (
    el: Element,
    sel: '::before' | '::after',
    clip: Clip | null,
    opacity: number,
  ): PaintNode[] | null => {
    const ps = win.getComputedStyle(el, sel);
    // content: "text" | "" (decorative box: carets, dots, bars, clearfix) | attr(name)
    const m = ps.content.match(/^(["'])([\s\S]*)\1$/);
    const am = ps.content.match(/^attr\(\s*([\w-]+)\s*\)$/);
    if (!m && !am) return null; // url()/counter()/quotes: not plain text
    // url() backgrounds are pre-loaded by walkNode (prepareImageLayers on the pseudo style); an unloaded one → raster
    if ((ps.backgroundImage || '').includes('url(') && !splitTopLevel(ps.backgroundImage).every((l) => l.trim() === 'none' || /gradient\(/.test(l) || (layerUrl(l) !== null && imgInfo.get(layerUrl(l)!)))) return null;
    const text = am
      ? el.getAttribute(am[1]) || ''
      : m![2]
          .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
          .replace(/\\([\s\S])/g, '$1');
    if (!text && ps.display === 'inline') return null; // empty inline pseudo paints nothing
    const span = doc.createElement('span');
    for (let i = 0; i < ps.length; i++) span.style.setProperty(ps[i], ps.getPropertyValue(ps[i]));
    span.style.setProperty('animation', 'none');
    span.style.setProperty('transition', 'none');
    span.textContent = text;
    const host = el as HTMLElement;
    const attr = 'data-fith-pseudo-host';
    const style = doc.createElement('style');
    style.textContent = `[${attr}]${sel}{content:none !important}`;
    doc.head.appendChild(style);
    host.setAttribute(attr, '');
    if (sel === '::before') host.insertBefore(span, host.firstChild);
    else host.appendChild(span);
    const start = nodes.length;
    try {
      const scs = win.getComputedStyle(span);
      const op = opacity * num(ps.opacity);
      emitBox(span, scs, clip, op);
      captureText(span, scs, clip, op);
    } finally {
      span.remove();
      style.remove();
      host.removeAttribute(attr);
    }
    return nodes.splice(start);
  };

  // SVG presentation properties to inline onto transplanted inline-svg nodes.
  const SVG_PAINT = [
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
  const COLOR_PROPS = new Set(['fill', 'stroke', 'stop-color']);
  const inlineSvgStyles = (srcRoot: Element, cloneRoot: Element) => {
    const src = [srcRoot, ...Array.from(srcRoot.querySelectorAll('*'))];
    const dst = [cloneRoot, ...Array.from(cloneRoot.querySelectorAll('*'))];
    for (let i = 0; i < src.length && i < dst.length; i++) {
      const scs = win.getComputedStyle(src[i]);
      if (scs.display === 'none') {
        dst[i].setAttribute('display', 'none');
        continue;
      }
      for (const prop of SVG_PAINT) {
        const v = scs.getPropertyValue(prop);
        if (!v || v === 'normal') continue;
        dst[i].setAttribute(prop, COLOR_PROPS.has(prop) ? normColor(v) : v);
      }
    }
  };

  const imgTasks: Promise<void>[] = [];

  const containerRasterFallback = !!(opts as any).containerRasterFallback;

  // Transplant an <svg> element: clone it, position/size it, resolve currentColor
  // and inline computed presentation styles so it survives without the page's CSS.
  const captureSvgEl = (el: Element, cs: CSSStyleDeclaration, r: DOMRect, clip: Clip | null, opacity: number) => {
    const clone = el.cloneNode(true) as SVGElement;
    clone.setAttribute('x', String(r.left));
    clone.setAttribute('y', String(r.top));
    clone.setAttribute('width', String(r.width));
    clone.setAttribute('height', String(r.height));
    // resolve currentColor used by icon fonts/icons
    (clone as any).style.color = normColor(cs.color);
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    // Inline computed presentation styles so CSS-class-styled SVG (e.g. MUI
    // x-charts line strokes / bar fills) survives transplanting without the
    // page's stylesheet. Walk original + clone in lockstep (same structure).
    inlineSvgStyles(el, clone);
    // walk() already includes the SVG root's opacity in the Scene wrapper.
    // Keep descendant opacity, but avoid applying the root opacity twice.
    clone.style.opacity = '1';
    // r (getBoundingClientRect) already includes the element's own CSS transform; keeping
    // it on the clone would apply it twice (Leaflet overlay panes, translate3d-positioned icons).
    clone.style.transform = 'none';
    clone.style.translate = 'none';
    clone.style.scale = 'none';
    clone.style.rotate = 'none';
    nodes.push({
      kind: 'inline-svg',
      id: nid(),
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      opacity,
      clip,
      markup: clone.outerHTML,
    });
  };

  // Capture an <img>: emit an image node now and resolve its href asynchronously
  // (canvas extraction → fetch → in-place raster fallback for tainted/failed loads).
  const captureImageEl = (el: Element, cs: CSSStyleDeclaration, r: DOMRect, clip: Clip | null, opacity: number) => {
    const img = el as HTMLImageElement;
    const objFit = cs.objectFit || 'fill';
    const preserveAspectRatio =
      objFit === 'contain' || objFit === 'scale-down'
        ? 'xMidYMid meet'
        : objFit === 'cover'
          ? 'xMidYMid slice'
          : 'none';
    const id = nid();
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
    nodes.push(node);
    imgTasks.push(
      (async () => {
        const src = img.currentSrc || img.src;
        // 1) Try canvas extraction (instant, no network, works for decoded images)
        const canvas = canvasExtractDataURL(img);
        if (canvas) { node.href = canvas; return; }
        // 2) Fall back to fetch
        const fetched = await fetchDataURL(src);
        if (fetched) { node.href = fetched; return; }
        // 3) CORS / network failure: convert this node in-place to a raster target
        //    so it keeps its paint-order position rather than appending at the end.
        const clamped = clampToCapture(r);
        if (clamped) {
          const imgFallback = { src, rect: { ...node.rect }, preserveAspectRatio };
          Object.assign(node, { kind: 'raster', rect: clamped, reason: 'img-cors', imgFallback });
          rasterTargets.push({ id, ...clamped });
        } else {
          // image is entirely outside the capture bounds — remove the placeholder
          const idx = nodes.indexOf(node);
          if (idx >= 0) nodes.splice(idx, 1);
        }
      })(),
    );
  };

  // Vector mask-image: walk the element normally, then tag every vector node it
  // produced with the mask. Raster nodes are skipped — their screenshot already
  // contains the page's masked rendering, so masking again would fade it twice.
  const walkInner = async (el: Element, clip: Clip | null, inheritedOpacity: number) => {
    const wcs = win.getComputedStyle(el);
    if ((wcs as any).maskImage && (wcs as any).maskImage !== 'none') await prepareImageLayers(wcs);
    const live = wcs.display !== 'none' && wcs.display !== 'contents' && !rootAncestors.has(el);
    const mk = live ? parseElementMask(el, wcs) : null;
    const cp = live && wcs.clipPath && wcs.clipPath !== 'none' ? parseClipShape(el, wcs) : null;
    if (!mk && !cp) return walkNode(el, clip, inheritedOpacity);
    const start = nodes.length;
    await walkNode(el, clip, inheritedOpacity);
    for (let i = start; i < nodes.length; i++) {
      const nd = nodes[i];
      if (nd.kind === 'raster') continue;
      if (mk) for (const one of Array.isArray(mk) ? mk : [mk]) (nd.masks ||= []).push(one);
      if (cp) (nd.clipShapes ||= []).push(cp);
    }
  };

  // 2D rotate/skew transforms are emitted as <g transform>: while an element's subtree is measured its
  // transform is cleared (so every rect is in untransformed space). Anything that needs a screenshot
  // inside it (raster targets use page coordinates) aborts via TransformBail → whole element rastered.
  class TransformBail extends Error {}
  let transformDepth = 0;
  const noVectorTransform = new WeakSet<Element>();

  // CSS filter / mix-blend-mode composite the whole subtree as one unit → tag its nodes with a group
  const withGroup = async (el: Element, clip: Clip | null, inheritedOpacity: number, run: () => Promise<void>) => {
    const gcs = win.getComputedStyle(el);
    const live = gcs.display !== 'none' && gcs.display !== 'contents' && !rootAncestors.has(el);
    const fl = live && gcs.filter && gcs.filter !== 'none' ? parseFilterList(gcs.filter) : null;
    const bm = live && gcs.mixBlendMode && gcs.mixBlendMode !== 'normal' ? gcs.mixBlendMode : null;
    if (!fl && !bm) return run();
    const id = 'g' + groupSeq++;
    const r = el.getBoundingClientRect();
    const pad = fl ? filterOverflow(fl) : 0;
    groups[id] = { filter: fl || undefined, blend: bm || undefined, region: fl ? { x: r.left - pad, y: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 } : undefined };
    groupedEls.add(el);
    const start = nodes.length;
    await run();
    let any = false;
    for (let i = start; i < nodes.length; i++) {
      const nd = nodes[i];
      if (nd.kind === 'raster') continue; // a screenshot already contains the filtered/blended pixels
      (nd.groups ||= []).push(id);
      any = true;
    }
    if (!any) delete groups[id];
  };

  const walk = async (el: Element, clip: Clip | null, inheritedOpacity: number): Promise<void> => {
    const cs0 = win.getComputedStyle(el);
    const tf = cs0.transform;
    if (!tf || tf === 'none' || noVectorTransform.has(el) || cs0.display === 'none' || cs0.display === 'contents' || rootAncestors.has(el))
      return withGroup(el, clip, inheritedOpacity, () => walkInner(el, clip, inheritedOpacity));
    const m = parseMatrix(tf);
    const rotated = !!m && !/matrix3d/.test(tf) && (Math.abs(m.b) > 1e-3 || Math.abs(m.c) > 1e-3);
    const has3D = /matrix3d/.test(tf) && (() => {
      const p = tf.match(/matrix3d\(([^)]+)\)/)![1].split(',').map((x) => parseFloat(x));
      const z = Math.abs(p[2]) > 1e-3 || Math.abs(p[6]) > 1e-3 || Math.abs(p[8]) > 1e-3 || Math.abs(p[9]) > 1e-3 || Math.abs(p[14]) > 1e-3;
      return z && inPerspective(el, p);
    })();
    const hasRotateProps = [cs0.getPropertyValue('rotate'), cs0.getPropertyValue('scale'), cs0.getPropertyValue('translate')].some((v) => v && v !== 'none');
    const m3 = /matrix3d/.test(tf) ? parseMatrix(tf) : null;
    const mm = m3 && !has3D ? m3 : m;
    const rot = !!mm && !has3D && (Math.abs(mm.b) > 1e-3 || Math.abs(mm.c) > 1e-3);
    if (!rot || has3D || hasRotateProps || !(el instanceof win.HTMLElement || el instanceof win.SVGElement)) return withGroup(el, clip, inheritedOpacity, () => walkInner(el, clip, inheritedOpacity));
    // a running CSS animation/transition would re-interpolate the cleared transform: keep raster
    try { if ((el as any).getAnimations && (el as any).getAnimations().length) return withGroup(el, clip, inheritedOpacity, () => walkInner(el, clip, inheritedOpacity)); } catch { /* ignore */ }
    void rotated;

    const he = el as HTMLElement;
    const originalStyle = he.getAttribute('style');
    const start = nodes.length, rStart = rasterTargets.length;
    const matrix = mm!;
    const originCss = cs0.transformOrigin; // px, relative to the border box
    he.setAttribute('style', (originalStyle ? originalStyle.replace(/;?\s*$/, ';') : '') + 'transform:none !important;transition:none !important');
    transformDepth++;
    let failed = false;
    try {
      const r0 = el.getBoundingClientRect(); // untransformed
      const [oxs, oys] = originCss.split(/\s+/);
      const ox = r0.left + (parseFloat(oxs) || 0), oy = r0.top + (parseFloat(oys) || 0);
      // T(o) · M · T(-o)
      const layer = {
        matrix: [
          matrix.a, matrix.b, matrix.c, matrix.d,
          ox - matrix.a * ox - matrix.c * oy + matrix.e,
          oy - matrix.b * ox - matrix.d * oy + matrix.f,
        ] as [number, number, number, number, number, number],
        outerClip: clip,
      };
      await withGroup(el, null, inheritedOpacity, () => walkInner(el, null, inheritedOpacity));
      for (let i = start; i < nodes.length; i++) (nodes[i].layers ||= []).push(layer);
    } catch (e) {
      if (!(e instanceof TransformBail)) throw e;
      failed = true;
    } finally {
      transformDepth--;
      if (originalStyle === null) he.removeAttribute('style');
      else he.setAttribute('style', originalStyle);
    }
    if (failed) {
      nodes.splice(start);
      rasterTargets.length = rStart;
      noVectorTransform.add(el); // re-walk with the old behaviour: raster the transformed element
      return withGroup(el, clip, inheritedOpacity, () => walkInner(el, clip, inheritedOpacity));
    }
  };

  let groupSeq = 0;
  const groups: Record<string, any> = {};

  type HoistItem = { k: Element; clip: Clip | null; opacity: number; z: number };
  let curHoist: { neg: HoistItem[]; pos: HoistItem[] } | null = null;
  const createsStackingContext = (el: Element, cs: CSSStyleDeclaration): boolean => {
    if (el === doc.documentElement || el === rootEl) return true;
    if (cs.position === 'fixed' || cs.position === 'sticky') return true;
    if (cs.zIndex !== 'auto') {
      if (cs.position !== 'static') return true;
      const pd = el.parentElement ? win.getComputedStyle(el.parentElement).display : '';
      if (/flex|grid/.test(pd)) return true;
    }
    if (num(cs.opacity || '1') < 1) return true;
    if (cs.transform !== 'none' || cs.filter !== 'none' || cs.clipPath !== 'none') return true;
    if ((cs as any).perspective && (cs as any).perspective !== 'none') return true;
    if ((cs as any).maskImage && (cs as any).maskImage !== 'none') return true;
    if (cs.mixBlendMode !== 'normal' || cs.isolation === 'isolate') return true;
    if ((cs as any).backdropFilter && (cs as any).backdropFilter !== 'none') return true;
    if (/transform|opacity|filter|perspective|clip-path|mask/.test((cs as any).willChange || '')) return true;
    if (/layout|paint|strict|content/.test((cs as any).contain || '')) return true;
    if ((cs as any).containerType && (cs as any).containerType !== 'normal') return true;
    return false;
  };

  const walkNode = async (el: Element, clip: Clip | null, inheritedOpacity: number) => {
    const cs = win.getComputedStyle(el);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') await prepareImageLayers(cs);

    // display:contents has no box of its own but its children (and direct text)
    // render normally in the parent's formatting context.
    if (cs.display === 'contents') {
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return;
      const contOpacity = inheritedOpacity * num(cs.opacity || '1');
      if (contOpacity === 0) return;
      captureText(el, cs, clip, contOpacity);
      for (const kid of Array.from(el.children)) await walk(kid as Element, clip, contOpacity);
      return;
    }

    if (!isVisible(el, cs)) return;
    const opacity = inheritedOpacity * num(cs.opacity || '1');
    const r = el.getBoundingClientRect();
    // visibility:hidden hides the element's own rendering but children can override
    // it with visibility:visible. We skip box/text for the hidden element itself
    // but always continue descent so visible children are captured.
    const visHidden = cs.visibility === 'hidden' || cs.visibility === 'collapse';
    // In subtree mode, ancestor elements (between document root and the selected
    // element) skip ALL rendering — we don't want container backgrounds appearing
    // behind the selected content. We still descend to capture siblings/cousins
    // that visually overlap the capture area with correct paint order.
    const skipRender = rootAncestors.has(el);

    const subtreeReason = !skipRender && needsSubtreeRaster(el, cs);
    if (subtreeReason) {
      // 2D <canvas> (charts, QR codes): the bitmap is readable → real <image>; WebGL/tainted/blank → raster
      if (el.tagName === 'CANVAS' && el.childElementCount === 0 && !visHidden && subtreeReason === 'media:CANVAS') {
        const url = canvasDataUrl(el as HTMLCanvasElement);
        if (url) {
          emitBox(el, cs, clip, opacity);
          const bl = num(cs.borderLeftWidth), bt = num(cs.borderTopWidth);
          const cl = bl + num(cs.paddingLeft), ct = bt + num(cs.paddingTop);
          const cr = num(cs.borderRightWidth) + num(cs.paddingRight), cb = num(cs.borderBottomWidth) + num(cs.paddingBottom);
          nodes.push({
            kind: 'image', id: nid(),
            rect: { x: r.left + cl, y: r.top + ct, width: Math.max(0, r.width - cl - cr), height: Math.max(0, r.height - ct - cb) },
            opacity, clip, href: url, preserveAspectRatio: cs.objectFit === 'contain' ? 'xMidYMid meet' : cs.objectFit === 'cover' ? 'xMidYMid slice' : 'none',
          } as PaintNode);
          return;
        }
      }
      if (!visHidden) pushRaster(r, clip, opacity, subtreeReason, el);
      return;
    }

    if (!skipRender && el.tagName.toLowerCase() === 'svg') {
      if (!visHidden) captureSvgEl(el, cs, r, clip, opacity);
      return;
    }

    if (!skipRender && el.tagName.toUpperCase() === 'IMG') {
      captureImageEl(el, cs, r, clip, opacity);
      return;
    }

    // Box-level effects we can't vectorize:
    //   • Leaf element  → rasterize and done (no children to miss)
    //   • Non-leaf with raster backend → rasterize as base layer so pseudo-elements
    //     and complex backgrounds appear, then vectorize children on top.  Children
    //     paint over the raster so the visual result is correct where vectorization
    //     is faithful; the raster fills the gaps (pseudo-elements, bg images, etc.).
    //   • Non-leaf without raster backend → emit what we can vectorize and continue.
    const boxReason = !skipRender && !visHidden && needsBoxRaster(el, cs);
    // ::after is emitted after the element's children (it paints on top of content);
    // hold its node here and push it past the child walk below.
    let childClip = clip;
    // an ancestor's overflow clip must not crop the picked element's own content
    if (clipsContent(cs) && !skipRender) {
      // For scrollable containers (overflow:auto/scroll) in full-content mode,
      // expand the clip to scrollWidth × scrollHeight so items that are outside
      // the container's current visible area are still included in the output.
      // For overflow:hidden the CSS dimensions are usually intentional (rounded
      // corner clips, dropdown menus, etc.) — keep them. BUT MUI Collapse,
      // Accordion, Drawer, and similar animation primitives use overflow:hidden
      // combined with a transitioning height to reveal content. After the
      // animation settles, scrollHeight typically equals clientHeight, but for
      // the brief window where height is still transitioning (or where layout
      // has sub-pixel mismatches), children would be silently clipped to the
      // collapsed size and disappear from the export. When scrollHeight clearly
      // exceeds clientHeight, expand the clip so the content survives.
      const htmlEl = el as HTMLElement;
      const isScrollContainer = cs.overflowX === 'scroll' || cs.overflowX === 'auto' || cs.overflowY === 'scroll' || cs.overflowY === 'auto';
      const isHiddenWithOverflow =
        (cs.overflowX === 'hidden' || cs.overflowY === 'hidden') &&
        ((htmlEl.scrollHeight || 0) - htmlEl.clientHeight > 1 ||
          (htmlEl.scrollWidth || 0) - htmlEl.clientWidth > 1);
      const captureScrollable = !!(opts as any).captureScrollableContent;
      // a ≤1px box is the sr-only pattern: its overflowing text must stay clipped
      const shouldExpand = captureScrollable && (isScrollContainer || isHiddenWithOverflow) && r.width > 1 && r.height > 1;
      const clipW = shouldExpand ? Math.max(r.width, htmlEl.scrollWidth || 0) : r.width;
      const clipH = shouldExpand ? Math.max(r.height, htmlEl.scrollHeight || 0) : r.height;
      childClip = intersect(clip, {
        x: r.left,
        y: r.top,
        width: clipW,
        height: clipH,
        radii: radiiOf(cs, r.width, r.height),
      });
    }

    let afterPseudoNodes: PaintNode[] = [];
    let pseudoVectorized = false;
    if (boxReason === 'pseudo') {
      // pseudo backgrounds may be url() images (accordion chevrons, icons): load them before the sync materialize
      for (const sel of ['::before', '::after'] as const) {
        const pbg = win.getComputedStyle(el, sel).backgroundImage;
        if (pbg && pbg !== 'none') for (const layer of splitTopLevel(pbg)) { const u = layerUrl(layer); if (u) await loadImgInfo(u); }
      }
      // Try to vectorize the decorative pseudo(s) rather than raster the whole box.
      const pseudoPart = (sel: '::before' | '::after') => {
        if (!pseudoVisible(el, sel)) return { handled: true as const, nodes: [] as PaintNode[] };
        const b = tryPseudoBox(el, cs, sel, clip, opacity);
        if (b.handled) return { handled: true as const, nodes: b.node ? [b.node] : [] };
        const t = materializePseudo(el, sel, clip, opacity);
        return t ? { handled: true as const, nodes: t } : { handled: false as const, nodes: [] as PaintNode[] };
      };
      const before = pseudoPart('::before');
      const after = pseudoPart('::after');
      if (before.handled && after.handled) {
        pseudoVectorized = true;
        // Paint order: host box → ::before → host content/children → ::after.
        emitBox(el, cs, clip, opacity);
        nodes.push(...before.nodes);
        captureText(el, cs, childClip, opacity);
        captureListMarker(el, cs, childClip, opacity);
        afterPseudoNodes = after.nodes;
      }
    }
    if (boxReason && !pseudoVectorized) {
      if (el.childElementCount === 0) {
        pushRaster(r, clip, opacity, boxReason, el);
        return;
      }
      if (containerRasterFallback) {
        pushRaster(r, clip, opacity, boxReason, el);
        // skip emitBox/captureText — the raster already captures them including ::marker
      } else {
        emitBox(el, cs, clip, opacity);
        captureText(el, cs, childClip, opacity);
        captureListMarker(el, cs, childClip, opacity);
      }
    } else if (!boxReason && !skipRender && !visHidden) {
        emitBox(el, cs, clip, opacity);
        captureText(el, cs, childClip, opacity);
      captureListMarker(el, cs, childClip, opacity);
    }

    const kids = nativeControl(el) ? [] : Array.from(el.children); // <option>s are painted by captureNative
    const parentIsFlexGrid = /flex|grid/.test(cs.display);
    const meta = kids.map((k) => {
      const kcs = win.getComputedStyle(k);
      const positioned = kcs.position !== 'static';
      const zRaw = kcs.zIndex;
      const z = zRaw === 'auto' ? 0 : parseInt(zRaw, 10) || 0;
      // z-index applies to positioned boxes and to flex/grid items
      const layered = zRaw !== 'auto' && (positioned || parentIsFlexGrid);
      return { k, positioned, z, layered };
    });
    // CSS paint order within a stacking context:
    //   1. negative z-index descendants (lowest first)
    //   2. block/inline flow (non-positioned) in DOM order
    //   3. positioned with z-index:auto or z-index:0 in DOM order (above flow)
    //   4. positive z-index descendants (lowest first)
    // z-indexed descendants belong to the *nearest stacking context*, not to their parent: a
    // `position:relative; z-index:2` box inside a plain wrapper still paints above a later
    // z-index:auto sibling of that wrapper. So z≠0 layers are hoisted to the nearest ancestor
    // that creates a stacking context and painted there (neg → flow → pos).
    const outerHoist = curHoist;
    const ownsContext = !outerHoist || createsStackingContext(el, cs);
    const mine: { neg: HoistItem[]; pos: HoistItem[] } = ownsContext ? { neg: [], pos: [] } : outerHoist!;
    curHoist = mine;
    const flowStart = nodes.length;
    try {
      for (const m of meta.filter((x) => !(x.layered && x.z !== 0))) {
        if (!m.positioned) await walk(m.k, childClip, opacity);
      }
      for (const m of meta.filter((x) => x.positioned && !(x.layered && x.z !== 0))) {
        await walk(m.k, childClip, opacity);
      }
      for (const m of meta) {
        if (m.layered && m.z !== 0) (m.z < 0 ? mine.neg : mine.pos).push({ k: m.k, clip: childClip, opacity, z: m.z });
      }

      // Walk open shadow roots after light-DOM children. Shadow DOM content renders
      // on top of the host's light-DOM background; placing it last preserves that
      // order. Slotted light-DOM elements are captured by their light-DOM walk
      // (range.getClientRects() returns their visual slot position), so no doubling.
      const shadow = (el as HTMLElement).shadowRoot;
      if (shadow) {
        for (const child of Array.from(shadow.children)) {
          await walk(child as Element, childClip, opacity);
        }
      }
    } finally {
      curHoist = outerHoist;
    }

    if (ownsContext && (mine.neg.length > 0 || mine.pos.length > 0)) {
      const flowNodes = nodes.splice(flowStart);
      curHoist = mine;
      try {
        // hoisted layers are stacking contexts of their own (they never re-hoist into `mine`)
        for (const it of mine.neg.sort((a, b) => a.z - b.z)) await walk(it.k, it.clip, it.opacity);
        nodes.push(...flowNodes);
        for (const it of mine.pos.sort((a, b) => a.z - b.z)) await walk(it.k, it.clip, it.opacity);
      } finally {
        curHoist = outerHoist;
      }
    }

    // ::after paints above the host's content (emitted after the child walk).
    nodes.push(...afterPseudoNodes);
  };

  const body = doc.body;
  let background: string;
  if (subtree) {
    // a subtree export is just the element: use its own opaque bg, else transparent
    const ebg = win.getComputedStyle(rootEl).backgroundColor;
    background = transparent(ebg) ? '' : normColor(ebg);
  } else {
    background = !transparent(win.getComputedStyle(doc.documentElement).backgroundColor)
      ? normColor(win.getComputedStyle(doc.documentElement).backgroundColor)
      : body && !transparent(win.getComputedStyle(body).backgroundColor)
        ? normColor(win.getComputedStyle(body).backgroundColor)
        : '#ffffff';
  }

  restoreScroll = (opts as any).captureScrollableContent ? resetScrollAndContentVisibility(doc, win, rootEl, subtree) : restoreScroll;
  // In subtree mode, walk from document root so siblings and cousins that
  // visually overlap the selected element's bounding area are captured with
  // correct paint order. rootAncestors guards suppress their own rendering.
  await walk(subtree ? (doc.documentElement as Element) : rootEl, null, 1);
  await Promise.all(imgTasks);

  restoreScroll();

  const fonts = (opts.fontMode ?? 'embed') === 'embed' ? await collectFonts(nodes, { doc, win, externalCss: (opts as any).externalCss }) : [];

  return {
    width: W,
    height: H,
    originX,
    originY,
    deviceScaleFactor: dpr,
    background,
    nodes,
    groups: Object.keys(groups).length ? groups : undefined,
    rasterTargets,
    fonts,
  };

  } finally {
    restoreScroll();
    restoreUnfurl();
  }
}
