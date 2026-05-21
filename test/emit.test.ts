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

  it('wraps low-opacity nodes in a group', () => {
    const svg = emitSvg(
      base([{ kind: 'box', id: 'a', rect: { x: 0, y: 0, width: 10, height: 10 }, opacity: 0.5, radii: [0, 0, 0, 0], fill: 'red' }]),
    );
    expect(svg).toContain('opacity="0.5"');
  });
});
