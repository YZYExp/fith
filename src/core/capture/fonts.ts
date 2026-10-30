import type { PaintNode } from '../ir/types.js';
import { fetchDataURL } from './images.js';

export async function collectFonts(painted: PaintNode[], env: { doc: Document; win: Window & typeof globalThis; externalCss?: Record<string, string> }) {
  const { doc, win } = env;
  // families actually referenced by text nodes
  const used = new Set<string>();
  for (const node of painted) {
    if (node.kind !== 'text') continue;
    for (const fam of node.fontFamily.split(',')) {
      used.add(fam.trim().replace(/^["']|["']$/g, '').toLowerCase());
    }
  }

  const fmtFromUrl = (url: string, hint?: string) => {
    const h = (hint || '').toLowerCase();
    if (h.includes('woff2')) return 'woff2';
    if (h.includes('woff')) return 'woff';
    if (h.includes('truetype')) return 'truetype';
    if (h.includes('opentype')) return 'opentype';
    if (/\.woff2(\?|$)/i.test(url)) return 'woff2';
    if (/\.woff(\?|$)/i.test(url)) return 'woff';
    if (/\.otf(\?|$)/i.test(url)) return 'opentype';
    return 'truetype';
  };

  const out: { family: string; weight: string; style: string; src: string; format: string; unicodeRange?: string }[] = [];
  const seen = new Set<string>();
  const urlCache = new Map<string, string | null>();

  // Collect @font-face rules, descending into @media/@supports/@layer groups, with the
  // URL base of the owning stylesheet (url() in a sheet resolve against the sheet, not the page).
  const faces: { rule: CSSFontFaceRule; base: string }[] = [];
  // Cross-origin sheets (Google Fonts via <link>/@import without crossorigin) throw on
  // .cssRules; their text is still fetchable when the host sends CORS headers.
  const opaque: string[] = [];
  const walk = (rules: CSSRuleList, base: string, depth: number) => {
    for (const rule of Array.from(rules)) {
      if (rule.constructor.name === 'CSSFontFaceRule' || (rule as any).type === 5) {
        faces.push({ rule: rule as CSSFontFaceRule, base });
      } else if ((rule as any).type === 3 && (rule as any).styleSheet && depth < 6) {
        // @import: the imported sheet's url()s resolve against its own href
        const sub = (rule as any).styleSheet as CSSStyleSheet;
        try { walk(sub.cssRules, sub.href || base, depth + 1); } catch { if (sub.href) opaque.push(sub.href); }
      } else if (depth < 6 && (rule as any).cssRules) {
        try { walk((rule as any).cssRules as CSSRuleList, base, depth + 1); } catch { /* ignore */ }
      }
    }
  };
  const sheets: CSSStyleSheet[] = Array.from(doc.styleSheets) as CSSStyleSheet[];
  try { for (const s of (doc as any).adoptedStyleSheets || []) sheets.push(s); } catch { /* ignore */ }
  for (const sheet of sheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
      if (!rules) continue;
    } catch {
      if (sheet.href) opaque.push(sheet.href);
      continue; // cross-origin sheet
    }
    walk(rules, sheet.href || doc.baseURI, 0);
  }
  for (const href of Array.from(new Set(opaque)).slice(0, 120)) {
    try {
      let text = env.externalCss?.[href] as string | undefined;
      if (text === undefined) {
        const res = await fetch(href, { cache: 'force-cache' });
        if (!res.ok) continue;
        text = await res.text();
      }
      const parsed = new win.CSSStyleSheet();
      parsed.replaceSync(text.replace(/@import[^;]*;/g, ''));
      walk(parsed.cssRules, href, 0);
    } catch { /* CORS-blocked or unparsable: fonts stay referenced by name */ }
  }

  for (const { rule, base } of faces) {
    const style = rule.style;
    const family = style.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, '');
    if (!family || !used.has(family.toLowerCase())) continue;
    const weight = style.getPropertyValue('font-weight') || '400';
    const fstyle = style.getPropertyValue('font-style') || 'normal';
    const src = style.getPropertyValue('src');
    if (!src) continue;
    const unicodeRange = style.getPropertyValue('unicode-range').trim() || undefined;

    // pick first url() src (prefer woff2)
    const entries = Array.from(src.matchAll(/url\(([^)]+)\)(?:\s*format\(([^)]+)\))?/g)).map((m) => ({
      url: m[1].trim().replace(/^["']|["']$/g, ''),
      hint: (m[2] || '').replace(/["']/g, ''),
    }));
    if (entries.length === 0) continue;
    const pick = entries.find((e) => /woff2/i.test(e.hint) || /\.woff2/i.test(e.url)) || entries[0];
    let abs: string;
    try { abs = new URL(pick.url, base).href; } catch { continue; }
    const key = family + '|' + weight + '|' + fstyle + '|' + (unicodeRange || '') + '|' + abs;
    if (seen.has(key)) continue;
    seen.add(key);
    let dataUrl: string | null;
    if (urlCache.has(abs)) dataUrl = urlCache.get(abs)!;
    else { dataUrl = await fetchDataURL(abs); urlCache.set(abs, dataUrl); }
    if (!dataUrl) continue;
    out.push({ family, weight, style: fstyle, src: dataUrl, format: fmtFromUrl(pick.url, pick.hint), unicodeRange });
  }
  return out;
}
