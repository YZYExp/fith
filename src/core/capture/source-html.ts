/**
 * Source-HTML snapshot: serializes the *rendered* page (or one element together
 * with its ancestor chain) into a standalone, re-openable HTML document. Meant
 * for bug reports — when a capture looks wrong, the snapshot lets us reproduce
 * the exact DOM + CSS offline and add it as a test fixture.
 *
 * Like captureScene this runs INSIDE the page and is serialized via
 * `.toString()` for Playwright, so it must stay fully self-contained (no
 * imports, no module-level helpers).
 *
 * What the snapshot normalizes (so it renders without the original origin):
 *  - styles: every accessible stylesheet (incl. adopted + @import) is inlined as
 *    <style>, with relative url() rewritten to absolute; cross-origin sheets we
 *    cannot read stay as <link href=absolute>
 *  - <base href> pins relative URLs; <img> keeps its currentSrc
 *  - <canvas> becomes an <img> of its pixels; form control state becomes attributes
 *  - open shadow roots become declarative shadow DOM templates
 *  - scripts, inline event handlers and preload hints are removed
 *  - password values are dropped
 * A <meta name="fith-capture"> records viewport/dpr/scroll/UA so the page can be
 * re-rendered at the same size.
 *
 * PRIVACY: the snapshot contains the page's visible content. Callers must make
 * it an explicit opt-in and tell the user before sharing it.
 */
