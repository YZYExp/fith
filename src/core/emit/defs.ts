/**
 * <defs> registry and the reusable-definition builders (clip paths, shadow
 * filters/masks, gradients). Each builder registers its markup with a Defs
 * instance and returns the generated id, deduplicating identical definitions.
 */
import type { Clip, CornerRadii, LinearGradientFill, RadialGradientFill, ConicGradientFill } from '../ir/types.js';
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

/** CSS filter: blur(r) — the filter region covers the box plus the 3σ blur spread. */
export function blurFilterId(defs: Defs, blur: number, rect: { x: number; y: number; width: number; height: number }): string {
  const pad = blur * 3;
  return defs.add(
    `<filter id="{ID}" filterUnits="userSpaceOnUse" x="${n(rect.x - pad)}" y="${n(rect.y - pad)}" ` +
      `width="${n(rect.width + pad * 2)}" height="${n(rect.height + pad * 2)}" color-interpolation-filters="sRGB">` +
      `<feGaussianBlur stdDeviation="${n(blur)}"/></filter>`,
  );
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
  g: LinearGradientFill | RadialGradientFill,
  rectIn: { x: number; y: number; width: number; height: number },
): string {
  const rect = g.box ?? rectIn;
  if (g.type === 'radial-gradient') {
    const rstops = g.stops
      .map((s) => {
        const { color, opacity } = splitColor(s.color);
        const op = opacity !== '1' ? ` stop-opacity="${opacity}"` : '';
        return `<stop offset="${n(s.offset * 100)}%" stop-color="${esc(color)}"${op}/>`;
      })
      .join('');
    // ellipse = circle of radius rx, squashed vertically about the centre
    const tf = g.ry !== g.rx && g.rx > 0 ? ` gradientTransform="translate(${n(g.cx)} ${n(g.cy)}) scale(1 ${n(g.ry / g.rx)}) translate(${n(-g.cx)} ${n(-g.cy)})"` : '';
    return defs.add(
      `<radialGradient id="{ID}" gradientUnits="userSpaceOnUse" cx="${n(g.cx)}" cy="${n(g.cy)}" r="${n(g.rx)}"${tf}>${rstops}</radialGradient>`,
    );
  }
  // CSS 0deg = to top; direction vector in screen coords (y down) = (sinθ, -cosθ)
  const dx = Math.sin((g.angle * Math.PI) / 180);
  const dy = -Math.cos((g.angle * Math.PI) / 180);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const len = (Math.abs(rect.width * dx) + Math.abs(rect.height * dy)) / 2;
  // p(t) along the full gradient line, t in [0,1]; a repeating gradient spans [from,to] and tiles
  const t0 = g.repeat ? g.repeat.from : 0, t1 = g.repeat ? g.repeat.to : 1;
  const x1 = cx + dx * len * (2 * t0 - 1);
  const y1 = cy + dy * len * (2 * t0 - 1);
  const x2 = cx + dx * len * (2 * t1 - 1);
  const y2 = cy + dy * len * (2 * t1 - 1);
  const stops = g.stops
    .map((s) => {
      const { color, opacity } = splitColor(s.color);
      const op = opacity !== '1' ? ` stop-opacity="${opacity}"` : '';
      return `<stop offset="${n(s.offset * 100)}%" stop-color="${esc(color)}"${op}/>`;
    })
    .join('');
  return defs.add(
    `<linearGradient id="{ID}" gradientUnits="userSpaceOnUse"${g.repeat ? ' spreadMethod="repeat"' : ''} x1="${n(x1)}" y1="${n(y1)}" x2="${n(
      x2,
    )}" y2="${n(y2)}">${stops}</linearGradient>`,
  );
}

