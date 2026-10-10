import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { FallbackLoader, FontLoader } from '../../core/emit/outline.js';

const cssToFcWeight = (w: string): number => {
  const map: Record<string, number> = {
    '100': 0, '200': 40, '300': 50, '400': 80, '500': 100,
    '600': 180, '700': 200, '800': 205, '900': 210,
    normal: 80, bold: 200,
  };
  return map[w] ?? 80;
};

const GENERIC = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'math', 'emoji',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', '-apple-system', 'blinkmacsystemfont',
]);

// Metric-compatible replacements Chromium accepts from fontconfig for a named
// family (Skia's IsMetricCompatibleReplacement). Any other substitute means the
// family is not installed and the browser moved on to the next one in the stack.
const METRIC_GROUPS = [
  ['arial', 'helvetica', 'liberation sans', 'arimo', 'albany', 'albany amt'],
  ['times', 'times new roman', 'liberation serif', 'tinos', 'thorndale', 'thorndale amt'],
  ['courier', 'courier new', 'liberation mono', 'cousine', 'cumberland', 'cumberland amt'],
  ['cambria', 'caladea'],
  ['calibri', 'carlito'],
  ['symbol', 'symbol neu'],
];

// Chromium's default generic-family prefs on Linux (not fontconfig's own
// `serif`/`sans-serif` aliases, which pick e.g. DejaVu Serif).
const CHROMIUM_GENERIC: Record<string, string> = {
  serif: 'Times New Roman',
  'sans-serif': 'Arial',
};

/** Would Chromium render `requested` with the font fontconfig matched (named `matched`)? */
export function acceptsSubstitute(requested: string, matched: string[]): boolean {
  const want = requested.toLowerCase();
  if (GENERIC.has(want)) return true;
  const got = matched.map((m) => m.trim().toLowerCase());
  if (got.includes(want)) return true;
  const group = METRIC_GROUPS.find((g) => g.includes(want));
  return !!group && got.some((m) => group.includes(m));
}

/**
 * Font bytes opentype.js can parse. A TrueType collection (.ttc — most CJK system
 * fonts) is turned into a standalone sfnt for face `index`: copy that face's table
 * directory to the front and shift its (file-absolute) table offsets past it.
 */
export function readFont(file: string, index = 0): ArrayBuffer {
  const buf = readFileSync(file);
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'ttcf') {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }
  const count = buf.readUInt32BE(8);
  const face = buf.readUInt32BE(12 + 4 * Math.min(Math.max(index, 0), count - 1));
  const tables = buf.readUInt16BE(face + 4);
  const dirLength = 12 + 16 * tables;
  const out = Buffer.alloc(dirLength + buf.length);
  buf.copy(out, 0, face, face + dirLength);
  for (let t = 0; t < tables; t++) {
    const at = 12 + 16 * t + 8;
    out.writeUInt32BE(out.readUInt32BE(at) + dirLength, at);
  }
  buf.copy(out, dirLength);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

/** fc-match output `file\nindex\nfamily` → parts. */
const fcMatch = (pattern: string) => {
  const [file = '', index = '0', family = ''] = execFileSync(
    'fc-match', ['-f', '%{file}\\n%{index}\\n%{family}', pattern], { encoding: 'utf8' },
  ).split('\n');
  return { file: file.trim(), index: parseInt(index, 10) || 0, families: family.split(',') };
};

/**
 * Resolves system fonts via fontconfig (fc-match) so `outline` mode works even
 * for pages that use system font stacks rather than @font-face. fontconfig is
 * the same resolver Chromium uses on Linux, so the matched file matches what was
 * rendered — provided substitutes are rejected the way Chromium rejects them
 * (fc-match always answers, e.g. "Noto Serif CJK SC" → Inter when it is absent).
 * Node-only.
 */
export function systemFontLoader(): FontLoader {
  const cache = new Map<string, ArrayBuffer | null>();
  return (family, weight, style) => {
    const safe = family.replace(/[^\w \-]/g, '').replace(/^[-\s]+/, '').trim();
    if (!safe) return null;
    const slant = /italic|oblique/.test(style) ? 100 : 0;
    const query = CHROMIUM_GENERIC[safe.toLowerCase()] ?? safe;
    const pattern = `${query}:weight=${cssToFcWeight(weight)}:slant=${slant}`;
    if (cache.has(pattern)) return cache.get(pattern)!;
    let result: ArrayBuffer | null = null;
    try {
      const { file, index, families } = fcMatch(pattern);
      if (file && acceptsSubstitute(query, families)) result = readFont(file, index);
    } catch {
      /* fontconfig missing or unreadable file */
    }
    cache.set(pattern, result);
    return result;
  };
}

/**
 * Per-character fallback (fontconfig `charset` match), mirroring how Chromium
 * finds a font for characters the page's font stack does not cover. Node-only.
 */
export function systemFallbackLoader(): FallbackLoader {
  const cache = new Map<string, { key: string; data: ArrayBuffer } | null>();
  const files = new Map<string, ArrayBuffer>();
  return (codePoint, weight, style) => {
    const slant = /italic|oblique/.test(style) ? 100 : 0;
    const pattern = `:charset=${codePoint.toString(16)}:weight=${cssToFcWeight(weight)}:slant=${slant}`;
    if (cache.has(pattern)) return cache.get(pattern)!;
    let result: { key: string; data: ArrayBuffer } | null = null;
    try {
      const { file, index } = fcMatch(pattern);
      if (file) {
        const key = `${file}#${index}`;
        if (!files.has(key)) files.set(key, readFont(file, index));
        result = { key, data: files.get(key)! };
      }
    } catch {
      /* fontconfig missing or unreadable file */
    }
    cache.set(pattern, result);
    return result;
  };
}
