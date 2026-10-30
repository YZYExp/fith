/** Text: lines of a text node, form-control values, list markers and native controls, as `text` paint nodes. */
import type { CaptureCtx } from './ctx.js';
import type { PaintNode, Clip } from '../ir/types.js';
import { intersect } from './background.js';
import { num } from '../../css/util.js';
import { transparent } from '../../css/color.js';

// Reasons that require rendering the WHOLE element as one image (children
// included). Returning one of these stops descent — so it must only be used
// for genuinely subtree-wide effects, never for box-level ones, otherwise a
// <body>/wrapper carrying the property would collapse the entire page to a
// single raster (and a blank SVG if that raster can't be produced).
// Single-line text inputs with author-styled chrome (appearance:none, or a solid border) are
// just a box + one line of text, so they vectorize. Native-looking ones (inset border) stay raster.
export const TEXT_INPUT = /^(text|email|password|search|url|tel|number|)$/;

export const vectorTextInput = (el: Element, cs: CSSStyleDeclaration): boolean => {
  if (el.tagName !== 'INPUT') return false;
  const inp = el as HTMLInputElement;
  if (!TEXT_INPUT.test(inp.getAttribute('type') || '') && !TEXT_INPUT.test(inp.type)) return false;
  if (inp.list || inp.type === 'number') return false; // datalist arrow / spin buttons
  if (['inset', 'outset', 'groove', 'ridge'].includes(cs.borderTopStyle)) return false;
  if (cs.direction === 'rtl') return false;
  return true;
};

// Native controls drawn as vector primitives: 'check' (checkbox/radio), 'select' (single), 'textarea'.
export const nativeControl = (el: Element): 'check' | 'select' | 'textarea' | null => {
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return 'textarea';
  if (tag === 'SELECT') { const s = el as HTMLSelectElement; return !s.multiple && !(s.size > 1) ? 'select' : null; }
  if (tag === 'INPUT') { const t = (el as HTMLInputElement).type; return t === 'checkbox' || t === 'radio' ? 'check' : null; }
  return null;
};

// Synthesize a text node for the CSS ::marker pseudo-element on list items.
// Markers are pseudo-elements not in the DOM — getComputedStyle(el,'::marker')
// exposes their computed content and color in Chrome 86+/FF 68+/Safari 13.1+.
/** A clip with no area hides everything under it (a collapsed `height:0; overflow:hidden` box, hidden content). */
export const emptyClip = (clip: Clip | null) => !!clip && (clip.width <= 0 || clip.height <= 0);

