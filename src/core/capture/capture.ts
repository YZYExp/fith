import type { Scene, PaintNode, Clip, CornerRadii, CaptureOptions } from '../ir/types.js';

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
    !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)' || /,\s*0\)\s*$/.test(c);

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

  const radiiOf = (cs: CSSStyleDeclaration): CornerRadii => [
    num(cs.borderTopLeftRadius),
    num(cs.borderTopRightRadius),
    num(cs.borderBottomRightRadius),
    num(cs.borderBottomLeftRadius),
  ];

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
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    if (r.bottom < cullTop || r.right < cullLeft || r.top > cullBottom || r.left > cullRight)
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
  const needsSubtreeRaster = (el: Element, cs: CSSStyleDeclaration) => {
    const tag = el.tagName.toUpperCase();
    if (['CANVAS', 'VIDEO', 'IFRAME', 'OBJECT', 'EMBED'].includes(tag)) return 'media:' + tag;
    if (['INPUT', 'SELECT', 'TEXTAREA', 'PROGRESS', 'METER'].includes(tag)) return 'form-control';
    if (cs.filter && cs.filter !== 'none') return 'filter';
    if ((cs as any).backdropFilter && (cs as any).backdropFilter !== 'none') return 'backdrop-filter';
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') return 'blend-mode';
    if (
      (cs as any).maskImage &&
      (cs as any).maskImage !== 'none' &&
      (cs as any).maskImage !== undefined &&
      !parseElementMask(el, cs)
    )
      return 'mask';
    if (cs.clipPath && cs.clipPath !== 'none') return 'clip-path';
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
  const prepareImageLayers = async (cs: CSSStyleDeclaration) => {
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

  const parseElementMask = (el: Element, cs: CSSStyleDeclaration) => {
    const value = ((cs as any).maskImage as string) || '';
    if (!value || value === 'none') return null;
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
    return { href: info.href, rect: placed, clipBox, radii: radiiOf(cs) };
  };

  // Box-level effects we can't vectorize. Safe to raster only on a LEAF element
  // (no element children), where rastering the box loses nothing. On containers
  // we skip these (keep descending, vectorize the content) rather than nuke the
  // subtree.
  const needsBoxRaster = (el: Element, cs: CSSStyleDeclaration) => {
    if (
      cs.backgroundImage &&
      cs.backgroundImage !== 'none' &&
      !parseFirstLinearGradient(cs.backgroundImage) &&
      !bgImageLayer(el, cs)
    )
      return 'background-image';
    if (cs.boxShadow && cs.boxShadow.includes('inset')) return 'inset-shadow';
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
    const r = clampToCapture(rect);
    if (!r) return;
    const id = nid();
    nodes.push({ kind: 'raster', id, rect: r, opacity, clip, reason });
    rasterTargets.push({ id, ...r });
    // in-page backends can re-render this element themselves when no screenshot is available
    if (el) opts.rasterElements?.set(id, el);
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

  const captureText = (el: Element, cs: CSSStyleDeclaration, clip: Clip | null, opacity: number) => {
    const fontSize = num(cs.fontSize);
    if (fontSize <= 0) return;
    mctx.font = `${cs.fontStyle} ${cs.fontWeight} ${fontSize}px ${cs.fontFamily}`;
    const fm = mctx.measureText('Mg');
    const ascent = (fm as any).fontBoundingBoxAscent || fontSize * 0.8;
    const descent = (fm as any).fontBoundingBoxDescent || fontSize * 0.2;
    const ls = cs.letterSpacing === 'normal' ? 0 : num(cs.letterSpacing);
    const ws = cs.wordSpacing === 'normal' ? 0 : num(cs.wordSpacing);
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
        let text = xform(raw.replace(/\s+/g, ' ').trim());
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
        lines.push({ text, x: r.left, baseline });
      } else {
        // multi-line: bucket characters to lines via per-char ranges
        for (const b of bucketCharsByLine(child, raw)) {
          const text = xform(b.chars.join('').replace(/\s+/g, ' ').trim());
          if (!text) continue;
          const left = b.xs.reduce((m, v) => Math.min(m, v), Infinity);
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
    const fill = textClipped || transparent(cs.backgroundColor) ? null : normColor(cs.backgroundColor);
    const { border } = buildBorder(cs);
    const shadows = parseShadows(cs.boxShadow);
    const gradient =
      !textClipped && cs.backgroundImage && cs.backgroundImage !== 'none' ? parseFirstLinearGradient(cs.backgroundImage) : null;
    const outlineW = num(cs.outlineWidth);
    const outlineStyle = cs.outlineStyle;
    const outline =
      outlineW > 0 && outlineStyle !== 'none' && !transparent(cs.outlineColor)
        ? { width: outlineW, color: normColor(cs.outlineColor), style: outlineStyle, offset: num(cs.outlineOffset) }
        : null;
    const bgImg = textClipped ? null : bgImageLayer(el, cs);
    if (!fill && !gradient && !border && shadows.length === 0 && !outline && !bgImg) return;
    if (fill || gradient || border || shadows.length > 0 || outline)
    nodes.push({
      kind: 'box',
      id: nid(),
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      opacity,
      clip,
      fill,
      gradient,
      radii: radiiOf(cs),
      border,
      shadows,
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
    if (ps.position !== 'absolute') return { handled: false };
    if (csEl.position === 'static') return { handled: false }; // host isn't the containing block
    for (const s of ['top', 'right', 'bottom', 'left'] as const) {
      const v = ps.getPropertyValue(s);
      if (!v || v === 'auto') return { handled: false }; // width-based positioning → skip
    }
    const r = el.getBoundingClientRect();
    // Containing block for an absolute pseudo whose host is positioned = host padding box.
    const cbX = r.left + num(csEl.borderLeftWidth);
    const cbY = r.top + num(csEl.borderTopWidth);
    const cbW = r.width - num(csEl.borderLeftWidth) - num(csEl.borderRightWidth);
    const cbH = r.height - num(csEl.borderTopWidth) - num(csEl.borderBottomWidth);
    const x = cbX + num(ps.left) + num(ps.marginLeft);
    const y = cbY + num(ps.top) + num(ps.marginTop);
    const width = cbX + cbW - num(ps.right) - num(ps.marginRight) - x;
    const height = cbY + cbH - num(ps.bottom) - num(ps.marginBottom) - y;
    if (width <= 0 || height <= 0) return { handled: true }; // collapsed → nothing visible

    const gradient =
      ps.backgroundImage && ps.backgroundImage !== 'none' ? parseFirstLinearGradient(ps.backgroundImage) : null;
    if (ps.backgroundImage && ps.backgroundImage !== 'none' && !gradient) return { handled: false }; // url()/radial/conic
    if (ps.boxShadow && ps.boxShadow.includes('inset')) return { handled: false };
    const { hasBorder, border } = buildBorder(ps);
    if (hasBorder) {
      for (const st of [ps.borderTopStyle, ps.borderRightStyle, ps.borderBottomStyle, ps.borderLeftStyle])
        if (st === 'double' || st === 'groove' || st === 'ridge' || st === 'inset' || st === 'outset')
          return { handled: false };
    }
    const fill = transparent(ps.backgroundColor) ? null : normColor(ps.backgroundColor);
    const shadows = parseShadows(ps.boxShadow);
    if (!fill && !gradient && !border && shadows.length === 0) return { handled: true }; // nothing to draw

    // Clip the pseudo to the host's rounded content box when the host clips overflow,
    // so an inset overlay follows the card's rounded corners.
    const pseudoClip = clipsContent(csEl)
      ? intersect(clip, { x: r.left, y: r.top, width: r.width, height: r.height, radii: radiiOf(csEl) })
      : clip;
    return {
      handled: true,
      node: {
        kind: 'box',
        id: nid(),
        rect: { x, y, width, height },
        opacity: opacity * num(ps.opacity),
        clip: pseudoClip,
        fill,
        gradient,
        radii: radiiOf(ps),
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
    const m = ps.content.match(/^(["'])([\s\S]*)\1$/);
    if (!m) return null; // url()/counter()/attr()/quotes: not plain text
    if ((ps.backgroundImage && ps.backgroundImage !== 'none') || (ps.boxShadow || '').includes('inset')) return null;
    const text = m[2]
      .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/\\([\s\S])/g, '$1');
    if (!text) return null;
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
    const node: any = {
      kind: 'image',
      id,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      opacity,
      clip,
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
          Object.assign(node, { kind: 'raster', rect: clamped, reason: 'img-cors' });
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
  const walk = async (el: Element, clip: Clip | null, inheritedOpacity: number) => {
    const wcs = getComputedStyle(el);
    if ((wcs as any).maskImage && (wcs as any).maskImage !== 'none') await prepareImageLayers(wcs);
    const mk =
      wcs.display !== 'none' && wcs.display !== 'contents' && !rootAncestors.has(el)
        ? parseElementMask(el, wcs)
        : null;
    if (!mk) return walkNode(el, clip, inheritedOpacity);
    const start = nodes.length;
    await walkNode(el, clip, inheritedOpacity);
    for (let i = start; i < nodes.length; i++) {
      const nd = nodes[i];
      if (nd.kind === 'raster') continue;
      (nd.masks ||= []).push(mk);
    }
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
        captureText(el, cs, clip, opacity);
        captureListMarker(el, cs, clip, opacity);
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
        captureText(el, cs, clip, opacity);
        captureListMarker(el, cs, clip, opacity);
      }
    } else if (!boxReason && !skipRender && !visHidden) {
      emitBox(el, cs, clip, opacity);
      captureText(el, cs, clip, opacity);
      captureListMarker(el, cs, clip, opacity);
    }

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
      const shouldExpand = captureScrollable && (isScrollContainer || isHiddenWithOverflow);
      const clipW = shouldExpand ? Math.max(r.width, htmlEl.scrollWidth || 0) : r.width;
      const clipH = shouldExpand ? Math.max(r.height, htmlEl.scrollHeight || 0) : r.height;
      childClip = intersect(clip, {
        x: r.left,
        y: r.top,
        width: clipW,
        height: clipH,
        radii: radiiOf(cs),
      });
    }

    const kids = Array.from(el.children);
    const meta = kids.map((k) => {
      const kcs = getComputedStyle(k);
      const positioned = kcs.position !== 'static';
      const zRaw = kcs.zIndex;
      const z = zRaw === 'auto' ? 0 : parseInt(zRaw, 10) || 0;
      return { k, positioned, z };
    });
    // CSS paint order within a stacking context:
    //   1. negative z-index positioned descendants (lowest first)
    //   2. block/inline flow (non-positioned) in DOM order
    //   3. positioned with z-index:auto or z-index:0 in DOM order (above flow)
    //   4. positive z-index positioned (lowest first)
    const neg   = meta.filter((x) => x.positioned && x.z < 0).sort((a, b) => a.z - b.z);
    const flow  = meta.filter((x) => !x.positioned);
    const autoZ = meta.filter((x) => x.positioned && x.z === 0);
    const pos   = meta.filter((x) => x.positioned && x.z > 0).sort((a, b) => a.z - b.z);

    for (const m of neg)   await walk(m.k, childClip, opacity);
    for (const m of flow)  await walk(m.k, childClip, opacity);
    for (const m of autoZ) await walk(m.k, childClip, opacity);
    for (const m of pos)   await walk(m.k, childClip, opacity);

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

    const out: { family: string; weight: string; style: string; src: string; format: string }[] = [];
    const seen = new Set<string>();

    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = (sheet as CSSStyleSheet).cssRules;
        if (!rules) continue;
      } catch {
        continue; // cross-origin sheet
      }
      for (const rule of Array.from(rules)) {
        if (rule.constructor.name !== 'CSSFontFaceRule' && (rule as any).type !== 5) continue;
        const style = (rule as CSSFontFaceRule).style;
        const family = style.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, '');
        if (!family || !used.has(family.toLowerCase())) continue;
        const weight = style.getPropertyValue('font-weight') || '400';
        const fstyle = style.getPropertyValue('font-style') || 'normal';
        const src = style.getPropertyValue('src');
        if (!src) continue;
        const key = family + '|' + weight + '|' + fstyle;
        if (seen.has(key)) continue;

        // pick first url() src (prefer woff2)
        const entries = Array.from(src.matchAll(/url\(([^)]+)\)(?:\s*format\(([^)]+)\))?/g)).map((m) => ({
          url: m[1].trim().replace(/^["']|["']$/g, ''),
          hint: (m[2] || '').replace(/["']/g, ''),
        }));
        if (entries.length === 0) continue;
        const pick = entries.find((e) => /woff2/i.test(e.hint) || /\.woff2/i.test(e.url)) || entries[0];
        const dataUrl = await fetchDataURL(new URL(pick.url, document.baseURI).href);
        if (!dataUrl) continue;
        seen.add(key);
        out.push({ family, weight, style: fstyle, src: dataUrl, format: fmtFromUrl(pick.url, pick.hint) });
      }
    }
    return out;
  }
  } finally {
    unfurlRestore();
  }
}
