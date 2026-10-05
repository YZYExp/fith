/**
 * In-page DOM rasterizer: renders a live element to a PNG data URL without a
 * screenshot, by cloning it with every computed style inlined into an SVG
 * <foreignObject> and drawing that SVG onto a canvas. This is the fallback for
 * regions the vector pipeline cannot express (filters, 3D transforms, blend
 * modes, inset shadows, canvas/video, …) when no screenshot backend is
 * available — pure in-page use, or an extension without the `debugger`
 * permission / for regions outside the visible viewport.
 *
 * Everything the SVG-as-image sandbox cannot load on its own is embedded first:
 * <img>/background/mask images become data URIs, used @font-face files are
 * inlined, ::before/::after become real elements, canvases become <img>s, shadow
 * roots are flattened, position:fixed is converted to absolute.
 *
 * Limits (returns null rather than a wrong picture): cross-origin resources the
 * page cannot fetch are dropped (the rest still renders), iframes render empty,
 * and subtrees over MAX_NODES elements are refused to avoid stalling the page.
 */
import type { Rect } from '../../core/ir/types.js';

const MAX_NODES = 3000;
const XHTML = 'http://www.w3.org/1999/xhtml';

export interface DomRasterizer {
  (el: Element, crop: Rect, scale: number): Promise<string | null>;
}

