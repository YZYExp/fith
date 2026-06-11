/**
 * <defs> registry and the reusable-definition builders (clip paths, shadow
 * filters/masks, gradients). Each builder registers its markup with a Defs
 * instance and returns the generated id, deduplicating identical definitions.
 */
import type { Clip, CornerRadii, LinearGradientFill } from '../ir/types.js';
import { n, esc, noRadii, roundedRectPath } from './primitives.js';

/** Content-addressed store of <defs> children; identical content shares one id. */
export class Defs {
  private items = new Map<string, string>();
  private seq = 0;
  add(content: string): string {
    const existing = this.items.get(content);
    if (existing) return existing;
    const id = 'd' + this.seq++;
    this.items.set(content, id);
    return id;
  }
  render(): string {
    if (this.items.size === 0) return '';
    const body = Array.from(this.items.entries())
      .map(([content, id]) => content.replace('{ID}', id))
      .join('');
    return `<defs>${body}</defs>`;
  }
}

export function clipId(defs: Defs, clip: Clip): string {
  const inner = noRadii(clip.radii)
    ? `<rect x="${n(clip.x)}" y="${n(clip.y)}" width="${n(clip.width)}" height="${n(clip.height)}"/>`
    : `<path d="${roundedRectPath(clip.x, clip.y, clip.width, clip.height, clip.radii)}"/>`;
  return defs.add(`<clipPath id="{ID}">${inner}</clipPath>`);
}

export function shadowFilterId(defs: Defs, blur: number): string {
  const std = n(blur / 2);
  return defs.add(
    `<filter id="{ID}" x="-50%" y="-50%" width="200%" height="200%">` +
      `<feGaussianBlur stdDeviation="${std}"/></filter>`,
  );
}

// CSS box-shadow is always drawn OUTSIDE the element's border box (the element
// acts as a "cutout"). We replicate this with an SVG mask: white everywhere
// (show shadow), but black inside the element box (hide shadow).
export function shadowMaskId(
  defs: Defs,
  rect: { x: number; y: number; width: number; height: number },
  radii: CornerRadii,
): string {
  const innerPath = noRadii(radii)
    ? `M${n(rect.x)},${n(rect.y)} H${n(rect.x + rect.width)} V${n(rect.y + rect.height)} H${n(rect.x)} Z`
    : roundedRectPath(rect.x, rect.y, rect.width, rect.height, radii);
  // Large white rect (show everything), then black path inside element box (hide shadow there).
  return defs.add(
    `<mask id="{ID}" maskContentUnits="userSpaceOnUse">` +
      `<rect x="-9999" y="-9999" width="99999" height="99999" fill="white"/>` +
      `<path d="${innerPath}" fill="black"/>` +
      `</mask>`,
  );
}

function splitColor(c: string): { color: string; opacity: string } {
  const m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/i);
  if (m && m[4] !== undefined && parseFloat(m[4]) < 1) {
    return { color: `rgb(${m[1]}, ${m[2]}, ${m[3]})`, opacity: m[4] };
  }
  return { color: c, opacity: '1' };
}

export function gradientId(
  defs: Defs,
  g: LinearGradientFill,
  rect: { x: number; y: number; width: number; height: number },
): string {
  // CSS 0deg = to top; direction vector in screen coords (y down) = (sinθ, -cosθ)
  const dx = Math.sin((g.angle * Math.PI) / 180);
  const dy = -Math.cos((g.angle * Math.PI) / 180);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const len = (Math.abs(rect.width * dx) + Math.abs(rect.height * dy)) / 2;
  const x1 = cx - dx * len;
  const y1 = cy - dy * len;
  const x2 = cx + dx * len;
  const y2 = cy + dy * len;
  const stops = g.stops
    .map((s) => {
      const { color, opacity } = splitColor(s.color);
      const op = opacity !== '1' ? ` stop-opacity="${opacity}"` : '';
      return `<stop offset="${n(s.offset * 100)}%" stop-color="${esc(color)}"${op}/>`;
    })
    .join('');
  return defs.add(
    `<linearGradient id="{ID}" gradientUnits="userSpaceOnUse" x1="${n(x1)}" y1="${n(y1)}" x2="${n(
      x2,
    )}" y2="${n(y2)}">${stops}</linearGradient>`,
  );
}
