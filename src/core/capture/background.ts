/**
 * Backgrounds, masks and box geometry: CSS values of one element in, paint data out. The functions that need the page's
 * colour normaliser, the loaded-image table or the document take a `BgEnv` first; bind it once with `bindEnv`.
 */
import type { Clip, CornerRadii, BgLayer } from '../ir/types.js';
import type { ColorNorm } from '../../css/color.js';
import { num, splitTopLevel, splitTopLevelWs, lenToPx } from '../../css/util.js';
import { transparent, rgbaOf } from '../../css/color.js';
import { sideToAngle, parseGradientStops as cssParseGradientStops } from '../../css/gradient.js';
import { rrPath } from '../../css/clip.js';

export type ImgInfo = Map<string, { href: string; w: number; h: number } | null>;
export interface BgEnv {
  doc: Document;
  win: Window & typeof globalThis;
  normColor: ColorNorm;
  imgInfo: ImgInfo;
}

/** Bind the environment as the first argument of a function of this module. */
export const bindEnv = <A extends unknown[], R>(env: BgEnv, fn: (env: BgEnv, ...a: A) => R) => (...a: A): R => fn(env, ...a);

// Corner radii in px. Computed `border-radius` keeps percentages ("50%"), which must be resolved
// against the box (horizontal % vs width, vertical % vs height; elliptical corners use the smaller
// radius since the IR is circular-only).
export const radiiOf = (cs: CSSStyleDeclaration, w?: number, h?: number): CornerRadii => {
  const one = (v: string): number => {
    const parts = (v || '0').trim().split(/\s+/);
    const res = parts.map((t, i) => (t.endsWith('%') ? (parseFloat(t) / 100) * (i === 0 ? w ?? 0 : h ?? w ?? 0) : num(t)));
    return res[0];
  };
  return [one(cs.borderTopLeftRadius), one(cs.borderTopRightRadius), one(cs.borderBottomRightRadius), one(cs.borderBottomLeftRadius)];
};

// vertical radii of elliptical corners (`50%`, `10px / 30px`); undefined when every corner is circular
export const radiiYOf = (cs: CSSStyleDeclaration, w: number, h: number): CornerRadii | undefined => {
  const one = (v: string): [number, number] => {
    const parts = (v || '0').trim().split(/\s+/);
    const px = (t: string, ref: number) => (t.endsWith('%') ? (parseFloat(t) / 100) * ref : num(t));
    return [px(parts[0], w), px(parts[1] ?? parts[0], h)];
  };
  const c = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(one);
  if (c.every((q) => Math.abs(q[0] - q[1]) < 0.01)) return undefined;
  return c.map((q) => q[1]) as CornerRadii;
};

export const intersect = (a: Clip | null, b: Clip): Clip => {
  if (!a) return b;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  // pick the tighter (innermost) radii — approximation for nested rounded clips
  const radii = b.width * b.height <= a.width * a.height ? b.radii : a.radii;
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y), radii };
};

export const clipsContent = (cs: CSSStyleDeclaration) =>
  ['hidden', 'clip', 'scroll', 'auto'].includes(cs.overflowX) ||
  ['hidden', 'clip', 'scroll', 'auto'].includes(cs.overflowY);

// ---- background gradients (all layers) -------------------------------------------------
// Supports linear-/radial-gradient with %/px stops, corner keywords, alpha stops (resampled in
// premultiplied space like CSS) and multiple layers. null = something we can't reproduce exactly
// (conic, repeating-*, tiled layers, url() mixed in), which keeps the raster fallback.
export type GBox = { x: number; y: number; width: number; height: number };

export const parseGradientLayer = (env: BgEnv, layer: string, box: GBox) => {
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
    const stops = cssParseGradientStops(parts.slice(i), lineLen, env.normColor, repeating);
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
    const cstops = cssParseGradientStops(parts.slice(ci), 0, env.normColor);
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
  const stops = cssParseGradientStops(parts.slice(i), rx, env.normColor);
  return stops ? { type: 'radial-gradient' as const, cx: box.x + atX, cy: box.y + atY, rx, ry, stops, box } : null;
};

// All gradient layers of a background-image (CSS order: first = top). null when any layer is
// unsupported or sized/tiled (so raster stays the fallback instead of a wrong vector).
export const parseBgLayers = (env: BgEnv, cs: CSSStyleDeclaration, box: GBox) => {
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
    const g = parseGradientLayer(env, layers[k], box);
    if (!g) return null;
    out.push(g);
  }
  return out.length ? out : null;
};