export const captureListMarker = (ctx: CaptureCtx, el: Element, cs: CSSStyleDeclaration, clip: Clip | null, opacity: number) => {
  if (cs.display !== 'list-item' || emptyClip(clip)) return;
  const ms = ctx.win.getComputedStyle(el, '::marker');
  let markerText = ms.content || '';
  if (!markerText || markerText === 'none' || markerText === 'normal') {
    // Fallback: infer from list-style-type
    const lstyle = cs.listStyleType || ctx.win.getComputedStyle(el.parentElement || el).listStyleType || '';
    if (!lstyle || lstyle === 'none') return;
    if (lstyle === 'disc') markerText = '•';
    else if (lstyle === 'circle') markerText = '○';
    else if (lstyle === 'square') markerText = '▪';
    else if (lstyle === 'decimal') {
      let n = 1;
      let sib = el.previousElementSibling;
      while (sib) { if (sib.tagName === el.tagName) n++; sib = sib.previousElementSibling; }
      markerText = n + '.';
    } else return;
  } else {
    // Computed content is a CSS quoted string like '"• "' — strip outer quotes
    markerText = markerText.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  markerText = markerText.trim();
  if (!markerText) return;

  const r = el.getBoundingClientRect();
  const markerFontSize = num(ms.fontSize) || num(cs.fontSize);
  ctx.mctx.font = `${ms.fontStyle || cs.fontStyle} ${ms.fontWeight || cs.fontWeight} ${markerFontSize}px ${ms.fontFamily || cs.fontFamily}`;
  const mfm = ctx.mctx.measureText('Mg');
  const masc = (mfm as any).fontBoundingBoxAscent || markerFontSize * 0.8;
  const mdsc = (mfm as any).fontBoundingBoxDescent || markerFontSize * 0.2;
  const markerW = ctx.mctx.measureText(markerText).width;

  // Approximate baseline from the first text node in this li (or its first child element)
  let baseline = r.top + (markerFontSize - (masc + mdsc)) / 2 + masc;
  const firstTN = (() => {
    for (const c of Array.from(el.childNodes))
      if (c.nodeType === Node.TEXT_NODE && (c.textContent || '').trim()) return c;
    const fc = el.firstElementChild;
    if (fc) for (const c of Array.from(fc.childNodes))
      if (c.nodeType === Node.TEXT_NODE && (c.textContent || '').trim()) return c;
    return null;
  })();
  if (firstTN) {
    const rng = ctx.doc.createRange();
    rng.setStart(firstTN, 0);
    rng.setEnd(firstTN, Math.min(1, (firstTN.textContent || '').length));
    const rs = rng.getClientRects();
    if (rs.length > 0) baseline = rs[0].top + (rs[0].height - (masc + mdsc)) / 2 + masc;
  }

  // list-style-position:outside (default) → marker sits just left of the content box
  const markerX = (cs.listStylePosition || 'outside') === 'inside'
    ? r.left + num(cs.paddingLeft)
    : r.left - markerW - 2;

  const markerColor = ctx.normColor(ms.color || cs.color);
  if (transparent(markerColor)) return;

  ctx.nodes.push({
    kind: 'text',
    id: ctx.nid(),
    rect: { x: markerX, y: r.top, width: markerW, height: markerFontSize },
    opacity,
    clip,
    lines: [{ text: markerText, x: markerX, baseline }],
    fontFamily: ms.fontFamily || cs.fontFamily,
    fontSize: markerFontSize,
    fontWeight: ms.fontWeight || cs.fontWeight,
    fontStyle: ms.fontStyle || cs.fontStyle,
    color: markerColor,
    letterSpacing: 0,
    wordSpacing: 0,
    decoration: null,
  });
};

// Bucket each character of a text node into visual lines, keyed by rounded top,
// recording every character's left x. Shared by glyph-outline capture (needs the
// exact per-glyph xs) and the multi-line fallback (needs the leftmost x). Returns
// buckets sorted top→bottom; each bucket always has ≥1 char.
export const bucketCharsByLine = (ctx: CaptureCtx, child: ChildNode, raw: string) => {
  const buckets = new Map<number, { chars: string[]; xs: number[]; top: number; height: number }>();
  for (let i = 0; i < raw.length; i++) {
    const cr = ctx.doc.createRange();
    cr.setStart(child, i);
    cr.setEnd(child, i + 1);
    const rb = cr.getBoundingClientRect();
    if (rb.width === 0 && rb.height === 0) continue;
    const key = Math.round(rb.top);
    let b = buckets.get(key);
    if (!b) {
      b = { chars: [], xs: [], top: rb.top, height: rb.height };
      buckets.set(key, b);
    }
    b.chars.push(raw[i]);
    b.xs.push(rb.left);
  }
  return Array.from(buckets.values()).sort((a, c) => a.top - c.top);
};

// Effective uniform scale from ancestor CSS transforms (slide decks, zoomed previews):
// rects are post-transform but computed lengths (font-size, spacing) are not.
export const elScale = (ctx: CaptureCtx, el: Element): number => {
  const h = el as HTMLElement;
  const ow = h.offsetWidth, oh = h.offsetHeight;
  if (!ow || !oh || !(el instanceof ctx.win.HTMLElement)) return 1;
  const r = el.getBoundingClientRect();
  const sx = r.width / ow, sy = r.height / oh;
  // only trust a uniform, non-degenerate scale (rotations/skews are rastered elsewhere)
  if (Math.abs(sx - sy) > 0.01 || Math.abs(sx - 1) < 0.002 || sx <= 0.05 || sx > 20) return 1;
  return sx;
};

// value / placeholder of a vectorizable <input>: no text node exists, so synthesize one line
export const captureInputText = (ctx: CaptureCtx, el: HTMLInputElement, cs: CSSStyleDeclaration, clip: Clip | null, opacity: number) => {
  const sc = elScale(ctx, el);
  const isPh = !el.value;
  const raw = isPh ? el.placeholder || '' : el.type === 'password' ? '\u2022'.repeat(el.value.length) : el.value;
  if (!raw) return;
  const ps = isPh ? ctx.win.getComputedStyle(el, '::placeholder') : cs;
  const fontSize = num(cs.fontSize) * sc;
  if (fontSize <= 0) return;
  const r = el.getBoundingClientRect();
  const bl = num(cs.borderLeftWidth) * sc, br = num(cs.borderRightWidth) * sc, bt = num(cs.borderTopWidth) * sc, bb = num(cs.borderBottomWidth) * sc;
  const cx = r.left + bl + num(cs.paddingLeft) * sc, cy0 = r.top + bt + num(cs.paddingTop) * sc;
  const cw = r.width - bl - br - (num(cs.paddingLeft) + num(cs.paddingRight)) * sc;
  const ch = r.height - bt - bb - (num(cs.paddingTop) + num(cs.paddingBottom)) * sc;
  if (cw <= 0 || ch <= 0) return;
  ctx.mctx.font = `${cs.fontStyle} ${cs.fontWeight} ${fontSize}px ${cs.fontFamily}`;
  const fm = ctx.mctx.measureText('Mg');
  const ascent = (fm as any).fontBoundingBoxAscent || fontSize * 0.8;
  const descent = (fm as any).fontBoundingBoxDescent || fontSize * 0.2;
  const ls = cs.letterSpacing === 'normal' ? 0 : num(cs.letterSpacing) * sc;
  let shown = raw;
  let textW = ctx.mctx.measureText(raw).width + ls * raw.length;
  if (textW > cw && cs.textOverflow === 'ellipsis') {
    // same truncation as the browser: longest prefix that fits next to the ellipsis
    const ell = '\u2026', ellW = ctx.mctx.measureText(ell).width;
    let lo = 0, hi = raw.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.mctx.measureText(raw.slice(0, mid)).width + ls * mid + ellW <= cw) lo = mid; else hi = mid - 1;
    }
    shown = raw.slice(0, lo) + ell;
    textW = ctx.mctx.measureText(shown).width + ls * shown.length;
  }
  const align = cs.textAlign;
  const x = align === 'center' ? cx + (cw - textW) / 2 : align === 'right' || align === 'end' ? cx + cw - textW : cx;
  const baseline = cy0 + (ch - (ascent + descent)) / 2 + ascent;
  const color = ctx.normColor(isPh ? ps.color : cs.color);
  if (transparent(color)) return;
  ctx.nodes.push({
    kind: 'text',
    id: ctx.nid(),
    rect: { x, y: baseline - ascent, width: textW, height: ascent + descent },
    opacity: opacity * (isPh ? num(ps.opacity || '1') : 1),
    clip: intersect(clip, { x: cx, y: cy0, width: cw, height: ch, radii: [0, 0, 0, 0] }),
    lines: [{ text: shown, x, baseline }],
    fontFamily: cs.fontFamily,
    fontSize,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    color,
    letterSpacing: ls,
    wordSpacing: 0,
    preserveSpace: true,
  } as PaintNode);
};

