import type { ColorNorm } from '../../css/color.js';

/**
 * Normalises any computed colour (oklch/oklab/lab/lch/color()/hwb/hsl/…) to plain sRGB `rgb()` / `rgba()`
 * by painting it on a 1×1 canvas. getComputedStyle returns modern colour functions verbatim (e.g.
 * shadcn/Tailwind oklch), which SVG renderers without CSS Color 4 can't display.
 */
export function createColorNormalizer(doc: Document): ColorNorm {
  const colorCanvas = doc.createElement('canvas');
  colorCanvas.width = colorCanvas.height = 1;
  const cctx = colorCanvas.getContext('2d', { willReadFrequently: true })!;
  const colorCache = new Map<string, string>();
  // non-color paint keywords (valid for fill/stroke) must pass through untouched
  const NON_COLOR = new Set(['none', 'currentcolor', 'context-fill', 'context-stroke', 'inherit', 'initial', 'unset']);
  const SENTINEL = 'rgba(1, 2, 3, 0.5)';
  return (c: string): string => {
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
}
