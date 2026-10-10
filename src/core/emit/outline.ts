/**
 * Text → glyph outline conversion (fontMode: 'outline'). Isomorphic: opentype.js
 * runs in Node and the browser. Backends provide the font sources — embedded
 * @font-face data URIs always, plus an optional loader for system fonts (Node
 * resolves these via fontconfig).
 */
import opentype from 'opentype.js';
import type { FontFace, TextNode, TextLine } from '../ir/types.js';

export type Outliner = (node: TextNode, line: TextLine) => string | null;

/** Loads font bytes for a family/weight/style not covered by @font-face. */
export type FontLoader = (family: string, weight: string, style: string) => ArrayBuffer | null;

/**
 * Loads a font that covers `codePoint` when no family in the stack does — the
 * browser's own per-character fallback (e.g. CJK text under a Latin font stack).
 * Returns a stable key (to dedupe parsed fonts) plus the font bytes.
 */
export type FallbackLoader = (
  codePoint: number,
  weight: string,
  style: string,
) => { key: string; data: ArrayBuffer } | null;

function dataUrlToArrayBuffer(d: string): ArrayBuffer {
  const b64 = d.slice(d.indexOf(',') + 1);
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

const weightNum = (w: string) => {
  if (w === 'normal') return 400;
  if (w === 'bold') return 700;
  const n = parseInt(w, 10);
  return isFinite(n) ? n : 400;
};

export function createOutliner(fonts: FontFace[], loader?: FontLoader, fallback?: FallbackLoader): Outliner {
  type Face = { font: opentype.Font; weight: number; italic: boolean };
  const byFamily = new Map<string, Face[]>();
  const missing = new Set<string>();
  const fallbackFonts = new Map<string, opentype.Font | null>();

  const parse = (buf: ArrayBuffer): opentype.Font | null => {
    try {
      return opentype.parse(buf);
    } catch {
      return null; // unparseable font; ignore
    }
  };

  const register = (family: string, weight: string, style: string, buf: ArrayBuffer) => {
    const font = parse(buf);
    if (!font) return;
    const key = family.toLowerCase();
    const list = byFamily.get(key) || [];
    list.push({ font, weight: weightNum(weight), italic: /italic|oblique/.test(style) });
    byFamily.set(key, list);
  };

  for (const f of fonts) {
    try {
      register(f.family, f.weight, f.style, dataUrlToArrayBuffer(f.src));
    } catch {
      /* bad data url */
    }
  }

  const pick = (family: string, weight: number, italic: boolean): opentype.Font | null => {
    const list = byFamily.get(family.toLowerCase());
    if (!list || list.length === 0) return null;
    let best = list[0];
    let bestScore = Infinity;
    for (const f of list) {
      const score = Math.abs(f.weight - weight) + (f.italic === italic ? 0 : 1000);
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    return best.font;
  };

  const resolveStack = (node: TextNode): opentype.Font[] => {
    const families = node.fontFamily.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
    const weight = weightNum(node.fontWeight);
    const italic = /italic|oblique/.test(node.fontStyle);
    const stack: opentype.Font[] = [];
    for (const fam of families) {
      if (!fam) continue;
      let font = pick(fam, weight, italic);
      if (!font && loader && !missing.has(fam.toLowerCase())) {
        const buf = loader(fam, node.fontWeight, node.fontStyle);
        if (buf) register(fam, node.fontWeight, node.fontStyle, buf);
        else missing.add(fam.toLowerCase());
        font = pick(fam, weight, italic);
      }
      if (font && !stack.includes(font)) stack.push(font);
    }
    return stack;
  };

  const hasGlyph = (font: opentype.Font, ch: string) => font.charToGlyph(ch).index !== 0;

  // Like the browser: each character uses the first font in the stack that has
  // it, then a system fallback. Glyph 0 (.notdef) is never drawn.
  const fontFor = (stack: opentype.Font[], ch: string, node: TextNode): opentype.Font | null => {
    for (const font of stack) if (hasGlyph(font, ch)) return font;
    if (/\s/.test(ch)) return stack[0] ?? null;
    for (const font of fallbackFonts.values()) if (font && hasGlyph(font, ch)) return font;
    if (!fallback) return null;
    const hit = fallback(ch.codePointAt(0)!, node.fontWeight, node.fontStyle);
    if (!hit) return null;
    if (!fallbackFonts.has(hit.key)) fallbackFonts.set(hit.key, parse(hit.data));
    const font = fallbackFonts.get(hit.key);
    return font && hasGlyph(font, ch) ? font : null;
  };

  return (node, line) => {
    const stack = resolveStack(node);
    if (stack.length === 0 && !fallback) return null;
    try {
      // Manual per-glyph layout via charToGlyph avoids opentype.js's feature/
      // bidi engine, which throws on some fonts' GSUB tables.
      const full = new opentype.Path();
      // exact browser positions when available — no advance-width drift
      const exact = line.glyphX && line.glyphX.length === line.text.length ? line.glyphX : null;
      let penX = line.x;
      for (let i = 0; i < line.text.length; ) {
        const ch = String.fromCodePoint(line.text.codePointAt(i)!);
        const font = fontFor(stack, ch, node);
        // A character no font can draw: keep the line as <text> rather than tofu.
        if (!font) return null;
        const glyph = font.charToGlyph(ch);
        const x = exact ? exact[i] : penX;
        full.extend(glyph.getPath(x, line.baseline, node.fontSize));
        penX += (glyph.advanceWidth || 0) * (node.fontSize / font.unitsPerEm) + (node.letterSpacing || 0);
        i += ch.length;
      }
      return full.toPathData(2) || null;
    } catch {
      return null; // fall back to <text>
    }
  };
}