// font properties that alter glyph choice/metrics but aren't part of the SVG presentation attrs
export const fontExtraOf = (cs: CSSStyleDeclaration): string => {
  const d: string[] = [];
  const add = (prop: string, v: string | undefined, dflt: string) => { if (v && v !== dflt) d.push(`${prop}:${v}`); };
  add('font-feature-settings', cs.fontFeatureSettings, 'normal');
  add('font-variation-settings', cs.fontVariationSettings, 'normal');
  add('font-stretch', cs.fontStretch, '100%');
  add('font-kerning', cs.fontKerning, 'auto');
  add('font-optical-sizing', (cs as any).fontOpticalSizing, 'auto');
  add('font-variant-ligatures', cs.fontVariantLigatures, 'normal');
  add('font-variant-numeric', cs.fontVariantNumeric, 'normal');
  add('text-rendering', cs.textRendering, 'auto');
  return d.join(';');
};

// checkbox / radio / select / textarea: the box comes from emitBox (computed bg/border); here we add what
// Chrome paints natively — check glyphs, the select's selected text + chevron, textarea wrapped lines.
export const captureNative = (ctx: CaptureCtx, kind: 'check' | 'select' | 'textarea', el: Element, cs: CSSStyleDeclaration, clip: Clip | null, opacity: number) => {
  const r = el.getBoundingClientRect();
  const auto = cs.appearance !== 'none';
  const svg = (rect: { x: number; y: number; width: number; height: number }, inner: string) => ctx.nodes.push({
    kind: 'inline-svg', id: ctx.nid(), rect, opacity, clip,
    markup: `<svg xmlns="http://www.w3.org/2000/svg" x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" viewBox="0 0 ${rect.width} ${rect.height}" overflow="visible">${inner}</svg>`,
  } as PaintNode);
  if (kind === 'check') {
    if (!auto) return; // author-drawn: emitBox already painted the checked/unchecked styles
    const inp = el as HTMLInputElement;
    const w = r.width, h = r.height, dis = inp.disabled;
    const ac = (cs as any).accentColor;
    const accent = dis ? 'rgba(16,16,16,0.3)' : ac && ac !== 'auto' ? ctx.normColor(ac) : 'rgb(0, 117, 255)';
    const on = inp.checked || (inp.type === 'checkbox' && inp.indeterminate);
    const stroke = dis ? 'rgba(118,118,118,0.3)' : 'rgb(118,118,118)';
    const fill = dis ? 'rgba(239,239,239,0.3)' : '#fff';
    const round = inp.type === 'radio';
    const sh = (f: string, s: string, sw: number) => round
      ? `<circle cx="${w / 2}" cy="${h / 2}" r="${(Math.min(w, h) - sw) / 2}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`
      : `<rect x="${sw / 2}" y="${sw / 2}" width="${w - sw}" height="${h - sw}" rx="2" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
    let inner: string;
    if (!on) inner = sh(fill, stroke, 1);
    else if (round) inner = sh(dis ? 'rgba(239,239,239,0.3)' : '#fff', accent, 1) + `<circle cx="${w / 2}" cy="${h / 2}" r="${w * 0.27}" fill="${accent}"/>`;
    else inner = `<rect width="${w}" height="${h}" rx="2" fill="${accent}"/>` + (inp.indeterminate && !inp.checked
      ? `<rect x="${w * 0.22}" y="${h / 2 - 1}" width="${w * 0.56}" height="2" fill="#fff"/>`
      : `<path d="M${w * 0.2} ${h * 0.5} L${w * 0.42} ${h * 0.72} L${w * 0.8} ${h * 0.28}" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`);
    svg({ x: r.left, y: r.top, width: w, height: h }, inner);
    return;
  }
  const sc = elScale(ctx, el);
  const bl = num(cs.borderLeftWidth) * sc, br = num(cs.borderRightWidth) * sc, bt = num(cs.borderTopWidth) * sc, bb = num(cs.borderBottomWidth) * sc;
  const padL = num(cs.paddingLeft) * sc, padR = num(cs.paddingRight) * sc, padT = num(cs.paddingTop) * sc, padB = num(cs.paddingBottom) * sc;
  if (kind === 'select') {
    const sel = el as HTMLSelectElement;
    const raw = sel.selectedOptions[0]?.text || '';
    const fontSize = num(cs.fontSize) * sc;
    const color = ctx.normColor(cs.color);
    if (auto) { // Chrome's menulist: chevron at the right edge
      const cx = r.right - br - 10 * sc, cy = r.top + r.height / 2;
      svg({ x: cx - 6 * sc, y: cy - 6 * sc, width: 12 * sc, height: 12 * sc },
        `<path d="M${6 - 3.2 * sc} ${6 - 1.6 * sc} L6 ${6 + 1.6 * sc} L${6 + 3.2 * sc} ${6 - 1.6 * sc}" fill="none" stroke="${color}" stroke-width="${1.5 * sc}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    if (!raw || fontSize <= 0 || transparent(color)) return;
    const left = r.left + bl + (auto ? Math.max(padL, 4 * sc) : padL);
    const cw = r.right - br - (auto ? Math.max(padR, 14 * sc) : padR) - left;
    const cy0 = r.top + bt + padT, ch = r.height - bt - bb - padT - padB;
    if (cw <= 0 || ch <= 0) return;
    ctx.mctx.font = `${cs.fontStyle} ${cs.fontWeight} ${fontSize}px ${cs.fontFamily}`;
    const fm = ctx.mctx.measureText('Mg');
    const ascent = (fm as any).fontBoundingBoxAscent || fontSize * 0.8;
    const descent = (fm as any).fontBoundingBoxDescent || fontSize * 0.2;
    const text = cs.textTransform === 'uppercase' ? raw.toUpperCase() : cs.textTransform === 'lowercase' ? raw.toLowerCase() : raw;
    const textW = ctx.mctx.measureText(text).width;
    const baseline = cy0 + (ch - (ascent + descent)) / 2 + ascent;
    ctx.nodes.push({
      kind: 'text', id: ctx.nid(), rect: { x: left, y: baseline - ascent, width: textW, height: ascent + descent },
      opacity, clip: intersect(clip, { x: left, y: cy0, width: cw, height: ch, radii: [0, 0, 0, 0] }),
      lines: [{ text, x: left, baseline }], fontFamily: cs.fontFamily, fontSize, fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle, color, letterSpacing: cs.letterSpacing === 'normal' ? 0 : num(cs.letterSpacing) * sc,
      wordSpacing: 0, preserveSpace: true,
    } as PaintNode);
    return;
  }
  // textarea: resize grip (two short diagonals in the bottom-right corner), then the text
  if (auto && cs.resize !== 'none' && r.width > 20 && r.height > 20) {
    const gx = r.right - bl - 1, gy = r.bottom - bb - 1;
    svg({ x: gx - 10, y: gy - 10, width: 10, height: 10 },
      `<path d="M9 1 L1 9 M9 5 L5 9" fill="none" stroke="rgb(118,118,118)" stroke-width="1"/>`);
  }
  // textarea: lay the value out in a throw-away mirror <div> with the same computed style, then capture it
  const ta = el as HTMLTextAreaElement;
  const isPh = !ta.value;
  const content = isPh ? ta.placeholder : ta.value;
  if (!content) return;
  const cl = r.left + bl + padL, ct = r.top + bt + padT;
  const cw = ta.clientWidth * sc - padL - padR, ch = ta.clientHeight * sc - padT - padB;
  if (cw <= 0 || ch <= 0) return;
  const mir = ctx.doc.createElement('div');
  for (let i = 0; i < cs.length; i++) mir.style.setProperty(cs[i], cs.getPropertyValue(cs[i]));
  const ps = isPh ? ctx.win.getComputedStyle(el, '::placeholder') : cs;
  const mset = (k: string, v: string) => mir.style.setProperty(k, v, 'important');
  mset('position', 'fixed'); mset('left', cl / sc + 'px'); mset('top', (ct - ta.scrollTop * sc) / sc + 'px');
  mset('margin', '0'); mset('border', '0'); mset('padding', '0'); mset('box-sizing', 'content-box');
  mset('width', (cw / sc) + 'px'); mset('height', 'auto'); mset('min-height', '0'); mset('max-height', 'none');
  mset('overflow', 'visible'); mset('background', 'none'); mset('box-shadow', 'none'); mset('outline', 'none');
  mset('transform', 'none'); mset('translate', 'none'); mset('rotate', 'none'); mset('scale', 'none'); mset('resize', 'none');
  mset('display', 'block'); mset('animation', 'none'); mset('transition', 'none'); mset('appearance', 'none');
  mset('white-space', cs.whiteSpace === 'pre' ? 'pre' : 'pre-wrap'); mset('overflow-wrap', cs.whiteSpace === 'pre' ? 'normal' : 'break-word');
  mset('color', ps.color); mset('-webkit-text-fill-color', ps.color); mset('opacity', '1');
  mir.textContent = content;
  ctx.doc.documentElement.appendChild(mir);
  try {
    const mcs = ctx.win.getComputedStyle(mir);
    captureText(ctx, mir, mcs, intersect(clip, { x: cl, y: ct, width: cw, height: ch, radii: [0, 0, 0, 0] }), opacity * (isPh ? num(ps.opacity || '1') : 1));
  } finally { mir.remove(); }
};

