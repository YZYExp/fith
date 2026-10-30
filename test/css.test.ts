import { describe, it, expect } from 'vitest';
import { num, splitTopLevel, splitTopLevelWs, lenToPx } from '../src/css/util.js';
import { transparent, rgbaOf, type ColorNorm } from '../src/css/color.js';
import { parseMatrix } from '../src/css/transform.js';
import { parseLinearGradient, parseFirstLinearGradient, parseGradientStops } from '../src/css/gradient.js';
import { parseShadows, parseInsetShadows } from '../src/css/shadow.js';
import { parseFilterList, filterOverflow, pureBlur } from '../src/css/filter.js';
import { rrPath } from '../src/css/clip.js';

// The page's normaliser needs a canvas; the parsers only need *a* function, so tests pass the identity.
const norm: ColorNorm = (c) => c;

describe('css/util', () => {
  it('num parses a leading number and falls back to 0', () => {
    expect(num('12.5px')).toBe(12.5);
    expect(num('auto')).toBe(0);
    expect(num(undefined)).toBe(0);
  });

  it('splits on top-level commas and whitespace only', () => {
    expect(splitTopLevel('a, rgb(1, 2, 3), b').map((s) => s.trim())).toEqual(['a', 'rgb(1, 2, 3)', 'b']);
    expect(splitTopLevelWs('0 4px rgb(1, 2, 3) inset')).toEqual(['0', '4px', 'rgb(1, 2, 3)', 'inset']);
  });

  it('lenToPx resolves % against the reference and rejects other units', () => {
    expect(lenToPx('50%', 200)).toBe(100);
    expect(lenToPx('12px', 200)).toBe(12);
    expect(lenToPx('0', 200)).toBe(0);
    expect(lenToPx('1em', 200)).toBeNull();
  });
});

describe('css/color', () => {
  it('transparent tests the alpha channel, not a `, 0)` suffix', () => {
    expect(transparent('rgba(0, 0, 0, 0)')).toBe(true);
    expect(transparent('hsla(10, 50%, 50%, 0)')).toBe(true);
    expect(transparent('rgb(0 0 0 / 0%)')).toBe(true);
    expect(transparent('rgb(255, 153, 0)')).toBe(false); // blue = 0 once vanished
    expect(transparent('rgba(0, 0, 0, 0.5)')).toBe(false);
  });

  it('rgbaOf reads rgb and rgba, with percent alpha', () => {
    expect(rgbaOf('rgb(1, 2, 3)')).toEqual([1, 2, 3, 1]);
    expect(rgbaOf('rgba(1, 2, 3, 0.25)')).toEqual([1, 2, 3, 0.25]);
    expect(rgbaOf('rgb(1 2 3 / 50%)')).toEqual([1, 2, 3, 0.5]);
    expect(rgbaOf('red')).toBeNull();
  });
});

describe('css/transform', () => {
  it('reads matrix() and the 2D part of matrix3d()', () => {
    expect(parseMatrix('matrix(1, 0, 0, 1, 10, 20)')).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
    const m3 = 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 0, 1)';
    expect(parseMatrix(m3)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 5, f: 6 });
    expect(parseMatrix('none')).toBeNull();
  });
});

describe('css/gradient', () => {
  it('parses a two-stop linear gradient and fills offsets', () => {
    const g = parseLinearGradient('linear-gradient(90deg, rgb(255, 0, 0), rgb(0, 0, 255))', norm);
    expect(g).toEqual({
      type: 'linear-gradient',
      angle: 90,
      stops: [
        { offset: 0, color: 'rgb(255, 0, 0)' },
        { offset: 1, color: 'rgb(0, 0, 255)' },
      ],
    });
  });

  it('spreads missing offsets evenly and keeps them monotonic', () => {
    const g = parseLinearGradient('linear-gradient(to right, rgb(1, 1, 1), rgb(2, 2, 2), rgb(3, 3, 3) 40%)', norm)!;
    expect(g.angle).toBe(90);
    expect(g.stops.map((s) => s.offset)).toEqual([0, 0.2, 0.4]);
  });

  it('refuses what it cannot vectorize (corner keywords, px stops, alpha stops, other kinds)', () => {
    expect(parseLinearGradient('linear-gradient(to top right, rgb(1, 1, 1), rgb(2, 2, 2))', norm)).toBeNull();
    expect(parseLinearGradient('linear-gradient(rgb(1, 1, 1) 10px, rgb(2, 2, 2))', norm)).toBeNull();
    expect(parseLinearGradient('linear-gradient(rgba(1, 1, 1, 0.5), rgb(2, 2, 2))', norm)).toBeNull();
    expect(parseLinearGradient('radial-gradient(rgb(1, 1, 1), rgb(2, 2, 2))', norm)).toBeNull();
  });

  it('finds the first vectorizable layer of a multi-layer value', () => {
    const v = 'radial-gradient(rgb(1, 1, 1), rgb(2, 2, 2)), linear-gradient(rgb(3, 3, 3), rgb(4, 4, 4))';
    expect(parseFirstLinearGradient(v, norm)?.stops[0].color).toBe('rgb(3, 3, 3)');
    expect(parseFirstLinearGradient('radial-gradient(rgb(1, 1, 1), rgb(2, 2, 2))', norm)).toBeNull();
  });

  it('resolves px stops against the line length and resamples alpha ramps in premultiplied space', () => {
    const px = parseGradientStops(['rgb(1, 1, 1) 0px', 'rgb(2, 2, 2) 50px'], 100, norm)!;
    expect(px.map((s) => s.offset)).toEqual([0, 0.5]);
    const ramp = parseGradientStops(['rgb(255, 0, 0)', 'rgba(255, 0, 0, 0)'], 100, norm)!;
    expect(ramp).toHaveLength(8); // two stops plus six sampled in between
    expect(ramp[0].color).toBe('rgb(255, 0, 0)');
    expect(parseGradientStops(['rgb(1, 1, 1)'], 100, norm)).toBeNull();
  });
});

