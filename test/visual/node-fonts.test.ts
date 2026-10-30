import { describe, it, expect } from 'vitest';
import { renderToSvg } from '../../src/backends/node/playwright.js';

const HTML = '<!doctype html><body style="margin:0;font:20px HostFont, sans-serif"><p style="margin:8px">Hello</p><p style="margin:8px;font-weight:700">World</p></body>';
const face = (family: string, weight: string, style: string, tag: string) => ({ family, weight, style, src: `data:font/woff2;base64,${tag}`, format: 'woff2' });
const opts = { width: 300, height: 120, executablePath: process.env.CHROMIUM_PATH } as const;

describe('Node backend: fonts supplied by the host', () => {
  it('embeds a list of faces instead of reading the page', async () => {
    const svg = await renderToSvg({ html: HTML }, { ...opts, fonts: [face('HostFont', '400', 'normal', 'AAAA')] });
    expect(svg).toContain("font-family:'HostFont'");
    expect(svg).toContain('data:font/woff2;base64,AAAA');
  }, 60_000);

  it('asks a function once per used face, with the characters set in it', async () => {
    const asked: { family: string; weight: string; chars: string }[] = [];
    const svg = await renderToSvg({ html: HTML }, {
      ...opts,
      fonts: (r) => {
        asked.push(r);
        return r.family === 'HostFont' ? face(r.family, r.weight, r.style, 'BBBB') : null;
      },
    });
    const host = asked.filter((r) => r.family === 'HostFont');
    expect(host.map((r) => r.weight).sort()).toEqual(['400', '700']);
    expect(host.find((r) => r.weight === '400')!.chars).toEqual(expect.stringContaining('H'));
    expect(host.find((r) => r.weight === '700')!.chars).toEqual(expect.stringContaining('W'));
    expect(svg).toContain('data:font/woff2;base64,BBBB');
  }, 60_000);

  it('fontMode none ignores the supplier', async () => {
    const svg = await renderToSvg({ html: HTML }, { ...opts, fontMode: 'none', fonts: () => face('HostFont', '400', 'normal', 'CCCC') });
    expect(svg).not.toContain('CCCC');
  }, 60_000);
});
