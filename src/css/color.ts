/** Colour helpers. `ColorNorm` is the page's normaliser (it needs a canvas), so parsers receive it as a parameter. */

/** Turns any CSS colour into plain sRGB `rgb()` / `rgba()`. */
export type ColorNorm = (c: string) => string;

export const transparent = (c: string) =>
  !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)' ||
  // alpha-0 only: a bare `, 0)` suffix also matches opaque rgb(255, 153, 0) (blue channel 0)
  /^(?:rgba|hsla)\([^)]*,\s*0(?:\.0+)?\)\s*$/.test(c) || /\/\s*0(?:\.0+)?%?\s*\)\s*$/.test(c);

export const rgbaOf = (c: string): [number, number, number, number] | null => {
  const m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/i);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), a];
};