describe('css/shadow', () => {
  it('parseShadows keeps outset layers and drops inset ones', () => {
    const out = parseShadows('rgba(0, 0, 0, 0.2) 0px 4px 8px 2px, inset 0px 1px 0px red', norm);
    expect(out).toEqual([{ offsetX: 0, offsetY: 4, blur: 8, spread: 2, color: 'rgba(0, 0, 0, 0.2)' }]);
    expect(parseShadows('none', norm)).toEqual([]);
  });

  it('parseInsetShadows keeps inset layers only', () => {
    const out = parseInsetShadows('rgba(0, 0, 0, 0.2) 0px 4px 8px 2px, inset rgb(9, 9, 9) 1px 2px 3px 4px', norm);
    expect(out).toEqual([{ offsetX: 1, offsetY: 2, spread: 4, color: 'rgb(9, 9, 9)', blur: 3 }]);
  });

  it('passes colours through the supplied normaliser', () => {
    const upper: ColorNorm = (c) => c.toUpperCase();
    expect(parseShadows('red 0px 0px 1px', upper)[0].color).toBe('RED');
  });
});

describe('css/filter', () => {
  it('parses a filter chain', () => {
    expect(parseFilterList('blur(4px) brightness(120%) hue-rotate(0.5turn)', norm)).toEqual([
      { fn: 'blur', px: 4 },
      { fn: 'brightness', amount: 1.2 },
      { fn: 'hue-rotate', deg: 180 },
    ]);
    // getComputedStyle puts the colour first; an author-order value (colour last) reads the same
    for (const v of ['drop-shadow(rgb(0, 0, 0) 2px 3px 4px)', 'drop-shadow(2px 3px 4px rgb(0, 0, 0))']) {
      expect(parseFilterList(v, norm)).toEqual([{ fn: 'drop-shadow', x: 2, y: 3, blur: 4, color: 'rgb(0, 0, 0)' }]);
    }
    expect(parseFilterList('drop-shadow(2px 3px red)', norm)).toEqual([{ fn: 'drop-shadow', x: 2, y: 3, blur: 0, color: 'red' }]);
    expect(parseFilterList('drop-shadow(1px 2px)', norm)).toEqual([{ fn: 'drop-shadow', x: 1, y: 2, blur: 0, color: 'rgb(0, 0, 0)' }]);
  });

  it('returns null for none and for functions SVG cannot reproduce', () => {
    expect(parseFilterList('none', norm)).toBeNull();
    expect(parseFilterList('url(#f)', norm)).toBeNull();
    expect(parseFilterList('blur(2em)', norm)).toBeNull();
  });

  it('sizes the overflow of a chain and recognises a lone blur', () => {
    expect(filterOverflow([{ fn: 'blur', px: 10 }])).toBe(34);
    expect(pureBlur('blur(12px)')).toBe(12);
    expect(pureBlur('blur(12px) grayscale(1)')).toBeNull();
  });
});

describe('css/clip', () => {
  it('rrPath draws a square with and without corner radii', () => {
    expect(rrPath(0, 0, 10, 10, [0, 0, 0, 0])).toBe('M0,0H10V10H0V0Z');
    expect(rrPath(0, 0, 10, 10, [20, 20, 20, 20])).toContain('A5,5 0 0 1'); // clamped to half the shorter side
  });
});

