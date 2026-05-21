import type { Scene, PaintNode, Clip, CornerRadii, CaptureOptions } from '../ir/types.js';

/**
 * Captures the current page into a Scene IR. Runs INSIDE the page context, so it
 * must be fully self-contained (no imports/closure refs) to be injectable via
 * Playwright `page.evaluate`. The same function is reused by the extension and
 * in-page-library backends, where it is simply called directly.
 */
export async function captureScene(opts: CaptureOptions): Promise<Scene> {
  const dpr = opts.deviceScaleFactor || 1;
  const W = opts.width;
  const H =
    opts.height ||
    Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0,
    );

  const nodes: PaintNode[] = [];
  const rasterTargets: { id: string; x: number; y: number; width: number; height: number }[] = [];
  let counter = 0;
  const nid = () => 'n' + counter++;

  const metricsCanvas = document.createElement('canvas');
  const mctx = metricsCanvas.getContext('2d')!;

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
      const colorMatch = seg.match(/^(rgba?\([^)]+\)|#[0-9a-fA-F]+|[a-zA-Z]+)/);
      if (!colorMatch) return null;
      const color = colorMatch[0];
      // SVG stop-opacity interpolation diverges from CSS when stop alphas differ;
      // raster gradients with any non-opaque stop to stay faithful.
      const alpha = color.match(/rgba\([^)]*,\s*([\d.]+)\s*\)$/);
      if ((alpha && parseFloat(alpha[1]) < 1) || color === 'transparent') return null;
      const rest = seg.slice(color.length).trim();
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

  const isVisible = (el: Element, cs: CSSStyleDeclaration) => {
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse')
      return false;
    if (num(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > H || r.left > W) return false;
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

  const needsRaster = (el: Element, cs: CSSStyleDeclaration) => {
    const tag = el.tagName.toUpperCase();
    if (['CANVAS', 'VIDEO', 'IFRAME', 'SVG', 'OBJECT', 'EMBED'].includes(tag)) return 'media:' + tag;
    if (['INPUT', 'SELECT', 'TEXTAREA', 'PROGRESS', 'METER'].includes(tag)) return 'form-control';
    if (cs.filter && cs.filter !== 'none') return 'filter';
    if ((cs as any).backdropFilter && (cs as any).backdropFilter !== 'none') return 'backdrop-filter';
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') return 'blend-mode';
    if ((cs as any).maskImage && (cs as any).maskImage !== 'none' && (cs as any).maskImage !== undefined)
      return 'mask';
    if (cs.clipPath && cs.clipPath !== 'none') return 'clip-path';
    const m = parseMatrix(cs.transform);
    if (m && (Math.abs(m.b) > 1e-3 || Math.abs(m.c) > 1e-3)) return 'transform-rotate';
    if (cs.backgroundImage && cs.backgroundImage !== 'none' && !parseLinearGradient(cs.backgroundImage))
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
    for (const part of parts) {
      const colorMatch = part.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]+|[a-z]+)/);
      const color = colorMatch ? colorMatch[0] : 'rgba(0,0,0,0.2)';
      const nums = part.replace(/rgba?\([^)]+\)/, '').match(/-?\d*\.?\d+px/g) || [];
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

    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const raw = child.textContent || '';
      if (!raw.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(child);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      if (rects.length === 0) continue;

      const lines: { text: string; x: number; baseline: number }[] = [];
      if (rects.length === 1) {
        const r = rects[0];
        const text = raw.replace(/\s+/g, ' ').trim();
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
          const text = b.chars.join('').replace(/\s+/g, ' ').trim();
          if (!text) continue;
          const baseline = b.top + (b.height - (ascent + descent)) / 2 + ascent;
          lines.push({ text, x: b.left, baseline });
        }
      }
      if (lines.length === 0) continue;
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
        color: cs.color,
        letterSpacing: ls,
        wordSpacing: ws,
        decoration,
        decorationColor: cs.textDecorationColor || cs.color,
      });
    }
  };

  const emitBox = (el: Element, cs: CSSStyleDeclaration, clip: Clip | null, opacity: number) => {
    const r = el.getBoundingClientRect();
    const fill = transparent(cs.backgroundColor) ? null : cs.backgroundColor;
    const bw = {
      top: num(cs.borderTopWidth),
      right: num(cs.borderRightWidth),
      bottom: num(cs.borderBottomWidth),
      left: num(cs.borderLeftWidth),
    };
    const hasBorder = bw.top + bw.right + bw.bottom + bw.left > 0;
    const border = hasBorder
      ? {
          top: { width: bw.top, color: cs.borderTopColor, style: cs.borderTopStyle },
          right: { width: bw.right, color: cs.borderRightColor, style: cs.borderRightStyle },
          bottom: { width: bw.bottom, color: cs.borderBottomColor, style: cs.borderBottomStyle },
          left: { width: bw.left, color: cs.borderLeftColor, style: cs.borderLeftStyle },
        }
      : null;
    const shadows = parseShadows(cs.boxShadow);
    const gradient =
      cs.backgroundImage && cs.backgroundImage !== 'none' ? parseLinearGradient(cs.backgroundImage) : null;
    if (!fill && !gradient && !border && shadows.length === 0) return;
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
    });
  };

  const imgTasks: Promise<void>[] = [];

  const walk = async (el: Element, clip: Clip | null, inheritedOpacity: number) => {
    const cs = getComputedStyle(el);
    if (!isVisible(el, cs)) return;
    const opacity = inheritedOpacity * num(cs.opacity || '1');
    const r = el.getBoundingClientRect();

    const reason = needsRaster(el, cs);
    if (reason) {
      pushRaster(r, clip, opacity, reason);
      return;
    }

    if (el.tagName.toUpperCase() === 'IMG') {
      const img = el as HTMLImageElement;
      const id = nid();
      const node: any = {
        kind: 'image',
        id,
        rect: { x: r.left, y: r.top, width: r.width, height: r.height },
        opacity,
        clip,
        href: null,
        preserveAspectRatio: 'none',
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

    emitBox(el, cs, clip, opacity);
    captureText(el, cs, clip, opacity);

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
      const z = kcs.zIndex === 'auto' ? 0 : parseInt(kcs.zIndex, 10) || 0;
      return { k, positioned, z };
    });
    const neg = meta.filter((x) => x.positioned && x.z < 0).sort((a, b) => a.z - b.z);
    const mid = meta.filter((x) => !(x.positioned && x.z < 0) && !(x.positioned && x.z > 0));
    const pos = meta.filter((x) => x.positioned && x.z > 0).sort((a, b) => a.z - b.z);

    for (const m of neg) await walk(m.k, childClip, opacity);
    for (const m of mid) await walk(m.k, childClip, opacity);
    for (const m of pos) await walk(m.k, childClip, opacity);
  };

  const body = document.body;
  const rootBg =
    !transparent(getComputedStyle(document.documentElement).backgroundColor)
      ? getComputedStyle(document.documentElement).backgroundColor
      : body && !transparent(getComputedStyle(body).backgroundColor)
        ? getComputedStyle(body).backgroundColor
        : '#ffffff';

  await walk(document.documentElement, null, 1);
  await Promise.all(imgTasks);

  const fonts = (opts.fontMode ?? 'embed') === 'embed' ? await collectFonts(nodes) : [];

  return {
    width: W,
    height: H,
    deviceScaleFactor: dpr,
    background: rootBg,
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
