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

/**
 * SVG path for a rectangle with per-corner radii, scaled like CSS: if adjacent radii overflow a side, ALL
 * radii shrink by the same factor (so a 9999px pill is a half-height capsule and 50% is an ellipse).
 * `ry` are the vertical radii for elliptical corners (defaults to the horizontal ones).
 */
export function roundedRectPath(x: number, y: number, w: number, h: number, radii: CornerRadii, ry?: CornerRadii): string {
  const rxs = radii, rys = ry ?? radii;
  const f = Math.min(
    1,
    w / Math.max(1e-9, rxs[0] + rxs[1]),
    w / Math.max(1e-9, rxs[3] + rxs[2]),
    h / Math.max(1e-9, rys[0] + rys[3]),
    h / Math.max(1e-9, rys[1] + rys[2]),
  );
  const [tlx, trx, brx, blx] = rxs.map((v) => v * f);
  const [tly, try_, bry, bly] = rys.map((v) => v * f);
  return [
    `M${n(x + tlx)},${n(y)}`,
    `H${n(x + w - trx)}`,
    trx || try_ ? `A${n(trx)},${n(try_)} 0 0 1 ${n(x + w)},${n(y + try_)}` : '',
    `V${n(y + h - bry)}`,
    brx || bry ? `A${n(brx)},${n(bry)} 0 0 1 ${n(x + w - brx)},${n(y + h)}` : '',
    `H${n(x + blx)}`,
    blx || bly ? `A${n(blx)},${n(bly)} 0 0 1 ${n(x)},${n(y + h - bly)}` : '',
    `V${n(y + tly)}`,
    tlx || tly ? `A${n(tlx)},${n(tly)} 0 0 1 ${n(x + tlx)},${n(y)}` : '',
    'Z',
  ]
    .filter(Boolean)
    .join(' ');
}