// CSS background positioning area (padding box) of an element, absolute px
export const paddingBoxOf = (el: Element, cs: CSSStyleDeclaration): GBox => {
  const r = el.getBoundingClientRect();
  const l = num(cs.borderLeftWidth), t = num(cs.borderTopWidth);
  const origin = cs.backgroundOrigin;
  if (origin === 'border-box') return { x: r.left, y: r.top, width: r.width, height: r.height };
  return { x: r.left + l, y: r.top + t, width: r.width - l - num(cs.borderRightWidth), height: r.height - t - num(cs.borderBottomWidth) };
};

// the single url() of a one-layer image property, else null
export const singleUrl = (value: string | undefined): string | null => {
  if (!value || value === 'none' || splitTopLevel(value).length !== 1) return null;
  const m = value.trim().match(/^url\((["']?)([\s\S]*)\1\)$/);
  return m ? m[2].replace(/\\(["'])/g, '$1') : null;
};

// url of one background layer: `url(..)` or the first candidate of `image-set(url(..) 1x, …)`
export const layerUrl = (layer: string): string | null => {
  const t = layer.trim();
  const m = t.match(/^url\((["']?)([\s\S]*)\1\)$/) || t.match(/^(?:-webkit-)?image-set\(\s*url\((["']?)([\s\S]*?)\1\)/);
  return m ? m[2].replace(/\\(["'])/g, '$1') : null;
};

// Resolve CSS size/position/repeat for one image layer inside `area`.
// Returns null when we can't reproduce it exactly (tiling etc.).
export const placeImageLayer = (
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
export const parseMaskLayers = (env: BgEnv, el: Element, cs: CSSStyleDeclaration) => {
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
    const g: any = parseGradientLayer(env, layers[k], box);
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

export const parseElementMask = (env: BgEnv, el: Element, cs: CSSStyleDeclaration): any => {
  const value = ((cs as any).maskImage as string) || '';
  if (!value || value === 'none') return null;
  const gl = parseMaskLayers(env, el, cs);
  if (gl) return gl;
  const maskUrl = singleUrl(value);
  if (maskUrl) {
    const info = env.imgInfo.get(maskUrl);
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
    const color = env.normColor(tk[0]);
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
export const tileOf = (
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

export const parseBackgroundLayers = (env: BgEnv, el: Element, cs: CSSStyleDeclaration) => {
  const { doc, win } = env;
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
    const area = fixedAtt ? { x: 0, y: 0, width: doc.documentElement.clientWidth, height: win.innerHeight } : boxes[orgs[k % orgs.length]];
    const clipName = clips[k % clips.length];
    const clipBox = boxes[clipName];
    if (!area || !clipBox || area.width <= 0 || area.height <= 0) return null;
    const rt = reps[k % reps.length].split(/\s+/);
    const rmap = (t: string): [boolean, boolean] | null => (t === 'repeat' ? [true, true] : t === 'no-repeat' ? [false, false] : t === 'repeat-x' ? [true, false] : t === 'repeat-y' ? [false, true] : null);
    let rx: boolean, ry: boolean;
    if (rt.length === 2) { if (rt.includes('space') || rt.includes('round')) return null; rx = rt[0] === 'repeat'; ry = rt[1] === 'repeat'; }
    else { const m = rmap(rt[0]); if (!m) return null; [rx, ry] = m; }
    const url = layerUrl(lay);
    const info = url ? env.imgInfo.get(url) : { w: 0, h: 0 };
    if (!info) return null;
    const tile = tileOf(info, sizes[k % sizes.length], poss[k % poss.length], area);
    if (!tile) return null;
    const ins = inset[clipName] ?? 0;
    const clipRadii = baseRadii.map((v) => Math.max(0, v - ins)) as CornerRadii;
    if (url) out.push({ tile, repeatX: rx, repeatY: ry, clip: clipBox, clipRadii, href: (info as any).href });
    else {
      const g = parseGradientLayer(env, lay, { x: 0, y: 0, width: tile.width, height: tile.height });
      if (!g) return null;
      out.push({ tile, repeatX: rx, repeatY: ry, clip: clipBox, clipRadii, gradient: g as any });
    }
  }
  return out.length ? out.reverse() : null;
};

export const bgImageLayer = (env: BgEnv, el: Element, cs: CSSStyleDeclaration) => {
  const url = singleUrl(cs.backgroundImage);
  const info = url ? env.imgInfo.get(url) : null;
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
