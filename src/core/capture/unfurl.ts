/**
 * Temporary changes a capture makes to the page so content that is scrolled out of view is measured, and
 * how they are undone. Each function returns its own `restore`, safe to call more than once.
 */

type Win = Window & typeof globalThis;

// Element export of scrollable content ("unfurl"): a picked container (or one
// nested inside it, e.g. a sidebar's session list) only shows its viewport-sized
// window, so the export would silently drop everything scrolled out of view.
// Temporarily let every vertically-scrolling container grow to its full content
// height — and release the fixed-height / flex-constrained ancestors up to the
// root — so the root's own box (and thus the export) covers all of it. Inline
// styles and scroll positions are put back by the function this returns.
export function unfurlScrollContainers(win: Win, rootEl: Element): () => void {
  const unfurlSaved: { el: HTMLElement; style: string | null }[] = [];
  const unfurlScroll: { el: HTMLElement; top: number; left: number }[] = [];
  const scrollers: HTMLElement[] = [];
  for (const el of [rootEl, ...Array.from(rootEl.querySelectorAll('*'))]) {
    const h = el as HTMLElement;
    if (!(h instanceof win.HTMLElement)) continue;
    const oy = win.getComputedStyle(h).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && h.scrollHeight > h.clientHeight + 1) scrollers.push(h);
  }
  const touched = new Set<HTMLElement>();
  for (const sc of scrollers) {
    unfurlScroll.push({ el: sc, top: sc.scrollTop, left: sc.scrollLeft });
    for (let a: HTMLElement | null = sc; a; a = a.parentElement) {
      touched.add(a);
      if (a === rootEl) break;
    }
  }
  for (const el of touched) {
    const original = el.getAttribute('style');
    unfurlSaved.push({ el, style: original });
    const parentFlex = el.parentElement ? /flex/.test(win.getComputedStyle(el.parentElement).display) : false;
    const cs0 = win.getComputedStyle(el);
    const decl = ['height:auto', 'max-height:none'];
    if (parentFlex) decl.push('flex:0 0 auto');
    // visible+hidden on the two axes would compute back to `auto`; clip the x axis instead
    if (cs0.overflowY !== 'visible') {
      decl.push('overflow-y:visible');
      if (cs0.overflowX !== 'visible') decl.push('overflow-x:clip');
    }
    // Written through the attribute, not el.style: a CSSOM edit makes Chrome leave
    // `style=""` behind even after removeAttribute, so the DOM wouldn't round-trip.
    el.setAttribute('style', (original ? original.replace(/;?\s*$/, ';') : '') + decl.map((d) => d + ' !important').join(';'));
  }
  for (const { el } of unfurlScroll) {
    el.scrollTop = 0;
    el.scrollLeft = 0;
  }
  return () => {
    for (const { el, style } of unfurlSaved) {
      if (style === null) el.removeAttribute('style');
      else el.setAttribute('style', style);
    }
    for (const { el, top, left } of unfurlScroll) {
      el.scrollTop = top;
      el.scrollLeft = left;
    }
    unfurlSaved.length = 0;
    unfurlScroll.length = 0;
  };
}

// Reset all scroll positions so scrolled-out content is at its natural position
// during capture. getBoundingClientRect() forces a synchronous layout flush, so
// positions are correct even though the reset is synchronous.
// Also override content-visibility:auto/hidden — browsers skip layout for
// off-screen content-visibility:auto elements, leaving their children with zero
// bounding rects that would be culled as invisible (GitHub issue feeds, etc.).
// Both states are restored after capture.
export function resetScrollAndContentVisibility(doc: Document, win: Win, rootEl: Element, subtree: boolean): () => void {
  const scrollSaved: { el: HTMLElement; top: number; left: number }[] = [];
  const cvSaved: { el: HTMLElement; v: string }[] = [];
  // For full-page capture, reset the outer document scroll so all content is
  // at its natural (unfurled) position for getBoundingClientRect() and for
  // captureVisibleTab screenshots. For element (subtree) capture, we must NOT
  // reset the page scroll — the user just picked an element that is visible in
  // the current viewport, and resetting scroll would push it off-screen, making
  // captureVisibleTab unable to reach raster regions inside it.
  if (!subtree) {
    const docEl = doc.documentElement as HTMLElement;
    const bodyEl = doc.body as HTMLElement | null;
    for (const el of [docEl, bodyEl]) {
      if (!el) continue;
      if (el.scrollTop || el.scrollLeft) {
        scrollSaved.push({ el, top: el.scrollTop, left: el.scrollLeft });
        el.scrollTop = 0;
        el.scrollLeft = 0;
      }
    }
  }
  // Reset scroll on elements inside the capture root (full-page: all; subtree:
  // only descendants of rootEl). Also force content-visibility so off-screen
  // content inside the root gets layout and isn't culled as zero-rect.
  const scrollScope = subtree
    ? Array.from(rootEl.querySelectorAll('*'))
    : Array.from(doc.querySelectorAll('*'));
  for (const el of scrollScope) {
    const h = el as HTMLElement;
    if (h.scrollTop || h.scrollLeft) {
      scrollSaved.push({ el: h, top: h.scrollTop, left: h.scrollLeft });
      h.scrollTop = 0;
      h.scrollLeft = 0;
    }
    const cv = (win.getComputedStyle(h) as any).contentVisibility;
    if (cv === 'auto' || cv === 'hidden') {
      cvSaved.push({ el: h, v: h.style.contentVisibility });
      h.style.contentVisibility = 'visible';
    }
  }
  return () => {
    for (const { el, v } of cvSaved) el.style.contentVisibility = v;
    for (const { el, top, left } of scrollSaved) {
      el.scrollTop = top;
      el.scrollLeft = left;
    }
    cvSaved.length = 0;
    scrollSaved.length = 0;
  };
}
