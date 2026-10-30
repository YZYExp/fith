export // clip-path basic shapes → absolute-px SVG path data (reference box = border box). null when
// unsupported (url(), path(), geometry boxes other than border-box…): stays a subtree raster.
const rrPath = (x: number, y: number, w: number, h: number, rad: number[]): string => {
  const m = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = rad.map((v) => Math.max(0, Math.min(v, m)));
  const f = (v: number) => String(Math.round(v * 100) / 100);
  return `M${f(x + tl)},${f(y)}H${f(x + w - tr)}${tr ? `A${f(tr)},${f(tr)} 0 0 1 ${f(x + w)},${f(y + tr)}` : ''}V${f(y + h - br)}${br ? `A${f(br)},${f(br)} 0 0 1 ${f(x + w - br)},${f(y + h)}` : ''}H${f(x + bl)}${bl ? `A${f(bl)},${f(bl)} 0 0 1 ${f(x)},${f(y + h - bl)}` : ''}V${f(y + tl)}${tl ? `A${f(tl)},${f(tl)} 0 0 1 ${f(x + tl)},${f(y)}` : ''}Z`;
};