export function createDomRasterizer(): DomRasterizer {
  const urlCache = new Map<string, Promise<string | null>>();

  const blobToDataUrl = (blob: Blob) =>
    new Promise<string | null>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });

  const toDataUrl = (url: string): Promise<string | null> => {
    if (!url || url === 'about:blank') return Promise.resolve(null);
    if (url.startsWith('data:')) return Promise.resolve(url);
    let p = urlCache.get(url);
    if (!p) {
      p = (async () => {
        try {
          const res = await fetch(url, { cache: 'force-cache' });
          return res.ok ? await blobToDataUrl(await res.blob()) : null;
        } catch {
          return null;
        }
      })();
      urlCache.set(url, p);
    }
    return p;
  };

  // Replace every url(...) in a CSS value with an embedded data URI (or `none` if
  // it cannot be fetched, so a dead image doesn't poison the whole declaration).
  const inlineCssUrls = async (value: string): Promise<string> => {
    const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    const found = Array.from(value.matchAll(re));
    if (found.length === 0) return value;
    let out = value;
    for (const m of found) {
      const data = await toDataUrl(m[2].replace(/\\(["'])/g, '$1'));
      out = out.replace(m[0], data ? `url("${data}")` : 'none');
    }
    return out;
  };

  const URL_PROPS = new Set([
    'background-image',
    'mask-image',
    '-webkit-mask-image',
    'border-image-source',
    'list-style-image',
    'content',
  ]);
  const SKIP_PROPS = new Set(['animation', 'transition', 'cursor', 'pointer-events']);

  // Copy the computed style of `src` (or one of its pseudo-elements) onto `dst`.
  const copyStyle = async (src: Element, dst: HTMLElement, pseudo?: '::before' | '::after') => {
    const cs = getComputedStyle(src, pseudo);
    for (let i = 0; i < cs.length; i++) {
      const prop = cs[i];
      if (SKIP_PROPS.has(prop) || prop.startsWith('animation-') || prop.startsWith('transition-')) continue;
      let v = cs.getPropertyValue(prop);
      if (URL_PROPS.has(prop) && v.includes('url(')) v = await inlineCssUrls(v);
      dst.style.setProperty(prop, v, cs.getPropertyPriority(prop));
    }
    dst.style.setProperty('animation', 'none');
    dst.style.setProperty('transition', 'none');
    return cs;
  };

  const families = new Set<string>();
  let nodeCount = 0;

  const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '');
  const noteFonts = (cs: CSSStyleDeclaration) => {
    for (const f of cs.fontFamily.split(',')) families.add(unquote(f));
  };

  // Resolve a pseudo-element's `content` into a node to insert, or null for none.
  const pseudoContent = async (host: Element, cs: CSSStyleDeclaration): Promise<Node | null> => {
    const c = cs.content;
    if (!c || c === 'none' || c === 'normal') return null;
    const str = c.match(/^(["'])([\s\S]*)\1$/);
    if (str) {
      return document.createTextNode(
        str[2]
          .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
          .replace(/\\([\s\S])/g, '$1'),
      );
    }
    const url = c.match(/^url\(\s*(['"]?)([^'")]+)\1\s*\)$/);
    if (url) {
      const data = await toDataUrl(url[2]);
      if (!data) return null;
      const img = document.createElement('img');
      img.setAttribute('src', data);
      return img;
    }
    const attr = c.match(/^attr\(([^)]+)\)$/);
    if (attr) return document.createTextNode(host.getAttribute(attr[1].trim()) ?? '');
    return null; // counters / quotes: leave empty (box still renders)
  };

  const cloneTree = async (src: Node, root: Element, rootRect: DOMRect): Promise<Node | null> => {
    if (src.nodeType === Node.TEXT_NODE) return document.createTextNode(src.textContent || '');
    if (src.nodeType !== Node.ELEMENT_NODE) return null;
    const el = src as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'noscript' || tag === 'style' || tag === 'link') return null;
    const cs0 = getComputedStyle(el);
    if (cs0.display === 'none') return null;
    if (++nodeCount > MAX_NODES) throw new Error('subtree too large');

    const isSvgEl = el instanceof SVGElement;
    let out: HTMLElement | SVGElement;
    if (tag === 'canvas') {
      const img = document.createElement('img');
      try {
        img.setAttribute('src', (el as HTMLCanvasElement).toDataURL('image/png'));
      } catch {
        /* tainted: leave blank */
      }
      out = img;
    } else if (tag === 'video') {
      const img = document.createElement('img');
      try {
        const v = el as HTMLVideoElement;
        const c = document.createElement('canvas');
        c.width = v.videoWidth || v.clientWidth;
        c.height = v.videoHeight || v.clientHeight;
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
        img.setAttribute('src', c.toDataURL('image/png'));
      } catch {
        /* cross-origin / not decoded: leave blank */
      }
      out = img;
    } else if (tag === 'iframe' || tag === 'object' || tag === 'embed') {
      out = document.createElement('div'); // can't embed another document
    } else if (isSvgEl) {
      out = el.cloneNode(false) as SVGElement;
    } else {
      out = document.createElement(tag) as HTMLElement;
      for (const a of Array.from(el.attributes)) {
        if (/^on/i.test(a.name) || a.name === 'style' || a.name === 'srcset' || a.name === 'loading') continue;
        try {
          out.setAttribute(a.name, a.value);
        } catch {
          /* invalid attribute name for XML: skip */
        }
      }
    }

    if (tag === 'img') {
      const data = await toDataUrl((el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src);
      if (data) out.setAttribute('src', data);
      else out.removeAttribute('src');
    } else if (tag === 'input') {
      const inp = el as HTMLInputElement;
      if (inp.type === 'password') out.setAttribute('value', '•'.repeat(inp.value.length));
      else out.setAttribute('value', inp.value);
      if (inp.checked) out.setAttribute('checked', '');
    } else if (tag === 'option') {
      if ((el as HTMLOptionElement).selected) out.setAttribute('selected', '');
    }

    const cs = await copyStyle(el, out as HTMLElement);
    noteFonts(cs);
    const o = out as HTMLElement;
    if (el === root) {
      // The root is placed by the wrapper; its own opacity is applied by the scene node.
      o.style.setProperty('opacity', '1');
      o.style.setProperty('margin', '0');
    } else if (cs.position === 'fixed' || cs.position === 'sticky') {
      // fixed/sticky resolve against the (sandboxed) viewport in the clone: pin to
      // the element's measured position inside the root box instead.
      const r = el.getBoundingClientRect();
      o.style.setProperty('position', 'absolute');
      o.style.setProperty('left', r.left - rootRect.left + 'px');
      o.style.setProperty('top', r.top - rootRect.top + 'px');
      o.style.setProperty('right', 'auto');
      o.style.setProperty('bottom', 'auto');
      o.style.setProperty('margin', '0');
    }

    if (tag === 'textarea') {
      out.textContent = (el as HTMLTextAreaElement).value;
      return out;
    }
    if (tag === 'canvas' || tag === 'video' || tag === 'img' || tag === 'iframe' || tag === 'object' || tag === 'embed')
      return out;

    // ::before content first
    if (!isSvgEl) {
      const bcs = getComputedStyle(el, '::before');
      const bContent = await pseudoContent(el, bcs);
      if (bContent && bcs.display !== 'none') {
        const span = document.createElement('span');
        await copyStyle(el, span, '::before');
        noteFonts(bcs);
        span.appendChild(bContent);
        out.appendChild(span);
      }
    }

    // children (flattening an open shadow root and its slots)
    const kids = async (parent: Node) => {
      for (const child of Array.from(parent.childNodes)) {
        if (child instanceof HTMLSlotElement) {
          const assigned = child.assignedNodes({ flatten: true });
          if (assigned.length) for (const a of assigned) await add(a);
          else await kids(child);
        } else await add(child);
      }
    };
    const add = async (child: Node) => {
      const c = await cloneTree(child, root, rootRect);
      if (c) out.appendChild(c);
    };
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) await kids(shadow);
    else await kids(el);

    if (!isSvgEl) {
      const acs = getComputedStyle(el, '::after');
      const aContent = await pseudoContent(el, acs);
      if (aContent && acs.display !== 'none') {
        const span = document.createElement('span');
        await copyStyle(el, span, '::after');
        noteFonts(acs);
        span.appendChild(aContent);
        out.appendChild(span);
      }
    }
    return out;
  };

  // @font-face rules for the families actually used, with font files embedded.
  const fontCss = async (): Promise<string> => {
    const out: string[] = [];
    const visit = async (rules: CSSRuleList, against: string) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSFontFaceRule) {
          const fam = unquote(rule.style.getPropertyValue('font-family'));
          if (!families.has(fam)) continue;
          let src = rule.style.getPropertyValue('src');
          const urls = Array.from(src.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g));
          for (const m of urls) {
            let abs = m[2];
            try {
              abs = new URL(m[2], against).href;
            } catch {
              /* keep as is */
            }
            const data = await toDataUrl(abs);
            src = src.replace(m[0], data ? `url("${data}")` : 'local("__fith_missing__")');
          }
          const props = ['font-weight', 'font-style', 'font-stretch', 'unicode-range', 'font-display']
            .map((p) => {
              const v = rule.style.getPropertyValue(p);
              return v ? `${p}:${v};` : '';
            })
            .join('');
          out.push(`@font-face{font-family:"${fam}";src:${src};${props}}`);
        } else if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) {
          await visit((rule as CSSGroupingRule).cssRules, against);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        await visit(sheet.cssRules, sheet.href || document.baseURI);
      } catch {
        /* cross-origin sheet: its fonts are unavailable */
      }
    }
    return out.join('\n');
  };

  // XML 1.0 forbids C0 controls and U+FFFE/U+FFFF. The noncharacters are built at
  // runtime: as regex literals the bundler would emit them raw, and Chrome refuses
  // to load an extension script containing them ("isn't UTF-8 encoded").
  const NONCHARS = new RegExp('[' + String.fromCharCode(0xfffe) + String.fromCharCode(0xffff) + ']', 'g');
  const stripXmlIllegal = (s: string) =>
    s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(NONCHARS, '');

  return async (el, crop, scale) => {
    const bb = el.getBoundingClientRect();
    if (bb.width <= 0 || bb.height <= 0 || crop.width <= 0 || crop.height <= 0) return null;
    families.clear();
    nodeCount = 0;
    try {
      const rootClone = (await cloneTree(el, el, bb)) as HTMLElement | null;
      if (!rootClone || rootClone.nodeType !== Node.ELEMENT_NODE) return null;

      const W = Math.ceil(bb.width);
      const H = Math.ceil(bb.height);
      const cs = getComputedStyle(el);
      const hasTransform = cs.transform && cs.transform !== 'none';
      // A transformed element's bounding box is larger than its layout box; centre
      // the layout box in it (default transform-origin) so the transform lands right.
      const he = el as HTMLElement;
      const lw = hasTransform ? he.offsetWidth || bb.width : bb.width;
      const lh = hasTransform ? he.offsetHeight || bb.height : bb.height;
      rootClone.style.setProperty('position', 'absolute');
      rootClone.style.setProperty('left', (hasTransform ? (bb.width - lw) / 2 : 0) + 'px');
      rootClone.style.setProperty('top', (hasTransform ? (bb.height - lh) / 2 : 0) + 'px');
      rootClone.style.setProperty('right', 'auto');
      rootClone.style.setProperty('bottom', 'auto');
      rootClone.style.setProperty('float', 'none');

      const wrap = document.createElement('div');
      wrap.setAttribute('xmlns', XHTML);
      wrap.style.cssText = `position:relative;width:${W}px;height:${H}px;overflow:visible;`;
      const fonts = await fontCss();
      if (fonts) {
        const st = document.createElement('style');
        st.textContent = fonts;
        wrap.appendChild(st);
      }
      wrap.appendChild(rootClone);

      const xml = stripXmlIllegal(new XMLSerializer().serializeToString(wrap));
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
        `<foreignObject x="0" y="0" width="${W}" height="${H}">${xml}</foreignObject></svg>`;

      const img = new Image();
      img.decoding = 'sync';
      const loaded = new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('svg image failed to load'));
      });
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await Promise.race([
        loaded,
        new Promise<void>((_, rej) => setTimeout(() => rej(new Error('timeout')), 15_000)),
      ]);

      const s = scale || 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(crop.width * s));
      canvas.height = Math.max(1, Math.round(crop.height * s));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.scale(s, s);
      ctx.drawImage(img, bb.left - crop.x, bb.top - crop.y, W, H);
      return canvas.toDataURL('image/png');
    } catch {
      return null; // too large, tainted canvas, load failure…
    }
  };
}