// ---- capture/background.ts: box geometry and gradient layers (no DOM needed for these) ------------------------
import { radiiOf, radiiYOf, intersect, clipsContent, parseGradientLayer, singleUrl, layerUrl, type BgEnv } from '../src/core/capture/background.js';

const env = { doc: undefined, win: undefined, normColor: norm, imgInfo: new Map() } as unknown as BgEnv;
const style = (o: Record<string, string>) => o as unknown as CSSStyleDeclaration;

describe('capture/background geometry', () => {
  it('radiiOf resolves percentages against the box', () => {
    const cs = style({ borderTopLeftRadius: '50%', borderTopRightRadius: '10px', borderBottomRightRadius: '0px', borderBottomLeftRadius: '25%' });
    expect(radiiOf(cs, 200, 100)).toEqual([100, 10, 0, 50]);
  });

  it('radiiYOf is undefined for circular corners and gives the vertical radii for elliptical ones', () => {
    const circle = style({ borderTopLeftRadius: '8px', borderTopRightRadius: '8px', borderBottomRightRadius: '8px', borderBottomLeftRadius: '8px' });
    expect(radiiYOf(circle, 100, 100)).toBeUndefined();
    const ellipse = style({ borderTopLeftRadius: '50%', borderTopRightRadius: '50%', borderBottomRightRadius: '50%', borderBottomLeftRadius: '50%' });
    expect(radiiYOf(ellipse, 200, 100)).toEqual([50, 50, 50, 50]);
  });

  it('intersect clips to the overlap and keeps the radii of the smaller box', () => {
    const a = { x: 0, y: 0, width: 100, height: 100, radii: [0, 0, 0, 0] as [number, number, number, number] };
    const b = { x: 50, y: 20, width: 100, height: 40, radii: [8, 8, 8, 8] as [number, number, number, number] };
    expect(intersect(null, b)).toBe(b);
    expect(intersect(a, b)).toEqual({ x: 50, y: 20, width: 50, height: 40, radii: [8, 8, 8, 8] });
  });

  it('clipsContent is true for hidden, clip, scroll and auto on either axis', () => {
    expect(clipsContent(style({ overflowX: 'visible', overflowY: 'hidden' }))).toBe(true);
    expect(clipsContent(style({ overflowX: 'visible', overflowY: 'visible' }))).toBe(false);
  });

  it('reads the url of a single image layer', () => {
    expect(singleUrl('url("a.png")')).toBe('a.png');
    expect(singleUrl('url(a.png), url(b.png)')).toBeNull();
    expect(layerUrl('image-set(url("a.png") 1x, url("b.png") 2x)')).toBe('a.png');
  });
});

describe('capture/background gradient layers', () => {
  const box = { x: 0, y: 0, width: 200, height: 100 };

  it('resolves a corner keyword against the box', () => {
    const g = parseGradientLayer(env, 'linear-gradient(to top right, rgb(1, 1, 1), rgb(2, 2, 2))', box) as { angle: number };
    // the 50% line must run through the other two corners, so on a 2:1 box the angle is atan(h / w)
    expect(g.angle).toBeCloseTo((Math.atan2(100, 200) * 180) / Math.PI, 5);
  });

  it('keeps px stops, which resolve against the gradient line length', () => {
    const g = parseGradientLayer(env, 'linear-gradient(90deg, rgb(1, 1, 1) 0px, rgb(2, 2, 2) 100px)', box) as { stops: { offset: number }[] };
    expect(g.stops.map((s) => s.offset)).toEqual([0, 0.5]);
  });

  it('recognises radial and conic layers and refuses unknown functions or two gradients in one layer', () => {
    expect((parseGradientLayer(env, 'radial-gradient(rgb(1, 1, 1), rgb(2, 2, 2))', box) as { type: string }).type).toBe('radial-gradient');
    expect((parseGradientLayer(env, 'conic-gradient(rgb(1, 1, 1), rgb(2, 2, 2))', box) as { type: string }).type).toBe('conic-gradient');
    expect(parseGradientLayer(env, 'url(a.png)', box)).toBeNull();
    expect(parseGradientLayer(env, 'linear-gradient(rgb(1, 1, 1), rgb(2, 2, 2)) linear-gradient(rgb(3, 3, 3), rgb(4, 4, 4))', box)).toBeNull();
  });

  it('refuses a colour space other than srgb', () => {
    expect(parseGradientLayer(env, 'linear-gradient(in oklab, rgb(1, 1, 1), rgb(2, 2, 2))', box)).toBeNull();
    expect(parseGradientLayer(env, 'linear-gradient(in srgb, rgb(1, 1, 1), rgb(2, 2, 2))', box)).not.toBeNull();
  });
});
