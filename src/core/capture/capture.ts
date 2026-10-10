import type { Scene, PaintNode, Clip, CornerRadii, CaptureOptions, BgLayer } from '../ir/types.js';

/**
 * Captures the current page into a Scene IR. Runs INSIDE the page context, so it
 * must be fully self-contained (no imports/closure refs) to be injectable via
 * Playwright `page.evaluate`. The same function is reused by the extension and
 * in-page-library backends, where it is simply called directly.
 */
export async function captureScene(opts: CaptureOptions, root?: Element): Promise<Scene> {
  const dpr = opts.deviceScaleFactor || 1;
  const rootEl = root ?? document.documentElement;
  const subtree = rootEl !== document.documentElement;

  // Element export of scrollable content ("unfurl"): a picked container (or one
  // nested inside it, e.g. a sidebar's session list) only shows its viewport-sized
  // window, so the export would silently drop everything scrolled out of view.
  // Temporarily let every vertically-scrolling container grow to its full content
  // height — and release the fixed-height / flex-constrained ancestors up to the
  // root — so the root's own box (and thus the export) covers all of it. Inline
  // styles and scroll positions are restored in the `finally` below.
  const unfurlSaved: { el: HTMLElement; style: string | null }[] = [];
  const unfurlScroll: { el: HTMLElement; top: number; left: number }[] = [];
  if (subtree && (opts as any).captureScrollableContent && (opts as any).unfurlScrollContainers !== false) {
    const scrollers: HTMLElement[] = [];
    for (const el of [rootEl, ...Array.from(rootEl.querySelectorAll('*'))]) {
      const h = el as HTMLElement;
      if (!(h instanceof HTMLElement)) continue;
      const oy = getComputedStyle(h).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && h.scrollHeight > h.clientHeight + 1) scrollers.push(h);
    }
    const touched = new Set<HTMLElement>();
    for (const sc of scrollers) {
      unfurlScroll.push({ el: sc, top: sc.scrollTop, left: sc.scrollLeft });
      for (let a: HTMLElement | null = sc; a; a = a.parentElement) {
        touched.add(a);
        if (a === rootEl) break;
      }
    }
    for (const el of touched) {
      const original = el.getAttribute('style');
      unfurlSaved.push({ el, style: original });
      const parentFlex = el.parentElement ? /flex/.test(getComputedStyle(el.parentElement).display) : false;
      const cs0 = getComputedStyle(el);
      const decl = ['height:auto', 'max-height:none'];
      if (parentFlex) decl.push('flex:0 0 auto');
      // visible+hidden on the two axes would compute back to `auto`; clip the x axis instead
      if (cs0.overflowY !== 'visible') {
        decl.push('overflow-y:visible');
        if (cs0.overflowX !== 'visible') decl.push('overflow-x:clip');
      }
      // Written through the attribute, not el.style: a CSSOM edit makes Chrome leave
      // `style=""` behind even after removeAttribute, so the DOM wouldn't round-trip.
      el.setAttribute('style', (original ? original.replace(/;?\s*$/, ';') : '') + decl.map((d) => d + ' !important').join(';'));
    }
    for (const { el } of unfurlScroll) {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
  }
  const unfurlRestore = () => {
    for (const { el, style } of unfurlSaved) {
      if (style === null) el.removeAttribute('style');
      else el.setAttribute('style', style);
    }
    for (const { el, top, left } of unfurlScroll) {
      el.scrollTop = top;
      el.scrollLeft = left;
    }
  };
  try {
  const rootRect = rootEl.getBoundingClientRect();
  const W = subtree ? rootRect.width : opts.width;
  const H = subtree
    ? rootRect.height
    : opts.height ||
      Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0,
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

  const metricsCanvas = document.createElement('canvas');
  const mctx = metricsCanvas.getContext('2d')!;

  // Normalize any computed color (oklch/oklab/lab/lch/color()/hwb/hsl/…) to plain
  // sRGB rgb()/rgba(). getComputedStyle returns modern color functions verbatim
  // (e.g. shadcn/Tailwind oklch), which SVG renderers without CSS Color 4 can't
  // display — they must be converted for a portable, pure SVG.
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = 1;
  const cctx = colorCanvas.getContext('2d', { willReadFrequently: true })!;
  const colorCache = new Map<string, string>();
  // non-color paint keywords (valid for fill/stroke) must pass through untouched
  const NON_COLOR = new Set(['none', 'currentcolor', 'context-fill', 'context-stroke', 'inherit', 'initial', 'unset']);
  const SENTINEL = 'rgba(1, 2, 3, 0.5)';
  const normColor = (c: string): string => {
    if (!c) return c;
    if (c === 'transparent' || c.charCodeAt(0) === 35 /* # */ || /^rgb/i.test(c)) return c;
    if (NON_COLOR.has(c.toLowerCase())) return c;
    const cached = colorCache.get(c);
    if (cached !== undefined) return cached;
    let out = c;
    try {
      // detect invalid color: fillStyle keeps its prior value when assigned junk
      cctx.fillStyle = SENTINEL;
      cctx.fillStyle = c;
      if (cctx.fillStyle === SENTINEL) {
        colorCache.set(c, c);
        return c;
      }
      cctx.clearRect(0, 0, 1, 1);
      cctx.fillRect(0, 0, 1, 1);
      const d = cctx.getImageData(0, 0, 1, 1).data;
      out =
        d[3] === 255
          ? `rgb(${d[0]}, ${d[1]}, ${d[2]})`
          : `rgba(${d[0]}, ${d[1]}, ${d[2]}, ${Math.round((d[3] / 255) * 1000) / 1000})`;
    } catch {
      out = c;
    }
    colorCache.set(c, out);
    return out;
  };

  const num = (v: string | null | undefined) => {
    const n = parseFloat(v || '');
    return isFinite(n) ? n : 0;
  };

  const transparent = (c: string) =>
    !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)' ||
    // alpha-0 only: a bare `, 0)` suffix also matches opaque rgb(255, 153, 0) (blue channel 0)
    /^(?:rgba|hsla)\([^)]*,\s*0(?:\.0+)?\)\s*$/.test(c) || /\/\s*0(?:\.0+)?%?\s*\)\s*$/.test(c);

  const parseMatrix = (tf: string) => {
    if (!tf || tf === 'none') return null;
    const m = tf.match(/matrix\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(',').map((x) => parseFloat(x));
      return { a: p[0], b: p[1], c: p[2], d: p[3], e: p[4], f: p[5] };
    }
    const m3 = tf.match(/matrix3d\(([^)]+)\)/);
    if (m3) {
      const p = m3[1].split(',').map((x) => parseFloat(x));
      return { a: p[0], b: p[1], c: p[4], d: p[5], e: p[12], f: p[13] };
    }
    return null;
  };

  const splitTopLevel = (s: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of s) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out;
  };

  const sideToAngle: Record<string, number> = {
    'to top': 0,
    'to right': 90,
    'to bottom': 180,
    'to left': 270,
  };

  // Parse a single linear-gradient() into a structured fill, or null if it is
  // anything we don't vectorize (radial/conic/url, corner keywords, px stops,
  // multiple layers) — those fall back to raster.
  const parseLinearGradient = (value: string) => {
    const v = value.trim();
    if (!/^linear-gradient\(/.test(v)) return null;
    if (v.lastIndexOf('linear-gradient(') !== 0) return null; // single layer only
    const inner = v.slice(v.indexOf('(') + 1, v.lastIndexOf(')'));
    const parts = splitTopLevel(inner).map((p) => p.trim());
    if (parts.length === 0) return null;

    let angle = 180;
    let i = 0;
    const first = parts[0];
    if (/deg$/.test(first)) {
      angle = parseFloat(first);
      i = 1;
    } else if (/^to\b/.test(first)) {
      if (!(first in sideToAngle)) return null; // corner keyword: aspect-dependent, raster it
      angle = sideToAngle[first];
      i = 1;
    } else if (/(rad|turn|grad)$/.test(first)) {
      const angleNum = parseFloat(first);
      if (/turn$/.test(first)) angle = angleNum * 360;
      else if (/grad$/.test(first)) angle = angleNum * 0.9;
      else angle = (angleNum * 180) / Math.PI;
      i = 1;
    }

    const stops: { offset: number | null; color: string }[] = [];
    for (; i < parts.length; i++) {
      const seg = parts[i];
      const colorMatch = seg.match(
        /^((?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^)]+\)|#[0-9a-fA-F]+|[a-zA-Z]+)/,
      );
      if (!colorMatch) return null;
      const rawColor = colorMatch[0];
      const color = normColor(rawColor);
      // SVG stop-opacity interpolation diverges from CSS when stop alphas differ;
      // raster gradients with any non-opaque stop to stay faithful.
      const alpha = color.match(/rgba\([^)]*,\s*([\d.]+)\s*\)$/);
      if ((alpha && parseFloat(alpha[1]) < 1) || rawColor === 'transparent') return null;
      const rest = seg.slice(rawColor.length).trim();
      const positions = rest ? rest.split(/\s+/) : [];
      if (positions.length === 0) {
        stops.push({ offset: null, color });
      } else {
        for (const p of positions) {
          if (!/%$/.test(p)) return null; // px / other units: raster
          stops.push({ offset: parseFloat(p) / 100, color });
        }
      }
    }
    if (stops.length < 2) return null;

    // fill missing offsets (CSS rules) and enforce monotonic non-decreasing
    if (stops[0].offset == null) stops[0].offset = 0;
    if (stops[stops.length - 1].offset == null) stops[stops.length - 1].offset = 1;
    let lastDefined = 0;
    for (let k = 1; k < stops.length; k++) {
      if (stops[k].offset != null) {
        const gap = k - lastDefined;
        if (gap > 1) {
          const start = stops[lastDefined].offset as number;
          const end = stops[k].offset as number;
          for (let j = 1; j < gap; j++) stops[lastDefined + j].offset = start + ((end - start) * j) / gap;
        }
        lastDefined = k;
      }
    }
    let prev = 0;
    const finalStops = stops.map((s) => {
      let off = Math.max(0, Math.min(1, s.offset as number));
      off = Math.max(off, prev);
      prev = off;
      return { offset: off, color: s.color };
    });
    return { type: 'linear-gradient' as const, angle, stops: finalStops };
  };

  // Corner radii in px. Computed `border-radius` keeps percentages ("50%"), which must be resolved
  // against the box (horizontal % vs width, vertical % vs height; elliptical corners use the smaller
  // radius since the IR is circular-only).
  const radiiOf = (cs: CSSStyleDeclaration, w?: number, h?: number): CornerRadii => {
    const one = (v: string): number => {
      const parts = (v || '0').trim().split(/\s+/);
      const res = parts.map((t, i) => (t.endsWith('%') ? (parseFloat(t) / 100) * (i === 0 ? w ?? 0 : h ?? w ?? 0) : num(t)));
      return res[0];
    };
    return [one(cs.borderTopLeftRadius), one(cs.borderTopRightRadius), one(cs.borderBottomRightRadius), one(cs.borderBottomLeftRadius)];
  };

  // vertical radii of elliptical corners (`50%`, `10px / 30px`); undefined when every corner is circular
  const radiiYOf = (cs: CSSStyleDeclaration, w: number, h: number): CornerRadii | undefined => {
    const one = (v: string): [number, number] => {
      const parts = (v || '0').trim().split(/\s+/);
      const px = (t: string, ref: number) => (t.endsWith('%') ? (parseFloat(t) / 100) * ref : num(t));
      return [px(parts[0], w), px(parts[1] ?? parts[0], h)];
    };
    const c = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(one);
    if (c.every((q) => Math.abs(q[0] - q[1]) < 0.01)) return undefined;
    return c.map((q) => q[1]) as CornerRadii;
  };

  const intersect = (a: Clip | null, b: Clip): Clip => {
    if (!a) return b;
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    // pick the tighter (innermost) radii — approximation for nested rounded clips
    const radii = b.width * b.height <= a.width * a.height ? b.radii : a.radii;
    return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y), radii };
  };

  const clipsContent = (cs: CSSStyleDeclaration) =>
    ['hidden', 'clip', 'scroll', 'auto'].includes(cs.overflowX) ||
    ['hidden', 'clip', 'scroll', 'auto'].includes(cs.overflowY);

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
    const cs = getComputedStyle(el, sel);
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
    if (cs.textOverflow === 'ellipsis' || cs.direction === 'rtl') return false;
    return true;
  };

  // CSS `filter` function list → FilterOp[] (null when it holds anything SVG can't reproduce, e.g. url()).
  const parseFilterList = (v: string | undefined) => {
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
        const color = cm ? normColor(cm[0]) : 'rgb(0, 0, 0)';
        const lens = (cm ? arg.replace(cm[0], '') : arg).match(/-?[\d.]+px/g) || [];
        if (lens.length < 2) return null;
        ops.push({ fn, x: parseFloat(lens[0] as string), y: parseFloat(lens[1] as string), blur: lens[2] ? parseFloat(lens[2] as string) : 0, color });
      } else return null;
    }
    return ops.length ? ops : null;
  };
  // how far a filter chain can paint beyond the element box
  const filterOverflow = (ops: any[]) => {
    let pad = 4;
    for (const o of ops) {
      if (o.fn === 'blur') pad += o.px * 3;
      else if (o.fn === 'drop-shadow') pad += Math.abs(o.x) + Math.abs(o.y) + o.blur * 1.5 + 2;
    }
    return pad;
  };
  const groupedEls = new WeakSet<Element>();

  // `filter: blur(Npx)` alone (the "glow" decoration pattern) maps 1:1 to feGaussianBlur.
  const pureBlur = (filter: string | undefined): number | null => {
    const m = (filter || '').trim().match(/^blur\(\s*([\d.]+)px\s*\)$/);
    return m ? parseFloat(m[1]) : null;
  };

  // clip-path basic shapes → absolute-px SVG path data (reference box = border box). null when
  // unsupported (url(), path(), geometry boxes other than border-box…): stays a subtree raster.
  const rrPath = (x: number, y: number, w: number, h: number, rad: number[]): string => {
    const m = Math.min(w, h) / 2;
    const [tl, tr, br, bl] = rad.map((v) => Math.max(0, Math.min(v, m)));
    const f = (v: number) => String(Math.round(v * 100) / 100);
    return `M${f(x + tl)},${f(y)}H${f(x + w - tr)}${tr ? `A${f(tr)},${f(tr)} 0 0 1 ${f(x + w)},${f(y + tr)}` : ''}V${f(y + h - br)}${br ? `A${f(br)},${f(br)} 0 0 1 ${f(x + w - br)},${f(y + h)}` : ''}H${f(x + bl)}${bl ? `A${f(bl)},${f(bl)} 0 0 1 ${f(x)},${f(y + h - bl)}` : ''}V${f(y + tl)}${tl ? `A${f(tl)},${f(tl)} 0 0 1 ${f(x + tl)},${f(y)}` : ''}Z`;
  };
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

  const needsSubtreeRaster = (el: Element, cs: CSSStyleDeclaration) => {
    const tag = el.tagName.toUpperCase();
    if (['CANVAS', 'VIDEO', 'IFRAME', 'OBJECT', 'EMBED'].includes(tag)) return 'media:' + tag;
    if (['INPUT', 'SELECT', 'TEXTAREA', 'PROGRESS', 'METER'].includes(tag) && !vectorTextInput(el, cs)) return 'form-control';
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
        if (has3D) return 'transform-3d';
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

  // Try to parse a linear-gradient from a background-image value that may contain
  // multiple comma-separated layers. Returns the first vectorizable layer found,
  // so "url(…), linear-gradient(…)" still yields a gradient instead of falling back.
  const parseFirstLinearGradient = (value: string) => {
    const single = parseLinearGradient(value);
    if (single) return single;
    const layers = splitTopLevel(value);
    if (layers.length <= 1) return null;
    for (const layer of layers) {
      const g = parseLinearGradient(layer.trim());
      if (g) return g;
    }
    return null;
  };

  // ---- background gradients (all layers) -------------------------------------------------
  // Supports linear-/radial-gradient with %/px stops, corner keywords, alpha stops (resampled in
  // premultiplied space like CSS) and multiple layers. null = something we can't reproduce exactly
  // (conic, repeating-*, tiled layers, url() mixed in), which keeps the raster fallback.
  type GBox = { x: number; y: number; width: number; height: number };
  const rgbaOf = (c: string): [number, number, number, number] | null => {
    const m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/i);
    if (!m) return null;
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), a];
  };
  const STOP_COLOR = /^((?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^)]+\)|#[0-9a-fA-F]+|[a-zA-Z]+)/;
  // parts = comma-split stop list; lineLen = px length that 100% maps to
  const parseGradientStops = (parts: string[], lineLen: number, repeating = false) => {
    const raw: { offset: number | null; color: string }[] = [];
    for (const seg of parts) {
      const cm = seg.trim().match(STOP_COLOR);
      if (!cm) return null; // transition hint / calc() / unknown
      let color = normColor(cm[0]);
      if (color === 'transparent') color = 'rgba(0, 0, 0, 0)'; // CSS `transparent` is alpha-0 black
      const rest = seg.trim().slice(cm[0].length).trim();
      const positions = rest ? rest.split(/\s+/) : [];
      if (positions.length === 0) raw.push({ offset: null, color });
      else {
        for (const pos of positions) {
          if (/%$/.test(pos)) raw.push({ offset: parseFloat(pos) / 100, color });
          else if (/px$/.test(pos) && lineLen > 0) raw.push({ offset: parseFloat(pos) / lineLen, color });
          else if (/deg$/.test(pos)) raw.push({ offset: parseFloat(pos) / 360, color });
          else if (/turn$/.test(pos)) raw.push({ offset: parseFloat(pos), color });
          else if (pos === '0') raw.push({ offset: 0, color });
          else return null;
        }
      }
    }
    if (raw.length < 2) return null;
    if (raw[0].offset == null) raw[0].offset = 0;
    if (raw[raw.length - 1].offset == null) raw[raw.length - 1].offset = 1;
    let last = 0;
    for (let k = 1; k < raw.length; k++) {
      if (raw[k].offset != null) {
        const gap = k - last;
        if (gap > 1) {
          const a = raw[last].offset as number, b = raw[k].offset as number;
          for (let j = 1; j < gap; j++) raw[last + j].offset = a + ((b - a) * j) / gap;
        }
        last = k;
      }
    }
    let prev = -Infinity;
    const stops = raw.map((st) => {
      const off = Math.max(st.offset as number, prev);
      prev = off;
      return { offset: off, color: st.color };
    });
    // SVG interpolates un-premultiplied, CSS premultiplied: where alpha changes between stops,
    // insert intermediate stops sampled in premultiplied space so both agree visually.
    const out: { offset: number; color: string }[] = [];
    for (let k = 0; k < stops.length; k++) {
      out.push(stops[k]);
      if (k === stops.length - 1) break;
      const c0 = rgbaOf(stops[k].color), c1 = rgbaOf(stops[k + 1].color);
      const span = stops[k + 1].offset - stops[k].offset;
      if (!c0 || !c1 || span <= 1e-6 || c0[3] === c1[3] && (c0[3] === 1 || (c0[0] === c1[0] && c0[1] === c1[1] && c0[2] === c1[2]))) continue;
      const N = 7;
      for (let j = 1; j < N; j++) {
        const t = j / N;
        const a = c0[3] + (c1[3] - c0[3]) * t;
        const pm = [0, 1, 2].map((q) => (c0[q] * c0[3] * (1 - t) + c1[q] * c1[3] * t));
        const col = a > 1e-4 ? pm.map((v) => Math.round(v / a)) : [c1[0], c1[1], c1[2]];
        out.push({ offset: stops[k].offset + span * t, color: `rgba(${col[0]}, ${col[1]}, ${col[2]}, ${Math.round(a * 1000) / 1000})` });
      }
    }
    // SVG stop offsets live in [0,1] (a repeating gradient is normalised by the caller)
    if (repeating) return out;
    return out.map((st) => ({ offset: Math.min(1, Math.max(0, st.offset)), color: st.color }));
  };

  const lenToPx = (t: string, ref: number): number | null => {
    if (/%$/.test(t)) return (parseFloat(t) / 100) * ref;
    if (/px$/.test(t)) return parseFloat(t);
    if (t === '0') return 0;
    return null;
  };

  const parseGradientLayer = (layer: string, box: GBox) => {
    const v = layer.trim();
    const repeating = /^repeating-linear-gradient\(/.test(v);
    const isLinear = /^(?:repeating-)?linear-gradient\(/.test(v), isRadial = /^radial-gradient\(/.test(v), isConic = /^conic-gradient\(/.test(v);
    if (!isLinear && !isRadial && !isConic) return null;
    if (v.lastIndexOf('gradient(') !== v.indexOf('gradient(')) return null;
    const inner = v.slice(v.indexOf('(') + 1, v.lastIndexOf(')'));
    const parts = splitTopLevel(inner).map((q) => q.trim());
    // `in srgb` is the interpolation SVG already uses; other colour spaces (oklab, hsl…) would differ
    const ci = parts[0].match(/^(.*?)\s*\bin\s+([\w-]+)(?:\s+\w+\s+hue)?$/);
    if (ci) {
      if (ci[2] !== 'srgb') return null;
      if (ci[1]) parts[0] = ci[1]; else parts.shift();
    }
    if (parts.length < 2) return null;
    const { width: w, height: h } = box;
    if (w <= 0 || h <= 0) return null;
    if (isLinear) {
      let angle = 180, i = 0;
      const first = parts[0];
      if (/^-?[\d.]+(deg|rad|turn|grad)$/.test(first)) {
        const f = parseFloat(first);
        angle = /turn$/.test(first) ? f * 360 : /grad$/.test(first) ? f * 0.9 : /rad$/.test(first) ? (f * 180) / Math.PI : f;
        i = 1;
      } else if (/^to\b/.test(first)) {
        const k = first.replace(/^to\s+/, '').split(/\s+/).sort().join(' ');
        const deg = (Math.atan2(h, w) * 180) / Math.PI;
        const map: Record<string, number> = { top: 0, right: 90, bottom: 180, left: 270, 'right top': deg, 'bottom right': 180 - deg, 'bottom left': 180 + deg, 'left top': 360 - deg };
        if (!(k in map)) return null;
        angle = map[k];
        i = 1;
      }
      const rad = (angle * Math.PI) / 180;
      const lineLen = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
      const stops = parseGradientStops(parts.slice(i), lineLen, repeating);
      if (!stops) return null;
      if (!repeating) return { type: 'linear-gradient' as const, angle, stops, box };
      const f0 = stops[0].offset, f1 = stops[stops.length - 1].offset;
      if (f1 - f0 < 1e-4) return null;
      return {
        type: 'linear-gradient' as const, angle, box,
        repeat: { from: f0, to: f1 },
        stops: stops.map((st) => ({ offset: (st.offset - f0) / (f1 - f0), color: st.color })),
      };
    }
    if (isConic) {
      let from = 0, atX = w / 2, atY = h / 2, ci = 0;
      const head = /^(from|at)\b/.test(parts[0]) ? parts[0] : '';
      if (head) {
        ci = 1;
        const fm = head.match(/from\s+(-?[\d.]+)(deg|turn|rad)/);
        if (fm) from = fm[2] === 'turn' ? parseFloat(fm[1]) * 360 : fm[2] === 'rad' ? (parseFloat(fm[1]) * 180) / Math.PI : parseFloat(fm[1]);
        else if (/^from\b/.test(head)) return null;
        const am = head.match(/\bat\s+(.+)$/);
        if (am) {
          const toks = am[1].trim().split(/\s+/);
          const pt = (t: string, ref: number, horiz: boolean): number | null =>
            t === 'center' ? ref / 2 : t === (horiz ? 'left' : 'top') ? 0 : t === (horiz ? 'right' : 'bottom') ? ref : lenToPx(t, ref);
          let tx = toks[0], ty = toks[1] ?? 'center';
          if (toks.length === 1 && (toks[0] === 'top' || toks[0] === 'bottom')) { ty = toks[0]; tx = 'center'; }
          else if (/^(top|bottom)$/.test(toks[0]) && toks[1]) { tx = toks[1]; ty = toks[0]; }
          const px = pt(tx, w, true), py = pt(ty, h, false);
          if (px === null || py === null || toks.length > 2) return null;
          atX = px; atY = py;
        }
      }
      const cstops = parseGradientStops(parts.slice(ci), 0);
      return cstops ? { type: 'conic-gradient' as const, cx: box.x + atX, cy: box.y + atY, from, stops: cstops, box } : null;
    }
    // radial-gradient([circle|ellipse] [size] [at pos], stops…)
    let i = 0;
    let shape: 'circle' | 'ellipse' = 'ellipse';
    let sizeKw = 'farthest-corner';
    let lens: number[] = [];
    let atX = w / 2, atY = h / 2;
    const head = /^(circle|ellipse|closest-side|farthest-side|closest-corner|farthest-corner|at\b|[-\d.]+(px|%))/.test(parts[0]) ? parts[0] : '';
    if (head) {
      i = 1;
      let pre = head, at = '';
      const ai = head.search(/\bat\b/);
      if (ai >= 0) { pre = head.slice(0, ai).trim(); at = head.slice(ai + 2).trim(); }
      for (const t of pre.split(/\s+/).filter(Boolean)) {
        if (t === 'circle' || t === 'ellipse') shape = t;
        else if (/^(closest|farthest)-(side|corner)$/.test(t)) sizeKw = t;
        else {
          const px = lenToPx(t, t.endsWith('%') ? (lens.length === 0 ? w : h) : 0);
          if (px === null) return null;
          lens.push(px);
        }
      }
      if (lens.length === 1 && !pre.includes('circle') && !pre.includes('ellipse')) shape = 'circle';
      if (lens.length === 2) shape = 'ellipse';
      if (at) {
        const toks = at.split(/\s+/);
        const posTok = (t: string, ref: number, horiz: boolean): number | null => {
          if (t === 'center') return ref / 2;
          if (t === (horiz ? 'left' : 'top')) return 0;
          if (t === (horiz ? 'right' : 'bottom')) return ref;
          return lenToPx(t, ref);
        };
        let tx = toks[0], ty = toks[1] ?? 'center';
        if (toks.length === 1) { if (toks[0] === 'top' || toks[0] === 'bottom') { ty = toks[0]; tx = 'center'; } }
        else if (/^(top|bottom)$/.test(toks[0]) || /^(left|right)$/.test(toks[1])) { tx = toks[1]; ty = toks[0]; }
        const px = posTok(tx, w, true), py = posTok(ty, h, false);
        if (px === null || py === null || toks.length > 2) return null;
        atX = px; atY = py;
      }
    }
    const dxL = atX, dxR = w - atX, dyT = atY, dyB = h - atY;
    let rx: number, ry: number;
    if (lens.length) {
      rx = lens[0]; ry = lens.length > 1 ? lens[1] : lens[0];
    } else if (sizeKw === 'closest-side') {
      rx = Math.min(dxL, dxR); ry = Math.min(dyT, dyB);
      if (shape === 'circle') rx = ry = Math.min(rx, ry);
    } else if (sizeKw === 'farthest-side') {
      rx = Math.max(dxL, dxR); ry = Math.max(dyT, dyB);
      if (shape === 'circle') rx = ry = Math.max(rx, ry);
    } else if (sizeKw === 'closest-corner') {
      const cx2 = Math.min(dxL, dxR), cy2 = Math.min(dyT, dyB);
      if (shape === 'circle') rx = ry = Math.hypot(cx2, cy2);
      else { const fx = cx2, fy = cy2; rx = fx * Math.SQRT2; ry = fy * Math.SQRT2; }
    } else {
      const fx = Math.max(dxL, dxR), fy = Math.max(dyT, dyB);
      if (shape === 'circle') rx = ry = Math.hypot(fx, fy);
      else { rx = fx * Math.SQRT2; ry = fy * Math.SQRT2; }
    }
    if (!(rx > 0) || !(ry > 0)) return null;
    const stops = parseGradientStops(parts.slice(i), rx);
    return stops ? { type: 'radial-gradient' as const, cx: box.x + atX, cy: box.y + atY, rx, ry, stops, box } : null;
  };

  // All gradient layers of a background-image (CSS order: first = top). null when any layer is
  // unsupported or sized/tiled (so raster stays the fallback instead of a wrong vector).
  const parseBgLayers = (cs: CSSStyleDeclaration, box: GBox) => {
    const value = cs.backgroundImage;
    if (!value || value === 'none') return null;
    if (cs.backgroundBlendMode && cs.backgroundBlendMode.split(',').some((m) => m.trim() !== 'normal')) return null;
    // the fast path paints each gradient over the whole box: only valid for the default origin/clip/attachment
    if (splitTopLevel(cs.backgroundClip || 'border-box').some((q) => q.trim() !== 'border-box')) return null;
    if (splitTopLevel(cs.backgroundOrigin || 'padding-box').some((q) => q.trim() !== 'padding-box')) return null;
    if (splitTopLevel(cs.backgroundAttachment || 'scroll').some((q) => q.trim() === 'fixed')) return null;
    const layers = splitTopLevel(value);
    const sizes = splitTopLevel(cs.backgroundSize || 'auto');
    const out: NonNullable<ReturnType<typeof parseGradientLayer>>[] = [];
    for (let k = 0; k < layers.length; k++) {
      if (layers[k].trim() === 'none') continue; // `image, color` shorthand leaves an empty layer
      const size = (sizes[k % sizes.length] || 'auto').trim();
      if (!['auto', 'auto auto', '100%', '100% 100%', 'cover', 'contain'].includes(size)) return null;
      const g = parseGradientLayer(layers[k], box);
      if (!g) return null;
      out.push(g);
    }
    return out.length ? out : null;
  };
  // CSS background positioning area (padding box) of an element, absolute px
  const paddingBoxOf = (el: Element, cs: CSSStyleDeclaration): GBox => {
    const r = el.getBoundingClientRect();
    const l = num(cs.borderLeftWidth), t = num(cs.borderTopWidth);
    const origin = cs.backgroundOrigin;
    if (origin === 'border-box') return { x: r.left, y: r.top, width: r.width, height: r.height };
    return { x: r.left + l, y: r.top + t, width: r.width - l - num(cs.borderRightWidth), height: r.height - t - num(cs.borderBottomWidth) };
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
  const normDataUrl = (u: string): string => {
    const m = u.match(/^data:([^,]*?),([\s\S]*)$/);
    if (!m || /;base64$/i.test(m[1])) return u;
    try {
      const raw = decodeURIComponent(m[2]);
      const mime = m[1].split(';')[0] || 'text/plain';
      return `data:${mime};base64,${btoa(unescape(encodeURIComponent(raw)))}`;
    } catch {
      return u;
    }
  };
  const loadImgInfo = async (url: string) => {
    if (imgInfo.has(url)) return;
    imgInfo.set(url, null);
    const fetched = await fetchDataURL(url);
    if (!fetched) return;
    const href = normDataUrl(fetched);
    const dim = await new Promise<{ w: number; h: number } | null>((res) => {
      const im = new Image();
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => res(null);
      im.src = href;
    });
    if (dim) imgInfo.set(url, { href, w: dim.w, h: dim.h });
  };
  // the single url() of a one-layer image property, else null
  const singleUrl = (value: string | undefined): string | null => {
    if (!value || value === 'none' || splitTopLevel(value).length !== 1) return null;
    const m = value.trim().match(/^url\((["']?)([\s\S]*)\1\)$/);
    return m ? m[2].replace(/\\(["'])/g, '$1') : null;
  };
  // url of one background layer: `url(..)` or the first candidate of `image-set(url(..) 1x, …)`
  const layerUrl = (layer: string): string | null => {
    const t = layer.trim();
    const m = t.match(/^url\((["']?)([\s\S]*)\1\)$/) || t.match(/^(?:-webkit-)?image-set\(\s*url\((["']?)([\s\S]*?)\1\)/);
    return m ? m[2].replace(/\\(["'])/g, '$1') : null;
  };
  const prepareImageLayers = async (cs: CSSStyleDeclaration) => {
    const bgv = cs.backgroundImage;
    if (bgv && bgv !== 'none') for (const layer of splitTopLevel(bgv)) { const u = layerUrl(layer); if (u) await loadImgInfo(u); }
    const a = singleUrl(cs.backgroundImage);
    if (a) await loadImgInfo(a);
    const b = singleUrl((cs as any).maskImage);
    if (b) await loadImgInfo(b);
  };
  // Resolve CSS size/position/repeat for one image layer inside `area`.
  // Returns null when we can't reproduce it exactly (tiling etc.).
  const placeImageLayer = (
    info: { w: number; h: number },
    sizeV: string,
    posV: string,
    repeatV: string,
    area: { x: number; y: number; width: number; height: number },
  ) => {
    const ratio = info.w > 0 && info.h > 0 ? info.w / info.h : 0;
    const nat = { w: info.w > 0 ? info.w : area.width, h: info.h > 0 ? info.h : area.height };
    let w = nat.w;
    let h = nat.h;
    const sv = (sizeV || 'auto').trim();
    if (sv === 'contain' || sv === 'cover') {
      const r = ratio || area.width / Math.max(1, area.height);
      const fitW = area.width / Math.max(1e-6, area.height) <= r; // limited by width?
      const useW = sv === 'contain' ? fitW : !fitW;
      if (useW) { w = area.width; h = w / r; } else { h = area.height; w = h * r; }
    } else {
      const [sw = 'auto', sh = 'auto'] = sv.split(/\s+/);
      const rs = (t: string, base: number) =>
        t === 'auto' ? null : /%$/.test(t) ? (parseFloat(t) / 100) * base : /px$/.test(t) ? parseFloat(t) : NaN;
      const rw = rs(sw, area.width);
      const rh = rs(sh, area.height);
      if ((rw !== null && Number.isNaN(rw)) || (rh !== null && Number.isNaN(rh))) return null;
      if (rw !== null && rh !== null) { w = rw; h = rh; }
      else if (rw !== null) { w = rw; h = ratio ? rw / ratio : nat.h; }
      else if (rh !== null) { h = rh; w = ratio ? rh * ratio : nat.w; }
    }
    const [px = '0%', py = '0%'] = (posV || '0% 0%').trim().split(/\s+/);
    const rp = (t: string, free: number) =>
      /%$/.test(t) ? (parseFloat(t) / 100) * free : /px$/.test(t) ? parseFloat(t) : NaN;
    const ox = rp(px, area.width - w);
    const oy = rp(py, area.height - h);
    if (Number.isNaN(ox) || Number.isNaN(oy)) return null;
    const rep = (repeatV || 'repeat').trim();
    const noRepeat = rep === 'no-repeat' || rep === 'no-repeat no-repeat';
    // a tile at least as large as the area never visibly repeats
    if (!noRepeat && !(w >= area.width - 0.5 && h >= area.height - 0.5)) return null;
    return { x: area.x + ox, y: area.y + oy, width: w, height: h };
  };

  // mask-image made only of gradient layers (linear/radial, %/px stops, alpha) → one or more alpha masks.
  // add (default) layers are unioned in one <mask>; intersect layers become nested masks (multiplied).
  // Unsupported: exclude/subtract composites, sized/positioned/clipped layers, url() mixed in.
  const parseMaskLayers = (el: Element, cs: CSSStyleDeclaration) => {
    const c: any = cs;
    const value = (c.maskImage as string) || '';
    if (!/gradient\(/.test(value)) return null;
    const allBorderBox = (v: string | undefined) => !v || splitTopLevel(v).every((q) => q.trim() === 'border-box');
    if (!allBorderBox(c.maskOrigin) || !allBorderBox(c.maskClip)) return null;
    const mode = c.maskMode;
    if (mode && !/^(match-source|alpha)(,\s*(match-source|alpha))*$/.test(mode)) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const box = { x: r.left, y: r.top, width: r.width, height: r.height };
    const layers = splitTopLevel(value);
    const sizes = splitTopLevel(c.maskSize || 'auto');
    const poss = splitTopLevel(c.maskPosition || '0% 0%');
    // standard keywords, plus the legacy -webkit-mask-composite spellings Chrome may report
    const compMap: Record<string, string> = { add: 'add', 'source-over': 'add', intersect: 'intersect', 'source-in': 'intersect' };
    const comps = splitTopLevel(c.maskComposite || 'add').map((q) => compMap[q.trim()] ?? 'unsupported');
    const gs: any[] = [];
    for (let k = 0; k < layers.length; k++) {
      if (layers[k].trim() === 'none') return null;
      const size = (sizes[k % sizes.length] || 'auto').trim();
      const pos = (poss[k % poss.length] || '0% 0%').trim();
      if (!['auto', 'auto auto', '100%', '100% 100%'].includes(size)) return null;
      if (!['0% 0%', '0%', '0px 0px', 'left top'].includes(pos)) return null;
      const g: any = parseGradientLayer(layers[k], box);
      if (!g) return null;
      // a mask only uses alpha: recolour every stop white, keep its alpha
      g.stops = g.stops.map((st: any) => {
        const col = rgbaOf(st.color);
        return { offset: st.offset, color: col ? `rgba(255, 255, 255, ${col[3]})` : 'rgba(255, 255, 255, 1)' };
      });
      gs.push(g);
    }
    const ops = comps.length ? comps : ['add'];
    const op = (k: number) => ops[k % ops.length];
    const all = (name: string) => gs.every((_, k) => k === gs.length - 1 || op(k) === name);
    if (gs.length === 1) return [{ rect: box, gradient: gs[0] }];
    if (all('add')) return [{ rect: box, gradients: gs }];
    if (all('intersect')) return gs.map((g) => ({ rect: box, gradient: g }));
    return null;
  };

  const parseElementMask = (el: Element, cs: CSSStyleDeclaration): any => {
    const value = ((cs as any).maskImage as string) || '';
    if (!value || value === 'none') return null;
    const gl = parseMaskLayers(el, cs);
    if (gl) return gl;
    const maskUrl = singleUrl(value);
    if (maskUrl) {
      const info = imgInfo.get(maskUrl);
      if (!info) return null;
      if ((cs as any).maskOrigin && (cs as any).maskOrigin !== 'border-box') return null;
      if ((cs as any).maskClip && (cs as any).maskClip !== 'border-box') return null;
      const mode = (cs as any).maskMode;
      if (mode && mode !== 'match-source' && mode !== 'alpha') return null;
      const br = el.getBoundingClientRect();
      if (br.width <= 0 || br.height <= 0) return null;
      const box = { x: br.left, y: br.top, width: br.width, height: br.height };
      const placed = placeImageLayer(
        info,
        (cs as any).maskSize,
        (cs as any).maskPosition,
        (cs as any).maskRepeat,
        box,
      );
      if (!placed) return null;
      return { rect: box, image: { href: info.href, ...placed } };
    }
    if (value.lastIndexOf('linear-gradient(') !== 0 || !/^linear-gradient\(/.test(value)) return null;
    const size = (cs as any).maskSize as string | undefined;
    const pos = (cs as any).maskPosition as string | undefined;
    const rep = (cs as any).maskRepeat as string | undefined;
    if (size && size !== 'auto' && size !== 'auto auto') return null;
    if (pos && pos !== '0% 0%' && pos !== '0%') return null;
    if (rep && rep !== 'repeat' && rep !== 'repeat repeat') return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const inner = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')'));
    const parts = splitTopLevel(inner).map((x) => x.trim());
    let angle = 180;
    let i = 0;
    if (/deg$/.test(parts[0])) {
      angle = parseFloat(parts[0]);
      i = 1;
    } else if (/^to\b/.test(parts[0])) {
      if (!(parts[0] in sideToAngle)) return null;
      angle = sideToAngle[parts[0]];
      i = 1;
    }
    const rad = (angle * Math.PI) / 180;
    const L = Math.abs(r.width * Math.sin(rad)) + Math.abs(r.height * Math.cos(rad));
    if (L <= 0) return null;
    const resolvePos = (t: string): number | null => {
      let m = t.match(/^(-?[\d.]+)%$/);
      if (m) return parseFloat(m[1]) / 100;
      m = t.match(/^(-?[\d.]+)px$/);
      if (m) return parseFloat(m[1]) / L;
      m = t.match(/^calc\(\s*(-?[\d.]+)%\s*([+-])\s*([\d.]+)px\s*\)$/);
      if (m) return parseFloat(m[1]) / 100 + (m[2] === '-' ? -1 : 1) * (parseFloat(m[3]) / L);
      return null;
    };
    const tokens = (s: string) => {
      const out: string[] = [];
      let depth = 0;
      let cur = '';
      for (const ch of s) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (/\s/.test(ch) && depth === 0) {
          if (cur) out.push(cur);
          cur = '';
        } else cur += ch;
      }
      if (cur) out.push(cur);
      return out;
    };
    const stops: { offset: number | null; alpha: number }[] = [];
    for (; i < parts.length; i++) {
      const tk = tokens(parts[i]);
      if (tk.length === 0) return null;
      const color = normColor(tk[0]);
      const am = color.match(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/);
      const alpha = am ? parseFloat(am[1]) : /^rgb\(/.test(color) ? 1 : NaN;
      if (Number.isNaN(alpha)) return null;
      if (tk.length === 1) stops.push({ offset: null, alpha });
      else
        for (const t of tk.slice(1)) {
          const off = resolvePos(t);
          if (off === null) return null;
          stops.push({ offset: off, alpha });
        }
    }
    if (stops.length < 2) return null;
    if (stops[0].offset == null) stops[0].offset = 0;
    if (stops[stops.length - 1].offset == null) stops[stops.length - 1].offset = 1;
    let last = 0;
    for (let k = 1; k < stops.length; k++) {
      if (stops[k].offset == null) continue;
      const gap = k - last;
      for (let j = 1; j < gap; j++)
        stops[last + j].offset =
          (stops[last].offset as number) + (((stops[k].offset as number) - (stops[last].offset as number)) * j) / gap;
      last = k;
    }
    let prev = 0;
    const finalStops = stops.map((st) => {
      const off = Math.max(prev, Math.max(0, Math.min(1, st.offset as number)));
      prev = off;
      return { offset: off, color: `rgba(255, 255, 255, ${st.alpha})` };
    });
    return {
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      gradient: { type: 'linear-gradient' as const, angle, stops: finalStops },
    };
  };

  // background-image:url() as an embedded <image>: single layer, positioned and
  // sized exactly. Anything else (multi-layer, tiling, odd origin/clip) stays raster.
  // General background engine: any mix of gradient and url()/image-set() layers with their own
  // background-size / -position / -repeat / -origin / -clip (CSS order top → bottom; returned bottom → top).
  // null when something can't be reproduced (fixed attachment, space/round, blend modes, unloaded image…).
  const splitTopLevelWs = (v: string): string[] => {
    const out: string[] = [];
    let depth = 0, cur = '';
    for (const ch of v) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  };
  const tileOf = (
    info: { w: number; h: number },
    sizeV: string, posV: string,
    area: { x: number; y: number; width: number; height: number },
  ) => {
    const ratio = info.w > 0 && info.h > 0 ? info.w / info.h : 0;
    let w = info.w > 0 ? info.w : area.width;
    let h = info.h > 0 ? info.h : area.height;
    const sv = (sizeV || 'auto').trim();
    if (sv === 'contain' || sv === 'cover') {
      const r = ratio || area.width / Math.max(1, area.height);
      const fitW = area.width / Math.max(1e-6, area.height) <= r;
      const useW = sv === 'contain' ? fitW : !fitW;
      if (useW) { w = area.width; h = w / r; } else { h = area.height; w = h * r; }
    } else {
      const [sw = 'auto', sh = 'auto'] = sv.split(/\s+/);
      const rs = (t: string, base: number) => (t === 'auto' ? null : /%$/.test(t) ? (parseFloat(t) / 100) * base : /px$/.test(t) ? parseFloat(t) : NaN);
      const rw = rs(sw, area.width), rh = rs(sh, area.height);
      if ((rw !== null && Number.isNaN(rw)) || (rh !== null && Number.isNaN(rh))) return null;
      if (rw !== null && rh !== null) { w = rw; h = rh; }
      else if (rw !== null) { w = rw; h = ratio ? rw / ratio : h; }
      else if (rh !== null) { h = rh; w = ratio ? rh * ratio : w; }
    }
    if (!(w > 0) || !(h > 0)) return null;
    const [px = '0%', py = '0%'] = (posV || '0% 0%').trim().split(/\s+/);
    const rp = (t: string, free: number) => {
      const cm = t.match(/^calc\(\s*(-?[\d.]+)%\s*([+-])\s*([\d.]+)px\s*\)$/); // `right 10px` → calc(100% - 10px)
      if (cm) return (parseFloat(cm[1]) / 100) * free + (cm[2] === '-' ? -1 : 1) * parseFloat(cm[3]);
      return /%$/.test(t) ? (parseFloat(t) / 100) * free : /px$/.test(t) ? parseFloat(t) : t === 'left' || t === 'top' ? 0 : t === 'center' ? free / 2 : t === 'right' || t === 'bottom' ? free : NaN;
    };
    // positions may contain spaces inside calc(): re-split on top-level whitespace
    const ptoks = splitTopLevelWs((posV || '0% 0%').trim());
    const [px2 = '0%', py2 = '0%'] = ptoks;
    const ox = rp(px2, area.width - w), oy = rp(py2, area.height - h);
    if (Number.isNaN(ox) || Number.isNaN(oy)) return null;
    return { x: area.x + ox, y: area.y + oy, width: w, height: h };
  };

  const parseBackgroundLayers = (el: Element, cs: CSSStyleDeclaration) => {
    const value = cs.backgroundImage;
    if (!value || value === 'none') return null;
    if (cs.backgroundClip === 'text' || (cs as any).webkitBackgroundClip === 'text') return null;
    if (cs.backgroundBlendMode && cs.backgroundBlendMode.split(',').some((m) => m.trim() !== 'normal')) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const bl = num(cs.borderLeftWidth), bt = num(cs.borderTopWidth), br = num(cs.borderRightWidth), bb = num(cs.borderBottomWidth);
    const pl = num(cs.paddingLeft), pt = num(cs.paddingTop), pr = num(cs.paddingRight), pb = num(cs.paddingBottom);
    const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {
      'border-box': { x: r.left, y: r.top, width: r.width, height: r.height },
      'padding-box': { x: r.left + bl, y: r.top + bt, width: r.width - bl - br, height: r.height - bt - bb },
      'content-box': { x: r.left + bl + pl, y: r.top + bt + pt, width: r.width - bl - br - pl - pr, height: r.height - bt - bb - pt - pb },
    };
    const inset: Record<string, number> = { 'border-box': 0, 'padding-box': Math.max(bl, br, bt, bb), 'content-box': Math.max(bl + pl, br + pr, bt + pt, bb + pb) };
    const baseRadii = radiiOf(cs, r.width, r.height);
    const layers = splitTopLevel(value);
    const L = (v: string | undefined, d: string) => splitTopLevel(v || d).map((q) => q.trim());
    const sizes = L(cs.backgroundSize, 'auto'), poss = L(cs.backgroundPosition, '0% 0%'), reps = L(cs.backgroundRepeat, 'repeat');
    const orgs = L(cs.backgroundOrigin, 'padding-box'), clips = L(cs.backgroundClip, 'border-box'), atts = L(cs.backgroundAttachment, 'scroll');
    const out: BgLayer[] = [];
    for (let k = 0; k < layers.length; k++) {
      const lay = layers[k].trim();
      if (lay === 'none') continue;
      // fixed: positioned against the viewport (scroll is 0 during capture ⇒ viewport px == page px)
      const fixedAtt = atts[k % atts.length] === 'fixed';
      const area = fixedAtt ? { x: 0, y: 0, width: document.documentElement.clientWidth, height: window.innerHeight } : boxes[orgs[k % orgs.length]];
      const clipName = clips[k % clips.length];
      const clipBox = boxes[clipName];
      if (!area || !clipBox || area.width <= 0 || area.height <= 0) return null;
      const rt = reps[k % reps.length].split(/\s+/);
      const rmap = (t: string): [boolean, boolean] | null => (t === 'repeat' ? [true, true] : t === 'no-repeat' ? [false, false] : t === 'repeat-x' ? [true, false] : t === 'repeat-y' ? [false, true] : null);
      let rx: boolean, ry: boolean;
      if (rt.length === 2) { if (rt.includes('space') || rt.includes('round')) return null; rx = rt[0] === 'repeat'; ry = rt[1] === 'repeat'; }
      else { const m = rmap(rt[0]); if (!m) return null; [rx, ry] = m; }
      const url = layerUrl(lay);
      const info = url ? imgInfo.get(url) : { w: 0, h: 0 };
      if (!info) return null;
      const tile = tileOf(info, sizes[k % sizes.length], poss[k % poss.length], area);
      if (!tile) return null;
      const ins = inset[clipName] ?? 0;
      const clipRadii = baseRadii.map((v) => Math.max(0, v - ins)) as CornerRadii;
      if (url) out.push({ tile, repeatX: rx, repeatY: ry, clip: clipBox, clipRadii, href: (info as any).href });
      else {
        const g = parseGradientLayer(lay, { x: 0, y: 0, width: tile.width, height: tile.height });
        if (!g) return null;
        out.push({ tile, repeatX: rx, repeatY: ry, clip: clipBox, clipRadii, gradient: g as any });
      }
    }
    return out.length ? out.reverse() : null;
  };

  const bgImageLayer = (el: Element, cs: CSSStyleDeclaration) => {
    const url = singleUrl(cs.backgroundImage);
    const info = url ? imgInfo.get(url) : null;
    if (!info) return null;
    const textClipped = cs.backgroundClip === 'text' || cs.backgroundClip === '-webkit-text';
    if (textClipped) return null;
    if (cs.backgroundClip !== 'border-box' && cs.backgroundClip !== 'padding-box') return null;
    if (cs.backgroundOrigin !== 'padding-box' && cs.backgroundOrigin !== 'border-box') return null;
    if (cs.backgroundAttachment && cs.backgroundAttachment !== 'scroll') return null;
    const r = el.getBoundingClientRect();
    const bl = num(cs.borderLeftWidth), bt = num(cs.borderTopWidth);
    const br = num(cs.borderRightWidth), bb = num(cs.borderBottomWidth);
    const pad = { x: r.left + bl, y: r.top + bt, width: r.width - bl - br, height: r.height - bt - bb };
    const border = { x: r.left, y: r.top, width: r.width, height: r.height };
    const area = cs.backgroundOrigin === 'border-box' ? border : pad;
    if (area.width <= 0 || area.height <= 0) return null;
    const placed = placeImageLayer(info, cs.backgroundSize, cs.backgroundPosition, cs.backgroundRepeat, area);
    if (!placed) return null;
    const clipBox = cs.backgroundClip === 'padding-box' ? pad : border;
    return { href: info.href, rect: placed, clipBox, radii: radiiOf(cs, border.width, border.height) };
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

  const blobToDataURL = (blob: Blob): Promise<string | null> =>
    new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });

  const fetchDataURL = async (url: string): Promise<string | null> => {
    // Guard against fetching the current page when img.src is empty or blank.
    if (!url || url === 'about:blank') return null;
    if (url.startsWith('data:')) return url;
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) return null;
      return await blobToDataURL(await res.blob());
    } catch {
      return null;
    }
  };

  // Try to extract image pixels via canvas (works for decoded same-origin images
  // and CORS-enabled cross-origin images without a network round-trip).
  // Data URL of a canvas bitmap, or null when it cannot be read (tainted) or looks blank — a WebGL canvas
  // without preserveDrawingBuffer reads back transparent, which must NOT replace the real pixels.
  const canvasDataUrl = (cv: HTMLCanvasElement): string | null => {
    if (cv.width === 0 || cv.height === 0) return null;
    try {
      const probe = document.createElement('canvas');
      const pw = Math.min(64, cv.width), ph = Math.min(64, cv.height);
      probe.width = pw; probe.height = ph;
      const pc = probe.getContext('2d');
      if (!pc) return null;
      pc.drawImage(cv, 0, 0, pw, ph);
      const d = pc.getImageData(0, 0, pw, ph).data;
      let any = false;
      for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) { any = true; break; }
      if (!any) return null;
      return cv.toDataURL('image/png');
    } catch {
      return null;
    }
  };

  const canvasExtractDataURL = (img: HTMLImageElement): string | null => {
    if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) return null;
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      return c.toDataURL('image/png');
    } catch {
      return null; // cross-origin without CORS headers: canvas is tainted
    }
  };

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
    const detail = el && reason === 'background-image' ? ' ' + getComputedStyle(el).backgroundImage.slice(0, 90) : el && reason === 'clip-path' ? ' ' + getComputedStyle(el).clipPath.slice(0, 60) : el && reason === 'mask' ? (() => { const c: any = getComputedStyle(el); return ' ' + String(c.maskImage || c.webkitMaskImage).slice(0, 80) + ' | ' + (c.maskSize || '') + ' | ' + (c.maskComposite || ''); })() : '';
    nodes.push({ kind: 'raster', id, rect: r, opacity, clip, reason, desc: desc && (desc.slice(0, 50) + detail) } as PaintNode);
    rasterTargets.push({ id, ...r });
    // in-page backends can re-render this element themselves when no screenshot is available
    if (el) opts.rasterElements?.set(id, el);
  };

  // `inset` layers (sharp or blurred); null never — kept nullable for callers.
  const parseInsetShadows = (value: string) => {
    if (!value || value === 'none') return [];
    const out: { offsetX: number; offsetY: number; spread: number; color: string; blur?: number }[] = [];
    const COLOR_FN = /((?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^)]+\)|#[0-9a-fA-F]+|[a-z]+)/;
    for (const part of splitTopLevel(value)) {
      if (!part.includes('inset')) continue;
      const body = part.replace(/\binset\b/, '');
      const colorMatch = body.match(COLOR_FN);
      const color = normColor(colorMatch ? colorMatch[0] : 'rgba(0,0,0,0.2)');
      const v = (body.replace(COLOR_FN, '').match(/-?\d*\.?\d+px/g) || []).map((x) => parseFloat(x));
      if (!transparent(color)) out.push({ offsetX: v[0] || 0, offsetY: v[1] || 0, spread: v[3] || 0, color, blur: v[2] || undefined });
    }
    return out;
  };

  const parseShadows = (value: string) => {
    if (!value || value === 'none') return [];
    // Only emit outset layers; inset layers are handled as raster by needsBoxRaster.
    // Filter before parsing so a mix of outset + inset keeps the outset shadows.
    const parts = splitTopLevel(value).filter((p) => !p.includes('inset'));
    if (parts.length === 0) return [];
    const out: { offsetX: number; offsetY: number; blur: number; spread: number; color: string }[] = [];
    const COLOR_FN = /((?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^)]+\)|#[0-9a-fA-F]+|[a-z]+)/;
    for (const part of parts) {
      const colorMatch = part.match(COLOR_FN);
      const color = normColor(colorMatch ? colorMatch[0] : 'rgba(0,0,0,0.2)');
      const nums = part.replace(COLOR_FN, '').match(/-?\d*\.?\d+px/g) || [];
      const v = nums.map((s) => parseFloat(s));
      out.push({ offsetX: v[0] || 0, offsetY: v[1] || 0, blur: v[2] || 0, spread: v[3] || 0, color });
    }
    return out;
  };

  // Synthesize a text node for the CSS ::marker pseudo-element on list items.
  // Markers are pseudo-elements not in the DOM — getComputedStyle(el,'::marker')
  // exposes their computed content and color in Chrome 86+/FF 68+/Safari 13.1+.
  const captureListMarker = (el: Element, cs: CSSStyleDeclaration, clip: Clip | null, opacity: number) => {
    if (cs.display !== 'list-item') return;
    const ms = getComputedStyle(el, '::marker');
    let markerText = ms.content || '';
    if (!markerText || markerText === 'none' || markerText === 'normal') {
      // Fallback: infer from list-style-type
      const lstyle = cs.listStyleType || getComputedStyle(el.parentElement || el).listStyleType || '';
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
      const rng = document.createRange();
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
      const cr = document.createRange();
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
    if (!ow || !oh || !(el instanceof HTMLElement)) return 1;
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
    const ps = isPh ? getComputedStyle(el, '::placeholder') : cs;
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
    const textW = mctx.measureText(raw).width + ls * raw.length;
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
      lines: [{ text: raw, x, baseline }],
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

  const captureText = (el: Element, cs: CSSStyleDeclaration, clip: Clip | null, opacity: number) => {
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
      const range = document.createRange();
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
            const cr = document.createRange();
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
          const style = candidate === el ? cs : getComputedStyle(candidate);
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
    const canvasBg = !subtree && el === document.body && transparent(getComputedStyle(document.documentElement).backgroundColor);
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
    const ps = getComputedStyle(el, sel);
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
    const cbW = fixedPos ? document.documentElement.clientWidth : r.width - num(csEl.borderLeftWidth) - num(csEl.borderRightWidth);
    const cbH = fixedPos ? window.innerHeight : r.height - num(csEl.borderTopWidth) - num(csEl.borderBottomWidth);
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
    const ps = getComputedStyle(el, sel);
    // content: "text" | "" (decorative box: carets, dots, bars, clearfix) | attr(name)
    const m = ps.content.match(/^(["'])([\s\S]*)\1$/);
    const am = ps.content.match(/^attr\(\s*([\w-]+)\s*\)$/);
    if (!m && !am) return null; // url()/counter()/quotes: not plain text
    // url() backgrounds need an async image fetch (not available here); gradients, borders, shadows are fine
    if ((ps.backgroundImage || '').includes('url(')) return null;
    const text = am
      ? el.getAttribute(am[1]) || ''
      : m![2]
          .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
          .replace(/\\([\s\S])/g, '$1');
    if (!text && ps.display === 'inline') return null; // empty inline pseudo paints nothing
    const span = document.createElement('span');
    for (let i = 0; i < ps.length; i++) span.style.setProperty(ps[i], ps.getPropertyValue(ps[i]));
    span.style.setProperty('animation', 'none');
    span.style.setProperty('transition', 'none');
    span.textContent = text;
    const host = el as HTMLElement;
    const attr = 'data-fith-pseudo-host';
    const style = document.createElement('style');
    style.textContent = `[${attr}]${sel}{content:none !important}`;
    document.head.appendChild(style);
    host.setAttribute(attr, '');
    if (sel === '::before') host.insertBefore(span, host.firstChild);
    else host.appendChild(span);
    const start = nodes.length;
    try {
      const scs = getComputedStyle(span);
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
      const scs = getComputedStyle(src[i]);
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
    const wcs = getComputedStyle(el);
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
    const gcs = getComputedStyle(el);
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
    const cs0 = getComputedStyle(el);
    const tf = cs0.transform;
    if (!tf || tf === 'none' || noVectorTransform.has(el) || cs0.display === 'none' || cs0.display === 'contents' || rootAncestors.has(el))
      return withGroup(el, clip, inheritedOpacity, () => walkInner(el, clip, inheritedOpacity));
    const m = parseMatrix(tf);
    const rotated = !!m && !/matrix3d/.test(tf) && (Math.abs(m.b) > 1e-3 || Math.abs(m.c) > 1e-3);
    const has3D = /matrix3d/.test(tf) && (() => {
      const p = tf.match(/matrix3d\(([^)]+)\)/)![1].split(',').map((x) => parseFloat(x));
      return Math.abs(p[2]) > 1e-3 || Math.abs(p[6]) > 1e-3 || Math.abs(p[8]) > 1e-3 || Math.abs(p[9]) > 1e-3 || Math.abs(p[14]) > 1e-3;
    })();
    const hasRotateProps = [cs0.getPropertyValue('rotate'), cs0.getPropertyValue('scale'), cs0.getPropertyValue('translate')].some((v) => v && v !== 'none');
    const m3 = /matrix3d/.test(tf) ? parseMatrix(tf) : null;
    const mm = m3 && !has3D ? m3 : m;
    const rot = !!mm && !has3D && (Math.abs(mm.b) > 1e-3 || Math.abs(mm.c) > 1e-3);
    if (!rot || has3D || hasRotateProps || !(el instanceof HTMLElement || el instanceof SVGElement)) return withGroup(el, clip, inheritedOpacity, () => walkInner(el, clip, inheritedOpacity));
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
    if (el === document.documentElement || el === rootEl) return true;
    if (cs.position === 'fixed' || cs.position === 'sticky') return true;
    if (cs.zIndex !== 'auto') {
      if (cs.position !== 'static') return true;
      const pd = el.parentElement ? getComputedStyle(el.parentElement).display : '';
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
    const cs = getComputedStyle(el);
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

    const kids = Array.from(el.children);
    const parentIsFlexGrid = /flex|grid/.test(cs.display);
    const meta = kids.map((k) => {
      const kcs = getComputedStyle(k);
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

  const body = document.body;
  let background: string;
  if (subtree) {
    // a subtree export is just the element: use its own opaque bg, else transparent
    const ebg = getComputedStyle(rootEl).backgroundColor;
    background = transparent(ebg) ? '' : normColor(ebg);
  } else {
    background = !transparent(getComputedStyle(document.documentElement).backgroundColor)
      ? normColor(getComputedStyle(document.documentElement).backgroundColor)
      : body && !transparent(getComputedStyle(body).backgroundColor)
        ? normColor(getComputedStyle(body).backgroundColor)
        : '#ffffff';
  }

  // Reset all scroll positions so scrolled-out content is at its natural position
  // during capture. getBoundingClientRect() forces a synchronous layout flush, so
  // positions are correct even though the reset is synchronous.
  // Also override content-visibility:auto/hidden — browsers skip layout for
  // off-screen content-visibility:auto elements, leaving their children with zero
  // bounding rects that would be culled as invisible (GitHub issue feeds, etc.).
  // Both states are restored after capture.
  const scrollSaved: { el: HTMLElement; top: number; left: number }[] = [];
  const cvSaved: { el: HTMLElement; v: string }[] = [];
  if ((opts as any).captureScrollableContent) {
    // For full-page capture, reset the outer document scroll so all content is
    // at its natural (unfurled) position for getBoundingClientRect() and for
    // captureVisibleTab screenshots. For element (subtree) capture, we must NOT
    // reset the page scroll — the user just picked an element that is visible in
    // the current viewport, and resetting scroll would push it off-screen, making
    // captureVisibleTab unable to reach raster regions inside it.
    if (!subtree) {
      const docEl = document.documentElement as HTMLElement;
      const bodyEl = document.body as HTMLElement | null;
      for (const el of [docEl, bodyEl]) {
        if (!el) continue;
        if (el.scrollTop || el.scrollLeft) {
          scrollSaved.push({ el, top: el.scrollTop, left: el.scrollLeft });
          el.scrollTop = 0;
          el.scrollLeft = 0;
        }
      }
    }
    // Reset scroll on elements inside the capture root (full-page: all; subtree:
    // only descendants of rootEl). Also force content-visibility so off-screen
    // content inside the root gets layout and isn't culled as zero-rect.
    const scrollScope = subtree
      ? Array.from(rootEl.querySelectorAll('*'))
      : Array.from(document.querySelectorAll('*'));
    for (const el of scrollScope) {
      const h = el as HTMLElement;
      if (h.scrollTop || h.scrollLeft) {
        scrollSaved.push({ el: h, top: h.scrollTop, left: h.scrollLeft });
        h.scrollTop = 0;
        h.scrollLeft = 0;
      }
      const cv = (getComputedStyle(h) as any).contentVisibility;
      if (cv === 'auto' || cv === 'hidden') {
        cvSaved.push({ el: h, v: h.style.contentVisibility });
        h.style.contentVisibility = 'visible';
      }
    }
  }

  // In subtree mode, walk from document root so siblings and cousins that
  // visually overlap the selected element's bounding area are captured with
  // correct paint order. rootAncestors guards suppress their own rendering.
  await walk(subtree ? (document.documentElement as Element) : rootEl, null, 1);
  await Promise.all(imgTasks);

  for (const { el, v } of cvSaved) el.style.contentVisibility = v;
  for (const { el, top, left } of scrollSaved) {
    el.scrollTop = top;
    el.scrollLeft = left;
  }

  const fonts = (opts.fontMode ?? 'embed') === 'embed' ? await collectFonts(nodes) : [];

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

  async function collectFonts(painted: PaintNode[]) {
    // families actually referenced by text nodes
    const used = new Set<string>();
    for (const node of painted) {
      if (node.kind !== 'text') continue;
      for (const fam of node.fontFamily.split(',')) {
        used.add(fam.trim().replace(/^["']|["']$/g, '').toLowerCase());
      }
    }

    const fmtFromUrl = (url: string, hint?: string) => {
      const h = (hint || '').toLowerCase();
      if (h.includes('woff2')) return 'woff2';
      if (h.includes('woff')) return 'woff';
      if (h.includes('truetype')) return 'truetype';
      if (h.includes('opentype')) return 'opentype';
      if (/\.woff2(\?|$)/i.test(url)) return 'woff2';
      if (/\.woff(\?|$)/i.test(url)) return 'woff';
      if (/\.otf(\?|$)/i.test(url)) return 'opentype';
      return 'truetype';
    };

    const out: { family: string; weight: string; style: string; src: string; format: string; unicodeRange?: string }[] = [];
    const seen = new Set<string>();
    const urlCache = new Map<string, string | null>();

    // Collect @font-face rules, descending into @media/@supports/@layer groups, with the
    // URL base of the owning stylesheet (url() in a sheet resolve against the sheet, not the page).
    const faces: { rule: CSSFontFaceRule; base: string }[] = [];
    // Cross-origin sheets (Google Fonts via <link>/@import without crossorigin) throw on
    // .cssRules; their text is still fetchable when the host sends CORS headers.
    const opaque: string[] = [];
    const walk = (rules: CSSRuleList, base: string, depth: number) => {
      for (const rule of Array.from(rules)) {
        if (rule.constructor.name === 'CSSFontFaceRule' || (rule as any).type === 5) {
          faces.push({ rule: rule as CSSFontFaceRule, base });
        } else if ((rule as any).type === 3 && (rule as any).styleSheet && depth < 6) {
          // @import: the imported sheet's url()s resolve against its own href
          const sub = (rule as any).styleSheet as CSSStyleSheet;
          try { walk(sub.cssRules, sub.href || base, depth + 1); } catch { if (sub.href) opaque.push(sub.href); }
        } else if (depth < 6 && (rule as any).cssRules) {
          try { walk((rule as any).cssRules as CSSRuleList, base, depth + 1); } catch { /* ignore */ }
        }
      }
    };
    const sheets: CSSStyleSheet[] = Array.from(document.styleSheets) as CSSStyleSheet[];
    try { for (const s of (document as any).adoptedStyleSheets || []) sheets.push(s); } catch { /* ignore */ }
    for (const sheet of sheets) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
        if (!rules) continue;
      } catch {
        if (sheet.href) opaque.push(sheet.href);
        continue; // cross-origin sheet
      }
      walk(rules, sheet.href || document.baseURI, 0);
    }
    for (const href of Array.from(new Set(opaque)).slice(0, 12)) {
      try {
        let text = (opts as any).externalCss?.[href] as string | undefined;
        if (text === undefined) {
          const res = await fetch(href, { cache: 'force-cache' });
          if (!res.ok) continue;
          text = await res.text();
        }
        const parsed = new CSSStyleSheet();
        parsed.replaceSync(text.replace(/@import[^;]*;/g, ''));
        walk(parsed.cssRules, href, 0);
      } catch { /* CORS-blocked or unparsable: fonts stay referenced by name */ }
    }

    for (const { rule, base } of faces) {
      const style = rule.style;
      const family = style.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, '');
      if (!family || !used.has(family.toLowerCase())) continue;
      const weight = style.getPropertyValue('font-weight') || '400';
      const fstyle = style.getPropertyValue('font-style') || 'normal';
      const src = style.getPropertyValue('src');
      if (!src) continue;
      const unicodeRange = style.getPropertyValue('unicode-range').trim() || undefined;

      // pick first url() src (prefer woff2)
      const entries = Array.from(src.matchAll(/url\(([^)]+)\)(?:\s*format\(([^)]+)\))?/g)).map((m) => ({
        url: m[1].trim().replace(/^["']|["']$/g, ''),
        hint: (m[2] || '').replace(/["']/g, ''),
      }));
      if (entries.length === 0) continue;
      const pick = entries.find((e) => /woff2/i.test(e.hint) || /\.woff2/i.test(e.url)) || entries[0];
      let abs: string;
      try { abs = new URL(pick.url, base).href; } catch { continue; }
      const key = family + '|' + weight + '|' + fstyle + '|' + (unicodeRange || '') + '|' + abs;
      if (seen.has(key)) continue;
      seen.add(key);
      let dataUrl: string | null;
      if (urlCache.has(abs)) dataUrl = urlCache.get(abs)!;
      else { dataUrl = await fetchDataURL(abs); urlCache.set(abs, dataUrl); }
      if (!dataUrl) continue;
      out.push({ family, weight, style: fstyle, src: dataUrl, format: fmtFromUrl(pick.url, pick.hint), unicodeRange });
    }
    return out;
  }
  } finally {
    unfurlRestore();
  }
}
