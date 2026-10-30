import type { ColorNorm } from './color.js';
import { rgbaOf } from './color.js';
import { splitTopLevel } from './util.js';

export const sideToAngle: Record<string, number> = {
  'to top': 0,
  'to right': 90,
  'to bottom': 180,
  'to left': 270,
};

export // Parse a single linear-gradient() into a structured fill, or null if it is
// anything we don't vectorize (radial/conic/url, corner keywords, px stops,
// multiple layers) — those fall back to raster.
const parseLinearGradient = (value: string, norm: ColorNorm) => {
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
    const color = norm(rawColor);
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

export // Try to parse a linear-gradient from a background-image value that may contain
// multiple comma-separated layers. Returns the first vectorizable layer found,
// so "url(…), linear-gradient(…)" still yields a gradient instead of falling back.
const parseFirstLinearGradient = (value: string, norm: ColorNorm) => {
  const single = parseLinearGradient(value, norm);
  if (single) return single;
  const layers = splitTopLevel(value);
  if (layers.length <= 1) return null;
  for (const layer of layers) {
    const g = parseLinearGradient(layer.trim(), norm);
    if (g) return g;
  }
  return null;
};

const STOP_COLOR = /^((?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^)]+\)|#[0-9a-fA-F]+|[a-zA-Z]+)/;
export // parts = comma-split stop list; lineLen = px length that 100% maps to
const parseGradientStops = (parts: string[], lineLen: number, norm: ColorNorm, repeating = false) => {
  const raw: { offset: number | null; color: string }[] = [];
  for (const seg of parts) {
    const cm = seg.trim().match(STOP_COLOR);
    if (!cm) return null; // transition hint / calc() / unknown
    let color = norm(cm[0]);
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