export function captureSourceHtml(root?: Element | null): string {
  const doc = document;
  const rootEl: Element = root ?? doc.documentElement;
  const subtree = rootEl !== doc.documentElement;
  const base = doc.baseURI;

  const abs = (u: string, against: string) => {
    try {
      return new URL(u, against).href;
    } catch {
      return u;
    }
  };

  // Rewrite relative url(...) in CSS text so the style survives being inlined
  // into a document with a different base.
  const rewriteUrls = (css: string, against: string) =>
    css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q: string, u: string) =>
      /^(data:|blob:|about:|#|https?:|\/\/)/i.test(u.trim()) ? m : `url(${q}${abs(u.trim(), against)}${q})`,
    );

  const sheetCss = (sheet: CSSStyleSheet, depth = 0): string | null => {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      return null; // cross-origin: not readable
    }
    const against = sheet.href || base;
    const out: string[] = [];
    for (const rule of Array.from(rules)) {
      if (rule.constructor.name === 'CSSImportRule' && depth < 5) {
        const imp = rule as CSSImportRule;
        const nested = imp.styleSheet ? sheetCss(imp.styleSheet, depth + 1) : null;
        if (nested !== null) {
          const media = imp.media?.mediaText;
          out.push(media && media !== 'all' ? `@media ${media}{${nested}}` : nested);
        } else {
          out.push(`@import url("${abs(imp.href, against)}");`);
        }
        continue;
      }
      out.push(rewriteUrls(rule.cssText, against));
    }
    return out.join('\n');
  };

  // ── build the clone ────────────────────────────────────────────────────────
  // Whole document → deep clone of <html>. Element → ancestor chain cloned
  // shallowly (tag + attributes only) so selectors like `.app .sidebar > a`
  // and html/body classes still match, plus the full <head>.
  let htmlClone: HTMLElement;
  let subClone: Element;
  if (!subtree) {
    htmlClone = doc.documentElement.cloneNode(true) as HTMLElement;
    subClone = htmlClone;
  } else {
    const chain: Element[] = [];
    for (let a: Element | null = rootEl.parentElement; a; a = a.parentElement) chain.unshift(a);
    htmlClone = chain[0].cloneNode(false) as HTMLElement;
    if (doc.head) htmlClone.appendChild(doc.head.cloneNode(true));
    // The ancestor shells lose their other children, so anything sized by those
    // siblings (e.g. `height: auto` around absolutely-positioned content) would
    // collapse offline. Pin each shell's original border-box size.
    const pinSize = (orig: Element, clone: Element) => {
      const cs = getComputedStyle(orig);
      if (cs.display === 'contents') return;
      const r = orig.getBoundingClientRect();
      const prev = clone.getAttribute('style');
      const decl = ['box-sizing:border-box', `width:${r.width}px`, `height:${r.height}px`, 'flex-shrink:0'];
      clone.setAttribute(
        'style',
        (prev ? prev.replace(/;?\s*$/, ';') : '') + decl.map((d) => d + ' !important').join(';'),
      );
      clone.setAttribute('data-fith-pinned', '');
    };
    pinSize(chain[0], htmlClone);
    let cur: Element = htmlClone;
    for (const a of chain.slice(1)) {
      const c = a.cloneNode(false) as Element;
      pinSize(a, c);
      cur.appendChild(c);
      cur = c;
    }
    subClone = rootEl.cloneNode(true) as Element;
    cur.appendChild(subClone);
  }

  const stripUnsafeAttrs = (c: Element) => {
    for (const attr of Array.from(c.attributes)) {
      if (/^on/i.test(attr.name)) c.removeAttribute(attr.name);
      else if ((attr.name === 'href' || attr.name === 'src') && /^\s*javascript:/i.test(attr.value))
        c.removeAttribute(attr.name);
    }
  };
  // ancestor shells (element mode) are outside the lockstep walk below
  if (subtree) for (let e: Element | null = subClone.parentElement; e; e = e.parentElement) stripUnsafeAttrs(e);

  // Serialize an open shadow root as declarative shadow DOM.
  const shadowTemplate = (host: Element): HTMLTemplateElement | null => {
    const sr = (host as HTMLElement).shadowRoot;
    if (!sr) return null;
    const tpl = doc.createElement('template');
    tpl.setAttribute('shadowrootmode', 'open');
    const holder = doc.createElement('div');
    for (const sheet of Array.from(sr.adoptedStyleSheets || [])) {
      const css = sheetCss(sheet);
      if (css) {
        const st = doc.createElement('style');
        st.textContent = css;
        holder.appendChild(st);
      }
    }
    for (const kid of Array.from(sr.childNodes)) holder.appendChild(kid.cloneNode(true));
    for (const s of Array.from(holder.querySelectorAll('script'))) s.remove();
    tpl.innerHTML = holder.innerHTML;
    return tpl;
  };

  // Lockstep walk: original element i ↔ clone element i (same subtree order).
  const origList = [rootEl, ...Array.from(rootEl.querySelectorAll('*'))];
  const cloneList = [subClone, ...Array.from(subClone.querySelectorAll('*'))];
  const n = Math.min(origList.length, cloneList.length);
  for (let i = 0; i < n; i++) {
    const o = origList[i];
    const c = cloneList[i];
    for (const attr of Array.from(c.attributes)) {
      if (/^on/i.test(attr.name)) c.removeAttribute(attr.name);
      else if ((attr.name === 'href' || attr.name === 'src') && /^\s*javascript:/i.test(attr.value))
        c.removeAttribute(attr.name);
    }
    const tag = o.tagName.toLowerCase();
    if (tag === 'canvas') {
      try {
        const img = doc.createElement('img');
        img.src = (o as HTMLCanvasElement).toDataURL('image/png');
        const r = o.getBoundingClientRect();
        img.setAttribute('width', String(Math.round(r.width)));
        img.setAttribute('height', String(Math.round(r.height)));
        img.className = (o as HTMLElement).className;
        const st = o.getAttribute('style');
        if (st) img.setAttribute('style', st);
        c.replaceWith(img);
      } catch {
        /* tainted canvas: keep the (blank) <canvas> element */
      }
    } else if (tag === 'img') {
      const src = (o as HTMLImageElement).currentSrc;
      if (src) {
        c.setAttribute('src', src);
        c.removeAttribute('srcset');
        c.removeAttribute('sizes');
      }
      c.removeAttribute('loading');
    } else if (tag === 'input') {
      const inp = o as HTMLInputElement;
      if (inp.type === 'password') c.setAttribute('value', '');
      else if (inp.type === 'checkbox' || inp.type === 'radio') {
        if (inp.checked) c.setAttribute('checked', '');
        else c.removeAttribute('checked');
      } else if (inp.type !== 'file') c.setAttribute('value', inp.value);
    } else if (tag === 'textarea') {
      c.textContent = (o as HTMLTextAreaElement).value;
    } else if (tag === 'option') {
      if ((o as HTMLOptionElement).selected) c.setAttribute('selected', '');
      else c.removeAttribute('selected');
    }
    const tpl = shadowTemplate(o);
    if (tpl) c.insertBefore(tpl, c.firstChild);
  }

  // ── head: drop scripts/preloads, inline styles, pin base, add metadata ────
  let head = htmlClone.querySelector('head');
  if (!head) {
    head = doc.createElement('head');
    htmlClone.insertBefore(head, htmlClone.firstChild);
  }
  for (const el of Array.from(htmlClone.querySelectorAll('script, noscript, base'))) el.remove();
  for (const el of Array.from(
    htmlClone.querySelectorAll(
      'link[rel~="preload"], link[rel~="modulepreload"], link[rel~="prefetch"], link[rel~="dns-prefetch"], link[rel~="preconnect"]',
    ),
  ))
    el.remove();
  // replace original <style>/<link rel=stylesheet> with the resolved sheets
  for (const el of Array.from(head.querySelectorAll('style, link[rel~="stylesheet"]'))) el.remove();
  const styleNodes: Element[] = [];
  const sheets = [...Array.from(doc.styleSheets), ...Array.from(doc.adoptedStyleSheets || [])];
  for (const sheet of sheets) {
    if (sheet.disabled) continue;
    const css = sheetCss(sheet);
    const media = sheet.media?.mediaText;
    if (css !== null) {
      const st = doc.createElement('style');
      st.setAttribute('data-fith-inlined', sheet.href || '');
      if (media && media !== 'all') st.setAttribute('media', media);
      st.textContent = css;
      styleNodes.push(st);
    } else if (sheet.href) {
      const ln = doc.createElement('link');
      ln.setAttribute('rel', 'stylesheet');
      ln.setAttribute('href', sheet.href);
      if (media && media !== 'all') ln.setAttribute('media', media);
      styleNodes.push(ln);
    }
  }

  const metaInfo = {
    url: location.href,
    title: doc.title,
    capturedAt: new Date().toISOString(),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio || 1,
    scroll: { x: window.scrollX, y: window.scrollY },
    documentSize: {
      width: doc.documentElement.scrollWidth,
      height: doc.documentElement.scrollHeight,
    },
    userAgent: navigator.userAgent,
    colorScheme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    scope: subtree ? 'element' : 'document',
    element: subtree ? rootEl.tagName.toLowerCase() : null,
    elementRect: subtree
      ? (() => {
          const r = rootEl.getBoundingClientRect();
          return { x: r.left, y: r.top, width: r.width, height: r.height };
        })()
      : null,
  };
  const meta = doc.createElement('meta');
  meta.setAttribute('name', 'fith-capture');
  meta.setAttribute('content', JSON.stringify(metaInfo));
  const baseEl = doc.createElement('base');
  baseEl.setAttribute('href', base);
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  head.insertBefore(meta, head.firstChild);
  head.insertBefore(baseEl, head.firstChild);
  head.insertBefore(charset, head.firstChild);
  for (const el of styleNodes) head.appendChild(el);

  const dt = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : '<!DOCTYPE html>';
  return `${dt}\n<!-- fith source snapshot of ${location.href.replace(/--/g, '%2D%2D')} -->\n${htmlClone.outerHTML}`;
}