export const captureText = (ctx: CaptureCtx, el: Element, cs: CSSStyleDeclaration, clip: Clip | null, opacity: number) => {
  if (emptyClip(clip)) return;
  const nc = nativeControl(el);
  if (nc) { captureNative(ctx, nc, el, cs, clip, opacity); return; }
  if (el.tagName === 'INPUT' && vectorTextInput(el, cs)) {
    captureInputText(ctx, el as HTMLInputElement, cs, clip, opacity);
    return;
  }
  const sc = elScale(ctx, el);
  const fontSize = num(cs.fontSize) * sc;
  if (fontSize <= 0) return;
  ctx.mctx.font = `${cs.fontStyle} ${cs.fontWeight} ${fontSize}px ${cs.fontFamily}`;
  const fm = ctx.mctx.measureText('Mg');
  const ascent = (fm as any).fontBoundingBoxAscent || fontSize * 0.8;
  const descent = (fm as any).fontBoundingBoxDescent || fontSize * 0.2;
  const ls = cs.letterSpacing === 'normal' ? 0 : num(cs.letterSpacing) * sc;
  const ws = cs.wordSpacing === 'normal' ? 0 : num(cs.wordSpacing) * sc;
  const decoration =
    cs.textDecorationLine && cs.textDecorationLine !== 'none' ? cs.textDecorationLine : null;
  // glyphs are measured from the rendered (transformed) text, so the stored
  // string must be transformed too (MUI buttons/tabs use text-transform:uppercase)
  const tt = cs.textTransform;
  const xform = (s: string) =>
    tt === 'uppercase'
      ? s.toUpperCase()
      : tt === 'lowercase'
        ? s.toLowerCase()
        : tt === 'capitalize'
          ? s.replace(/(^|\s)(\S)/g, (_m, p, c) => p + c.toUpperCase())
          : s;

  // white-space: pre / pre-wrap / break-spaces keep runs of spaces (code blocks, <pre>)
  const preserveSpace = /^(pre|pre-wrap|break-spaces)$/.test(cs.whiteSpace);
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType !== Node.TEXT_NODE) continue;
    const raw = child.textContent || '';
    if (!raw.trim()) continue;
    const range = ctx.doc.createRange();
    range.selectNodeContents(child);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (rects.length === 0) continue;

    const lines: { text: string; x: number; baseline: number; glyphX?: number[] }[] = [];
    if (ctx.collectGlyphX) {
      // capture each glyph's exact x so outline mode matches the browser's
      // shaping (kerning/hinting) instead of accumulating advance-width drift
      for (const b of bucketCharsByLine(ctx, child, raw)) {
        const baseline = b.top + (b.height - (ascent + descent)) / 2 + ascent;
        lines.push({ text: xform(b.chars.join('')), x: b.xs[0], baseline, glyphX: b.xs });
      }
    } else if (rects.length === 1) {
      const r = rects[0];
      let text = xform(preserveSpace ? raw.replace(/[\r\n]+$/, '') : raw.replace(/\s+/g, ' ').trim());
      // The rect starts at the collapsed leading space (e.g. " {" after an inline
      // sibling); the trimmed text must start where its first glyph is drawn.
      let left = r.left;
      if (!preserveSpace) {
        const lead = raw.search(/\S/);
        if (lead > 0) {
          const cr = ctx.doc.createRange();
          cr.setStart(child, lead);
          cr.setEnd(child, lead + 1);
          const rb = cr.getBoundingClientRect();
          if (rb.width > 0) left = rb.left;
        }
      }
      // Reproduce CSS text-overflow:ellipsis — the DOM always contains the full text
      // but the browser visually truncates it with "..." when overflow is hidden.
      if (
        cs.textOverflow === 'ellipsis' &&
        (cs.overflow === 'hidden' || cs.overflowX === 'hidden') &&
        (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth
      ) {
        const maxW = (el as HTMLElement).clientWidth - num(cs.paddingLeft) - num(cs.paddingRight);
        const ellipsis = '...';
        const ellipsisW = ctx.mctx.measureText(ellipsis).width + ls * Math.max(0, ellipsis.length - 1);
        // Binary search for the longest prefix that fits alongside the ellipsis.
        let lo = 0;
        let hi = text.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          const w = ctx.mctx.measureText(text.slice(0, mid)).width + ls * Math.max(0, mid - 1);
          if (w + ellipsisW <= maxW) lo = mid;
          else hi = mid - 1;
        }
        text = text.slice(0, lo) + ellipsis;
      }
      const baseline = r.top + (r.height - (ascent + descent)) / 2 + ascent;
      lines.push({ text, x: left, baseline });
    } else {
      // multi-line: bucket characters to lines via per-char ranges
      for (const b of bucketCharsByLine(ctx, child, raw)) {
        const joined = b.chars.join('');
        const text = xform(preserveSpace ? joined.replace(/[\r\n]+$/, '') : joined.replace(/\s+/g, ' ').trim());
        if (!text.trim()) continue;
        // leftmost x of the first kept glyph (skips collapsed leading whitespace)
        const first = preserveSpace ? 0 : joined.search(/\S/);
        const left = preserveSpace
          ? b.xs.reduce((m, v) => Math.min(m, v), Infinity)
          : b.xs[Math.max(0, first)];
        const baseline = b.top + (b.height - (ascent + descent)) / 2 + ascent;
        lines.push({ text, x: left, baseline });
      }
    }
    if (lines.length === 0) continue;

    // A transparent text fill reveals the background clipped to the glyphs.
    // Preserve both gradient headings and solid background colors.
    let textColor = ctx.normColor(cs.webkitTextFillColor || cs.color);
    let gradientFill = null;
    let gradientRect;
    // Background clipping includes descendant glyphs even when nested spans
    // inherit transparent text fill without inheriting the background itself.
    let backgroundEl: Element | null = null;
    let backgroundStyle = cs;
    if (transparent(textColor)) {
      for (let candidate: Element | null = el; candidate; candidate = candidate.parentElement) {
        const style = candidate === el ? cs : ctx.win.getComputedStyle(candidate);
        const clip = style.backgroundClip || (style as any).webkitBackgroundClip;
        if ((clip === 'text' || clip === '-webkit-text') &&
            (!transparent(style.backgroundColor) || style.backgroundImage !== 'none')) {
          backgroundEl = candidate;
          backgroundStyle = style;
          break;
        }
      }
    }
    if (backgroundEl) {
      const bg = backgroundStyle;
      const grad = bg.backgroundImage && bg.backgroundImage !== 'none'
        ? ctx.parseFirstLinearGradient(bg.backgroundImage)
        : null;
      if (grad) {
        gradientFill = grad;
        // CSS gradients are sized against the background positioning area,
        // not the first line's text bounds. Preserve that area across wraps.
        const r = backgroundEl.getBoundingClientRect();
        const origin = bg.backgroundOrigin;
        const borderBox = origin === 'border-box';
        const contentBox = origin === 'content-box';
        const left = (borderBox ? 0 : num(bg.borderLeftWidth)) + (contentBox ? num(bg.paddingLeft) : 0);
        const right = (borderBox ? 0 : num(bg.borderRightWidth)) + (contentBox ? num(bg.paddingRight) : 0);
        const top = (borderBox ? 0 : num(bg.borderTopWidth)) + (contentBox ? num(bg.paddingTop) : 0);
        const bottom = (borderBox ? 0 : num(bg.borderBottomWidth)) + (contentBox ? num(bg.paddingBottom) : 0);
        gradientRect = {
          x: r.left + left, y: r.top + top,
          width: Math.max(0, r.width - left - right),
          height: Math.max(0, r.height - top - bottom),
        };
        // Solid fallback: midpoint stop color for renderers that ignore gradientFill.
        textColor = grad.stops[Math.floor(grad.stops.length / 2)].color;
      } else if (!bg.backgroundImage || bg.backgroundImage === 'none') {
        textColor = ctx.normColor(bg.backgroundColor);
      }
    }

    ctx.nodes.push({
      kind: 'text',
      id: ctx.nid(),
      rect: { x: rects[0].left, y: rects[0].top, width: rects[0].width, height: rects[0].height },
      opacity,
      clip,
      lines,
      fontFamily: cs.fontFamily,
      fontSize,
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
      color: textColor,
      letterSpacing: ls,
      wordSpacing: ws,
      decoration,
      preserveSpace: preserveSpace || undefined,
      fontExtra: fontExtraOf(cs) || undefined,
      decorationColor: ctx.normColor(cs.textDecorationColor || cs.color),
      gradientFill,
      gradientRect,
    });
  }
};
