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
      const num = parseFloat(first);
      if (/turn$/.test(first)) angle = num * 360;
      else if (/grad$/.test(first)) angle = num * 0.9;
      else angle = (num * 180) / Math.PI;
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
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse')
      return false;
    if (num(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    if (r.bottom < cullTop || r.right < cullLeft || r.top > cullBottom || r.left > cullRight)
      return false;
    return true;
  };

  const pseudoVisible = (el: Element, sel: string) => {
    const cs = getComputedStyle(el, sel);
    const content = cs.content;
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
    if ((cs as any).maskImage && (cs as any).maskImage !== 'none' && (cs as any).maskImage !== undefined)
      return 'mask';
    if (cs.clipPath && cs.clipPath !== 'none') return 'clip-path';
    const m = parseMatrix(cs.transform);
    if (m && (Math.abs(m.b) > 1e-3 || Math.abs(m.c) > 1e-3)) return 'transform-rotate';
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

  // Box-level effects we can't vectorize. Safe to raster only on a LEAF element
  // (no element children), where rastering the box loses nothing. On containers
  // we skip these (keep descending, vectorize the content) rather than nuke the
  // subtree.
  const needsBoxRaster = (el: Element, cs: CSSStyleDeclaration) => {
    if (cs.backgroundImage && cs.backgroundImage !== 'none' && !parseFirstLinearGradient(cs.backgroundImage))
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
    if (url.startsWith('data:')) return url;
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) return null;
      return await blobToDataURL(await res.blob());
    } catch {
      return null;
    }
  };

  const pushRaster = (rect: DOMRect, clip: Clip | null, opacity: number, reason: string) => {
    const x = Math.max(0, Math.floor(rect.left));
    const y = Math.max(0, Math.floor(rect.top));
    const right = Math.min(W, Math.ceil(rect.right));
    const bottom = Math.min(H, Math.ceil(rect.bottom));
    const width = right - x;
    const height = bottom - y;
    if (width <= 0 || height <= 0) return;
    const id = nid();
    nodes.push({ kind: 'raster', id, rect: { x, y, width, height }, opacity, clip, reason });
    rasterTargets.push({ id, x, y, width, height });
  };

  const parseShadows = (value: string) => {
    if (!value || value === 'none' || value.includes('inset')) return [];
    const out: { offsetX: number; offsetY: number; blur: number; spread: number; color: string }[] = [];
    // split on commas that are not inside rgb()/rgba()
    const parts: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of value) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        parts.push(cur);
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
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
        for (const b of Array.from(buckets.values()).sort((a, c) => a.top - c.top)) {
          if (b.chars.length === 0) continue;
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
        const buckets = new Map<number, { chars: string[]; left: number; top: number; height: number }>();
        const len = raw.length;
        for (let i = 0; i < len; i++) {
          const cr = document.createRange();
          cr.setStart(child, i);
          cr.setEnd(child, i + 1);
          const rb = cr.getBoundingClientRect();
          if (rb.width === 0 && rb.height === 0) continue;
          const key = Math.round(rb.top);
          let b = buckets.get(key);
          if (!b) {
            b = { chars: [], left: rb.left, top: rb.top, height: rb.height };
            buckets.set(key, b);
          }
          b.left = Math.min(b.left, rb.left);
          b.chars.push(raw[i]);
        }
        for (const b of Array.from(buckets.values()).sort((a, c) => a.top - c.top)) {
          const text = xform(b.chars.join('').replace(/\s+/g, ' ').trim());
          if (!text) continue;
          const baseline = b.top + (b.height - (ascent + descent)) / 2 + ascent;
          lines.push({ text, x: b.left, baseline });
        }
      }
      if (lines.length === 0) continue;

      // Detect background-clip:text gradient pattern (e.g. gradient headings).
      // When color is transparent and the background is clipped to text shape,
      // use the gradient as the SVG text fill instead of rendering invisible text.
      let textColor = normColor(cs.color);
      let gradientFill = null;
      const bgClip = cs.backgroundClip || (cs as any).webkitBackgroundClip;
      if (
        transparent(textColor) &&
        (bgClip === 'text' || bgClip === '-webkit-text') &&
        cs.backgroundImage &&
        cs.backgroundImage !== 'none'
      ) {
        const grad = parseFirstLinearGradient(cs.backgroundImage);
        if (grad) {
          gradientFill = grad;
          // Solid fallback: midpoint stop color for renderers that ignore gradientFill.
          textColor = grad.stops[Math.floor(grad.stops.length / 2)].color;
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
      });
    }
  };

  const emitBox = (el: Element, cs: CSSStyleDeclaration, clip: Clip | null, opacity: number) => {
    const r = el.getBoundingClientRect();
    const fill = transparent(cs.backgroundColor) ? null : normColor(cs.backgroundColor);
    const bw = {
      top: num(cs.borderTopWidth),
      right: num(cs.borderRightWidth),
      bottom: num(cs.borderBottomWidth),
      left: num(cs.borderLeftWidth),
    };
    const hasBorder = bw.top + bw.right + bw.bottom + bw.left > 0;
    const border = hasBorder
      ? {
          top: { width: bw.top, color: normColor(cs.borderTopColor), style: cs.borderTopStyle },
          right: { width: bw.right, color: normColor(cs.borderRightColor), style: cs.borderRightStyle },
          bottom: { width: bw.bottom, color: normColor(cs.borderBottomColor), style: cs.borderBottomStyle },
          left: { width: bw.left, color: normColor(cs.borderLeftColor), style: cs.borderLeftStyle },
        }
      : null;
    const shadows = parseShadows(cs.boxShadow);
    const gradient =
      cs.backgroundImage && cs.backgroundImage !== 'none' ? parseFirstLinearGradient(cs.backgroundImage) : null;
    const outlineW = num(cs.outlineWidth);
    const outlineStyle = cs.outlineStyle;
    const outline =
      outlineW > 0 && outlineStyle !== 'none' && !transparent(cs.outlineColor)
        ? { width: outlineW, color: normColor(cs.outlineColor), style: outlineStyle, offset: num(cs.outlineOffset) }
        : null;
    if (!fill && !gradient && !border && shadows.length === 0 && !outline) return;
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

  const walk = async (el: Element, clip: Clip | null, inheritedOpacity: number) => {
    const cs = getComputedStyle(el);

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

    const subtreeReason = needsSubtreeRaster(el, cs);
    if (subtreeReason) {
      pushRaster(r, clip, opacity, subtreeReason);
      return;
    }

    if (el.tagName.toLowerCase() === 'svg') {
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
      nodes.push({
        kind: 'inline-svg',
        id: nid(),
        rect: { x: r.left, y: r.top, width: r.width, height: r.height },
        opacity,
        clip,
        markup: clone.outerHTML,
      });
      return;
    }

    if (el.tagName.toUpperCase() === 'IMG') {
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
        fetchDataURL(img.currentSrc || img.src).then((d) => {
          if (d) node.href = d;
          else pushRaster(r, clip, opacity, 'img-cors');
        }),
      );
      return;
    }

    // Box-level effects we can't vectorize:
    //   • Leaf element  → rasterize and done (no children to miss)
    //   • Non-leaf with raster backend → rasterize as base layer so pseudo-elements
    //     and complex backgrounds appear, then vectorize children on top.  Children
    //     paint over the raster so the visual result is correct where vectorization
    //     is faithful; the raster fills the gaps (pseudo-elements, bg images, etc.).
    //   • Non-leaf without raster backend → emit what we can vectorize and continue.
    const boxReason = needsBoxRaster(el, cs);
    if (boxReason) {
      if (el.childElementCount === 0) {
        pushRaster(r, clip, opacity, boxReason);
        return;
      }
      if (containerRasterFallback) {
        pushRaster(r, clip, opacity, boxReason);
        // skip emitBox/captureText — the raster already captures them
      } else {
        emitBox(el, cs, clip, opacity);
        captureText(el, cs, clip, opacity);
      }
    } else {
      emitBox(el, cs, clip, opacity);
      captureText(el, cs, clip, opacity);
    }

    let childClip = clip;
    if (clipsContent(cs)) {
      childClip = intersect(clip, {
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
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

  await walk(rootEl, null, 1);
  await Promise.all(imgTasks);

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
}
