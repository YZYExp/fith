import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { FontLoader } from '../../core/emit/outline.js';

const cssToFcWeight = (w: string): number => {
  const map: Record<string, number> = {
    '100': 0, '200': 40, '300': 50, '400': 80, '500': 100,
    '600': 180, '700': 200, '800': 205, '900': 210,
    normal: 80, bold: 200,
  };
  return map[w] ?? 80;
};

/**
 * Resolves system fonts via fontconfig (fc-match) so `outline` mode works even
 * for pages that use system font stacks rather than @font-face. fontconfig is
 * the same resolver Chromium uses on Linux, so the matched file matches what was
 * rendered. Node-only.
 */
export function systemFontLoader(): FontLoader {
  const cache = new Map<string, ArrayBuffer | null>();
  return (family, weight, style) => {
    const safe = family.replace(/[^\w \-]/g, '').replace(/^[-\s]+/, '').trim();
    if (!safe) return null;
    const slant = /italic|oblique/.test(style) ? 100 : 0;
    const pattern = `${safe}:weight=${cssToFcWeight(weight)}:slant=${slant}`;
    if (cache.has(pattern)) return cache.get(pattern)!;
    try {
      const file = execFileSync('fc-match', ['-f', '%{file}', pattern], { encoding: 'utf8' }).trim();
      if (!file) {
        cache.set(pattern, null);
        return null;
      }
      const buf = readFileSync(file);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      cache.set(pattern, ab);
      return ab;
    } catch {
      cache.set(pattern, null);
      return null;
    }
  };
}
