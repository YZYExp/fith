import { describe, it, expect } from 'vitest';
import { emitSvg } from '../src/core/emit/svg.js';
import type { Scene } from '../src/core/ir/types.js';

const base = (nodes: Scene['nodes']): Scene => ({
  width: 100,
  height: 100,
  deviceScaleFactor: 1,
  background: '#fff',
  nodes,
  rasterTargets: [],
  fonts: [],
});

describe('emitSvg', () => {
  it('emits a valid svg root with viewBox and background', () => {
    const svg = emitSvg(base([]));
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 100 100"');
    expect(svg).toContain('fill="#fff"');
  });

  it('emits a plain rect for a no-radius box', () => {
    const svg = emitSvg(
      base([
        { kind: 'box', id: 'a', rect: { x: 1, y: 2, width: 10, height: 20 }, opacity: 1, radii: [0, 0, 0, 0], fill: 'red' },
      ]),
    );
    expect(svg).toContain('<rect x="1" y="2" width="10" height="20" fill="red"/>');
  });

  it('uses rx for uniform radius and a path for non-uniform radius', () => {
    const uniform = emitSvg(
      base([{ kind: 'box', id: 'a', rect: { x: 0, y: 0, width: 10, height: 10 }, opacity: 1, radii: [4, 4, 4, 4], fill: 'red' }]),
    );
    expect(uniform).toContain('rx="4"');

    const mixed = emitSvg(
      base([{ kind: 'box', id: 'a', rect: { x: 0, y: 0, width: 10, height: 10 }, opacity: 1, radii: [4, 0, 4, 0], fill: 'red' }]),
    );
    expect(mixed).toContain('<path d="M4,0');
  });

  it('emits one text element per line', () => {
    const svg = emitSvg(
      base([
        {
          kind: 'text',
          id: 't',
          rect: { x: 0, y: 0, width: 50, height: 30 },
          opacity: 1,
          lines: [
            { text: 'line one', x: 1, baseline: 10 },
            { text: 'line two', x: 1, baseline: 25 },
          ],
          fontFamily: 'sans-serif',
          fontSize: 14,
          fontWeight: '400',
          fontStyle: 'normal',
          color: 'black',
          letterSpacing: 0,
          wordSpacing: 0,
        },
      ]),
    );
    expect(svg.match(/<text/g)?.length).toBe(2);
    expect(svg).toContain('>line one<');
    expect(svg).toContain('>line two<');
  });

  it('escapes special characters in text', () => {
    const svg = emitSvg(
      base([
        {
          kind: 'text',
          id: 't',
          rect: { x: 0, y: 0, width: 50, height: 30 },
          opacity: 1,
          lines: [{ text: 'a < b & c > d', x: 0, baseline: 10 }],
          fontFamily: 'sans-serif',
          fontSize: 14,
          fontWeight: '400',
          fontStyle: 'normal',
          color: 'black',
          letterSpacing: 0,
          wordSpacing: 0,
        },
      ]),
    );
    expect(svg).toContain('a &lt; b &amp; c &gt; d');
  });

  it('dedupes identical clip paths into a single def', () => {
    const clip = { x: 0, y: 0, width: 10, height: 10, radii: [0, 0, 0, 0] as [number, number, number, number] };
    const svg = emitSvg(
      base([
        { kind: 'box', id: 'a', rect: { x: 0, y: 0, width: 10, height: 10 }, opacity: 1, radii: [0, 0, 0, 0], fill: 'red', clip },
        { kind: 'box', id: 'b', rect: { x: 0, y: 0, width: 10, height: 10 }, opacity: 1, radii: [0, 0, 0, 0], fill: 'blue', clip },
      ]),
    );
    expect(svg.match(/<clipPath/g)?.length).toBe(1);
  });

  it('emits glyph <path> instead of <text> when an outliner is provided', () => {
    const textNode: Scene['nodes'][number] = {
      kind: 'text',
      id: 't',
      rect: { x: 0, y: 0, width: 50, height: 20 },
      opacity: 1,
      lines: [{ text: 'hi', x: 0, baseline: 10 }],
      fontFamily: 'sans-serif',
      fontSize: 14,
      fontWeight: '400',
      fontStyle: 'normal',
      color: 'black',
      letterSpacing: 0,
      wordSpacing: 0,
    };
    const svg = emitSvg(base([textNode]), { outline: () => 'M0,0 L10,0 L10,10 Z' });
    expect(svg).toContain('<path d="M0,0 L10,0 L10,10 Z" fill="black"/>');
    expect(svg).not.toContain('<text');
  });

  it('falls back to <text> when the outliner returns null', () => {
    const textNode: Scene['nodes'][number] = {
      kind: 'text',
      id: 't',
      rect: { x: 0, y: 0, width: 50, height: 20 },
      opacity: 1,
      lines: [{ text: 'hi', x: 0, baseline: 10 }],
      fontFamily: 'sans-serif',
      fontSize: 14,
      fontWeight: '400',
      fontStyle: 'normal',
      color: 'black',
      letterSpacing: 0,
      wordSpacing: 0,
    };
    const svg = emitSvg(base([textNode]), { outline: () => null });
    expect(svg).toContain('<text');
  });

  it('omits default font-weight/style attributes', () => {
    const svg = emitSvg(
      base([
        {
          kind: 'text',
          id: 't',
          rect: { x: 0, y: 0, width: 50, height: 20 },
          opacity: 1,
          lines: [{ text: 'hi', x: 0, baseline: 10 }],
          fontFamily: 'sans-serif',
          fontSize: 14,
          fontWeight: '400',
          fontStyle: 'normal',
          color: 'black',
          letterSpacing: 0,
          wordSpacing: 0,
        },
      ]),
    );
    expect(svg).not.toContain('font-weight');
    expect(svg).not.toContain('font-style');
  });

  it('dedupes repeated inline-svg icons via defs + use', () => {
    const icon = (id: string, x: number, y: number): Scene['nodes'][number] => ({
      kind: 'inline-svg',
      id,
      rect: { x, y, width: 10, height: 10 },
      opacity: 1,
      markup: `<svg x="${x}" y="${y}" width="10" height="10" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>`,
    });
    const svg = emitSvg(base([icon('a', 0, 0), icon('b', 20, 0), icon('c', 40, 0)]));
    expect(svg.match(/<use /g)?.length).toBe(3);
    // the symbol is defined once in defs
    expect(svg.match(/M0 0h16v16H0z/g)?.length).toBe(1);
  });

  it('keeps a single inline-svg icon inline (no use)', () => {
    const svg = emitSvg(
      base([
        {
          kind: 'inline-svg',
          id: 'a',
          rect: { x: 0, y: 0, width: 10, height: 10 },
          opacity: 1,
          markup: `<svg x="0" y="0" width="10" height="10"><path d="M1 1"/></svg>`,
        },
      ]),
    );
    expect(svg).not.toContain('<use');
    expect(svg).toContain('<path d="M1 1"');
  });

  it('wraps low-opacity nodes in a group', () => {
    const svg = emitSvg(
      base([{ kind: 'box', id: 'a', rect: { x: 0, y: 0, width: 10, height: 10 }, opacity: 0.5, radii: [0, 0, 0, 0], fill: 'red' }]),
    );
    expect(svg).toContain('opacity="0.5"');
  });

  it('emits outline as a stroked rect outside the border box', () => {
    const svg = emitSvg(
      base([
        {
          kind: 'box',
          id: 'a',
          rect: { x: 10, y: 10, width: 80, height: 40 },
          opacity: 1,
          radii: [0, 0, 0, 0],
          fill: 'white',
          outline: { width: 2, color: 'blue', style: 'solid', offset: 0 },
        },
      ]),
    );
    // outline stroke center is 1px (width/2) outside the border box
    expect(svg).toContain('stroke="blue"');
    expect(svg).toContain('stroke-width="2"');
    // rect is expanded by exp = offset + width/2 = 1 on each side
    expect(svg).toContain('x="9"');
    expect(svg).toContain('y="9"');
    expect(svg).toContain('width="82"');
    expect(svg).toContain('height="42"');
    expect(svg).toContain('fill="none"');
  });

  it('emits gradient fill for background-clip:text text nodes', () => {
    const svg = emitSvg(
      base([
        {
          kind: 'text',
          id: 't',
          rect: { x: 0, y: 0, width: 200, height: 40 },
          opacity: 1,
          lines: [{ text: 'Gradient', x: 0, baseline: 30 }],
          fontFamily: 'sans-serif',
          fontSize: 24,
          fontWeight: '700',
          fontStyle: 'normal',
          color: 'rgba(0,0,0,0)',  // transparent — would be invisible without gradientFill
          letterSpacing: 0,
          wordSpacing: 0,
          gradientFill: {
            type: 'linear-gradient',
            angle: 90,
            stops: [
              { offset: 0, color: 'rgb(255,0,0)' },
              { offset: 1, color: 'rgb(0,0,255)' },
            ],
          },
        },
      ]),
    );
    // text should reference a linearGradient in defs, not be filled with the transparent color
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('fill="url(#');
    expect(svg).not.toContain('fill="rgba(0,0,0,0)"');
  });

  it('emits dashed outline', () => {
    const svg = emitSvg(
      base([
        {
          kind: 'box',
          id: 'a',
          rect: { x: 0, y: 0, width: 100, height: 50 },
          opacity: 1,
          radii: [0, 0, 0, 0],
          fill: null,
          outline: { width: 3, color: 'red', style: 'dashed', offset: 2 },
        },
      ]),
    );
    expect(svg).toContain('stroke="red"');
    expect(svg).toContain('stroke-dasharray');
  });

  it('emits text-decoration with color when decorationColor differs from text color', () => {
    const svg = emitSvg(
      base([
        {
          kind: 'text',
          id: 't',
          rect: { x: 0, y: 0, width: 100, height: 20 },
          opacity: 1,
          lines: [{ text: 'underlined', x: 0, baseline: 15 }],
          fontFamily: 'sans-serif',
          fontSize: 14,
          fontWeight: '400',
          fontStyle: 'normal',
          color: 'rgb(0,0,0)',
          letterSpacing: 0,
          wordSpacing: 0,
          decoration: 'underline',
          decorationColor: 'rgb(255,0,0)',
        },
      ]),
    );
    // color differs from text color → must be embedded in text-decoration shorthand
    expect(svg).toContain('text-decoration="underline rgb(255,0,0)"');
  });

  it('omits decoration color when it equals the text color', () => {
    const svg = emitSvg(
      base([
        {
          kind: 'text',
          id: 't',
          rect: { x: 0, y: 0, width: 100, height: 20 },
          opacity: 1,
          lines: [{ text: 'same', x: 0, baseline: 15 }],
          fontFamily: 'sans-serif',
          fontSize: 14,
          fontWeight: '400',
          fontStyle: 'normal',
          color: 'rgb(0,0,0)',
          letterSpacing: 0,
          wordSpacing: 0,
          decoration: 'underline',
          decorationColor: 'rgb(0,0,0)',
        },
      ]),
    );
    // same color → simple line-only decoration (no redundant color value)
    expect(svg).toContain('text-decoration="underline"');
    // the text-decoration attribute itself must not include the color
    expect(svg).not.toMatch(/text-decoration="underline\s+rgb/);
  });

  it('emits box shadow filter + mask', () => {
    const svg = emitSvg(
      base([
        {
          kind: 'box',
          id: 'a',
          rect: { x: 10, y: 10, width: 80, height: 40 },
          opacity: 1,
          radii: [0, 0, 0, 0],
          fill: 'white',
          shadows: [{ offsetX: 2, offsetY: 4, blur: 8, spread: 0, color: 'rgba(0,0,0,0.2)' }],
        },
      ]),
    );
    expect(svg).toContain('<filter');
    expect(svg).toContain('<mask');
    expect(svg).toContain('feGaussianBlur');
  });

  it('renders list marker text node like any other text', () => {
    // captureListMarker() synthesizes a plain TextNode for ::marker — the emitter
    // has no special knowledge of markers, so this just verifies the text path works.
    const svg = emitSvg(
      base([
        {
          kind: 'text',
          id: 'm',
          rect: { x: 8, y: 10, width: 8, height: 16 },
          opacity: 1,
          lines: [{ text: '•', x: 8, baseline: 24 }],
          fontFamily: 'sans-serif',
          fontSize: 16,
          fontWeight: '400',
          fontStyle: 'normal',
          color: 'rgb(0, 0, 0)',
          letterSpacing: 0,
          wordSpacing: 0,
        },
        {
          kind: 'text',
          id: 't',
          rect: { x: 18, y: 10, width: 100, height: 16 },
          opacity: 1,
          lines: [{ text: 'List item text', x: 18, baseline: 24 }],
          fontFamily: 'sans-serif',
          fontSize: 16,
          fontWeight: '400',
          fontStyle: 'normal',
          color: 'rgb(0, 0, 0)',
          letterSpacing: 0,
          wordSpacing: 0,
        },
      ]),
    );
    expect(svg).toContain('>•<');
    expect(svg).toContain('>List item text<');
  });
});
