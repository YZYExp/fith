/**
 * Pure formatting + geometry primitives shared by the SVG emitter modules.
 * No DOM, no IR knowledge beyond CornerRadii — safe to import anywhere.
 */
import type { CornerRadii } from '../ir/types.js';

/** Round to 2 decimals (compact output), normalizing -0 → 0. */
export const n = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

/** Escape a string for use in XML text/attribute content. */
export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const uniformRadii = (r: CornerRadii) => r[0] === r[1] && r[1] === r[2] && r[2] === r[3];
export const noRadii = (r: CornerRadii) => r[0] === 0 && r[1] === 0 && r[2] === 0 && r[3] === 0;

/** Build an SVG path for a rectangle with (clamped) per-corner radii. */
export function roundedRectPath(x: number, y: number, w: number, h: number, radii: CornerRadii): string {
  let [tl, tr, br, bl] = radii;
  const maxR = Math.min(w, h) / 2;
  tl = Math.min(tl, maxR);
  tr = Math.min(tr, maxR);
  br = Math.min(br, maxR);
  bl = Math.min(bl, maxR);
  return [
    `M${n(x + tl)},${n(y)}`,
    `H${n(x + w - tr)}`,
    tr ? `A${n(tr)},${n(tr)} 0 0 1 ${n(x + w)},${n(y + tr)}` : '',
    `V${n(y + h - br)}`,
    br ? `A${n(br)},${n(br)} 0 0 1 ${n(x + w - br)},${n(y + h)}` : '',
    `H${n(x + bl)}`,
    bl ? `A${n(bl)},${n(bl)} 0 0 1 ${n(x)},${n(y + h - bl)}` : '',
    `V${n(y + tl)}`,
    tl ? `A${n(tl)},${n(tl)} 0 0 1 ${n(x + tl)},${n(y)}` : '',
    'Z',
  ]
    .filter(Boolean)
    .join(' ');
}
