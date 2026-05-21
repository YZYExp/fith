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

export function createOutliner(fonts: FontFace[], loader?: FontLoader): Outliner {
  type Face = { font: opentype.Font; weight: number; italic: boolean };
  const byFamily = new Map<string, Face[]>();
  const missing = new Set<string>();

  const register = (family: string, weight: string, style: string, buf: ArrayBuffer) => {
    try {
      const font = opentype.parse(buf);
      const key = family.toLowerCase();
      const list = byFamily.get(key) || [];
      list.push({ font, weight: weightNum(weight), italic: /italic|oblique/.test(style) });
      byFamily.set(key, list);
    } catch {
      /* unparseable font; ignore */
    }
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

  return (node, line) => {
    const families = node.fontFamily.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
    const weight = weightNum(node.fontWeight);
    const italic = /italic|oblique/.test(node.fontStyle);

    for (const fam of families) {
      let font = pick(fam, weight, italic);
      if (!font && loader && !missing.has(fam.toLowerCase())) {
        const buf = loader(fam, node.fontWeight, node.fontStyle);
        if (buf) register(fam, node.fontWeight, node.fontStyle, buf);
        else missing.add(fam.toLowerCase());
        font = pick(fam, weight, italic);
      }
      if (font) {
        try {
          // Manual per-glyph layout via charToGlyph avoids opentype.js's feature/
          // bidi engine, which throws on some fonts' GSUB tables.
          const full = new opentype.Path();
          if (line.glyphX && line.glyphX.length === line.text.length) {
            // exact browser positions — no advance-width drift
            for (let i = 0; i < line.text.length; i++) {
              const glyph = font.charToGlyph(line.text[i]);
              full.extend(glyph.getPath(line.glyphX[i], line.baseline, node.fontSize));
            }
          } else {
            const scale = node.fontSize / font.unitsPerEm;
            let penX = line.x;
            for (const ch of line.text) {
              const glyph = font.charToGlyph(ch);
              full.extend(glyph.getPath(penX, line.baseline, node.fontSize));
              penX += (glyph.advanceWidth || 0) * scale + (node.letterSpacing || 0);
            }
          }
          const d = full.toPathData(2);
          if (d) return d;
        } catch {
          /* fall back to <text> */
        }
      }
    }
    return null;
  };
}