/** Alpha mask for CSS mask-image: gradient (white + alpha stops) or placed image over the mask box. */
export function maskGradientId(
  defs: Defs,
  m: {
    rect: { x: number; y: number; width: number; height: number };
    gradient?: LinearGradientFill | RadialGradientFill;
    gradients?: (LinearGradientFill | RadialGradientFill)[];
    image?: { href: string; x: number; y: number; width: number; height: number };
  },
): string {
  const { x, y, width, height } = m.rect;
  let content = '';
  if (m.image) {
    const im = m.image;
    content = `<image x="${n(im.x)}" y="${n(im.y)}" width="${n(im.width)}" height="${n(im.height)}" preserveAspectRatio="none" href="${im.href}"/>`;
  } else {
    // CSS lists the top layer first; SVG paints in document order, so emit bottom → top
    const list = (m.gradients ?? (m.gradient ? [m.gradient] : [])).slice().reverse();
    for (const g of list) {
      const gid = gradientId(defs, g, m.rect);
      content += `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" fill="url(#${gid})"/>`;
    }
  }
  return defs.add(
    `<mask id="{ID}" maskUnits="userSpaceOnUse" mask-type="alpha" style="mask-type:alpha" x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}">${content}</mask>`,
  );
}

/** Colour at `t` (0..1 of a turn) of a stop list, interpolated in premultiplied space like CSS. */
function sampleStops(stops: { offset: number; color: string }[], t: number): string {
  const parse = (c: string): [number, number, number, number] => {
    const m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i);
    return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : [0, 0, 0, 1];
  };
  let k = 0;
  while (k < stops.length - 1 && stops[k + 1].offset <= t) k++;
  const a = stops[k], b = stops[Math.min(k + 1, stops.length - 1)];
  const span = b.offset - a.offset;
  const u = span > 1e-9 ? Math.min(1, Math.max(0, (t - a.offset) / span)) : 0;
  const ca = parse(a.color), cb = parse(b.color);
  const al = ca[3] + (cb[3] - ca[3]) * u;
  const ch = (q: number) => (al > 1e-4 ? Math.round((ca[q] * ca[3] * (1 - u) + cb[q] * cb[3] * u) / al) : cb[q]);
  return al >= 0.999 ? `rgb(${ch(0)},${ch(1)},${ch(2)})` : `rgba(${ch(0)},${ch(1)},${ch(2)},${Math.round(al * 1000) / 1000})`;
}

/** conic-gradient has no SVG primitive: approximate it with thin wedge paths (1.5° each) from the centre. */
export function conicWedges(g: ConicGradientFill, rect: { x: number; y: number; width: number; height: number }): string {
  const box = g.box ?? rect;
  const R = Math.hypot(box.width, box.height) + Math.hypot(Math.abs(g.cx - (box.x + box.width / 2)), Math.abs(g.cy - (box.y + box.height / 2))) + 2;
  const N = 180;
  const stops = [...g.stops];
  if (stops[0].offset > 0) stops.unshift({ offset: 0, color: stops[0].color });
  if (stops[stops.length - 1].offset < 1) stops.push({ offset: 1, color: stops[stops.length - 1].color });
  let out = '';
  // Painter's algorithm: slice i covers every angle from its start to the end of the turn and is
  // overdrawn by slice i+1, so each boundary is anti-aliased exactly once (no seams / moiré).
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    const a0 = ((g.from + (i / N) * 360 - 90) * Math.PI) / 180;
    const a1 = ((g.from - 90 + 359.99) * Math.PI) / 180; // end of the turn (== start angle)
    const large = (1 - i / N) * 360 > 180 ? 1 : 0;
    const x0 = g.cx + R * Math.cos(a0), y0 = g.cy + R * Math.sin(a0);
    const x1 = g.cx + R * Math.cos(a1), y1 = g.cy + R * Math.sin(a1);
    out += `<path d="M${n(g.cx)},${n(g.cy)}L${n(x0)},${n(y0)}A${n(R)},${n(R)} 0 ${large} 1 ${n(x1)},${n(y1)}Z" fill="${sampleStops(stops, t)}"/>`;
  }
  return out;
}

/** clip-path basic shape → <clipPath> id. */
export function shapeClipId(defs: Defs, sh: { d: string; evenodd?: boolean }): string {
  return defs.add(`<clipPath id="{ID}"><path d="${sh.d}"${sh.evenodd ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
}
