/** The DOM walk: paint order (stacking contexts, hoisted z-index layers), groups for filters and blends, transforms. */
import { TransformBail } from './ctx.js';
import type { CaptureCtx, HoistItem } from './ctx.js';
import type { PaintNode, Clip } from '../ir/types.js';
import { radiiOf, intersect, clipsContent, layerUrl } from './background.js';
import { num, splitTopLevel } from '../../css/util.js';
import { parseMatrix } from '../../css/transform.js';
import { filterOverflow } from '../../css/filter.js';
import { nativeControl, captureListMarker, captureText } from './text.js';
import { emitBox, tryPseudoBox, materializePseudo } from './box.js';
import { isVisible, pseudoVisible, parseClipShape, inPerspective, needsSubtreeRaster, loadImgInfo, prepareImageLayers, needsBoxRaster, pushRaster, captureSvgEl, captureImageEl } from './elements.js';

// Vector mask-image: walk the element normally, then tag every vector node it
// produced with the mask. Raster nodes are skipped — their screenshot already
// contains the page's masked rendering, so masking again would fade it twice.
export const walkInner = async (ctx: CaptureCtx, el: Element, clip: Clip | null, inheritedOpacity: number) => {
  const wcs = ctx.win.getComputedStyle(el);
  if ((wcs as any).maskImage && (wcs as any).maskImage !== 'none') await prepareImageLayers(ctx, wcs);
  const live = wcs.display !== 'none' && wcs.display !== 'contents' && !ctx.rootAncestors.has(el);
  const mk = live ? ctx.parseElementMask(el, wcs) : null;
  const cp = live && wcs.clipPath && wcs.clipPath !== 'none' ? parseClipShape(el, wcs) : null;
  if (!mk && !cp) return walkNode(ctx, el, clip, inheritedOpacity);
  const start = ctx.nodes.length;
  await walkNode(ctx, el, clip, inheritedOpacity);
  for (let i = start; i < ctx.nodes.length; i++) {
    const nd = ctx.nodes[i];
    if (nd.kind === 'raster') continue;
    if (mk) for (const one of Array.isArray(mk) ? mk : [mk]) (nd.masks ||= []).push(one);
    if (cp) (nd.clipShapes ||= []).push(cp);
  }
};

// CSS filter / mix-blend-mode composite the whole subtree as one unit → tag its nodes with a group
export const withGroup = async (ctx: CaptureCtx, el: Element, clip: Clip | null, inheritedOpacity: number, run: () => Promise<void>) => {
  const gcs = ctx.win.getComputedStyle(el);
  const live = gcs.display !== 'none' && gcs.display !== 'contents' && !ctx.rootAncestors.has(el);
  const fl = live && gcs.filter && gcs.filter !== 'none' ? ctx.parseFilterList(gcs.filter) : null;
  const bm = live && gcs.mixBlendMode && gcs.mixBlendMode !== 'normal' ? gcs.mixBlendMode : null;
  if (!fl && !bm) return run();
  const id = 'g' + ctx.groupSeq++;
  const r = el.getBoundingClientRect();
  const pad = fl ? filterOverflow(fl) : 0;
  ctx.groups[id] = { filter: fl || undefined, blend: bm || undefined, region: fl ? { x: r.left - pad, y: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 } : undefined };
  ctx.groupedEls.add(el);
  const start = ctx.nodes.length;
  await run();
  let any = false;
  for (let i = start; i < ctx.nodes.length; i++) {
    const nd = ctx.nodes[i];
    if (nd.kind === 'raster') continue; // a screenshot already contains the filtered/blended pixels
    (nd.groups ||= []).push(id);
    any = true;
  }
  if (!any) delete ctx.groups[id];
};

export const walk = async (ctx: CaptureCtx, el: Element, clip: Clip | null, inheritedOpacity: number): Promise<void> => {
  const cs0 = ctx.win.getComputedStyle(el);
  const tf = cs0.transform;
  if (!tf || tf === 'none' || ctx.noVectorTransform.has(el) || cs0.display === 'none' || cs0.display === 'contents' || ctx.rootAncestors.has(el))
    return withGroup(ctx, el, clip, inheritedOpacity, () => walkInner(ctx, el, clip, inheritedOpacity));
  const m = parseMatrix(tf);
  const rotated = !!m && !/matrix3d/.test(tf) && (Math.abs(m.b) > 1e-3 || Math.abs(m.c) > 1e-3);
  const has3D = /matrix3d/.test(tf) && (() => {
    const p = tf.match(/matrix3d\(([^)]+)\)/)![1].split(',').map((x) => parseFloat(x));
    const z = Math.abs(p[2]) > 1e-3 || Math.abs(p[6]) > 1e-3 || Math.abs(p[8]) > 1e-3 || Math.abs(p[9]) > 1e-3 || Math.abs(p[14]) > 1e-3;
    return z && inPerspective(ctx, el, p);
  })();
  const hasRotateProps = [cs0.getPropertyValue('rotate'), cs0.getPropertyValue('scale'), cs0.getPropertyValue('translate')].some((v) => v && v !== 'none');
  const m3 = /matrix3d/.test(tf) ? parseMatrix(tf) : null;
  const mm = m3 && !has3D ? m3 : m;
  const rot = !!mm && !has3D && (Math.abs(mm.b) > 1e-3 || Math.abs(mm.c) > 1e-3);
  if (!rot || has3D || hasRotateProps || !(el instanceof ctx.win.HTMLElement || el instanceof ctx.win.SVGElement)) return withGroup(ctx, el, clip, inheritedOpacity, () => walkInner(ctx, el, clip, inheritedOpacity));
  // a running CSS animation/transition would re-interpolate the cleared transform: keep raster
  try { if ((el as any).getAnimations && (el as any).getAnimations().length) return withGroup(ctx, el, clip, inheritedOpacity, () => walkInner(ctx, el, clip, inheritedOpacity)); } catch { /* ignore */ }
  void rotated;

  const he = el as HTMLElement;
  const originalStyle = he.getAttribute('style');
  const start = ctx.nodes.length, rStart = ctx.rasterTargets.length;
  const matrix = mm!;
  const originCss = cs0.transformOrigin; // px, relative to the border box
  he.setAttribute('style', (originalStyle ? originalStyle.replace(/;?\s*$/, ';') : '') + 'transform:none !important;transition:none !important');
  ctx.transformDepth++;
  let failed = false;
  try {
    const r0 = el.getBoundingClientRect(); // untransformed
    const [oxs, oys] = originCss.split(/\s+/);
    const ox = r0.left + (parseFloat(oxs) || 0), oy = r0.top + (parseFloat(oys) || 0);
    // T(o) · M · T(-o)
    const layer = {
      matrix: [
        matrix.a, matrix.b, matrix.c, matrix.d,
        ox - matrix.a * ox - matrix.c * oy + matrix.e,
        oy - matrix.b * ox - matrix.d * oy + matrix.f,
      ] as [number, number, number, number, number, number],
      outerClip: clip,
    };
    await withGroup(ctx, el, null, inheritedOpacity, () => walkInner(ctx, el, null, inheritedOpacity));
    for (let i = start; i < ctx.nodes.length; i++) (ctx.nodes[i].layers ||= []).push(layer);
  } catch (e) {
    if (!(e instanceof TransformBail)) throw e;
    failed = true;
  } finally {
    ctx.transformDepth--;
    if (originalStyle === null) he.removeAttribute('style');
    else he.setAttribute('style', originalStyle);
  }
  if (failed) {
    ctx.nodes.splice(start);
    ctx.rasterTargets.length = rStart;
    ctx.noVectorTransform.add(el); // re-walk with the old behaviour: raster the transformed element
    return withGroup(ctx, el, clip, inheritedOpacity, () => walkInner(ctx, el, clip, inheritedOpacity));
  }
};

export const createsStackingContext = (ctx: CaptureCtx, el: Element, cs: CSSStyleDeclaration): boolean => {
  if (el === ctx.doc.documentElement || el === ctx.rootEl) return true;
  if (cs.position === 'fixed' || cs.position === 'sticky') return true;
  if (cs.zIndex !== 'auto') {
    if (cs.position !== 'static') return true;
    const pd = el.parentElement ? ctx.win.getComputedStyle(el.parentElement).display : '';
    if (/flex|grid/.test(pd)) return true;
  }
  if (num(cs.opacity || '1') < 1) return true;
  if (cs.transform !== 'none' || cs.filter !== 'none' || cs.clipPath !== 'none') return true;
  if ((cs as any).perspective && (cs as any).perspective !== 'none') return true;
  if ((cs as any).maskImage && (cs as any).maskImage !== 'none') return true;
  if (cs.mixBlendMode !== 'normal' || cs.isolation === 'isolate') return true;
  if ((cs as any).backdropFilter && (cs as any).backdropFilter !== 'none') return true;
  if (/transform|opacity|filter|perspective|clip-path|mask/.test((cs as any).willChange || '')) return true;
  if (/layout|paint|strict|content/.test((cs as any).contain || '')) return true;
  if ((cs as any).containerType && (cs as any).containerType !== 'normal') return true;
  return false;
};

export const walkNode = async (ctx: CaptureCtx, el: Element, clip: Clip | null, inheritedOpacity: number) => {
  const cs = ctx.win.getComputedStyle(el);
  if (cs.backgroundImage && cs.backgroundImage !== 'none') await prepareImageLayers(ctx, cs);

  // display:contents has no box of its own but its children (and direct text)
  // render normally in the parent's formatting context.
  if (cs.display === 'contents') {
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return;
    const contOpacity = inheritedOpacity * num(cs.opacity || '1');
    if (contOpacity === 0) return;
    captureText(ctx, el, cs, clip, contOpacity);
    for (const kid of Array.from(el.children)) await walk(ctx, kid as Element, clip, contOpacity);
    return;
  }

  if (!isVisible(ctx, el, cs)) return;
  const opacity = inheritedOpacity * num(cs.opacity || '1');
  const r = el.getBoundingClientRect();
  // visibility:hidden hides the element's own rendering but children can override
  // it with visibility:visible. We skip box/text for the hidden element itself
  // but always continue descent so visible children are captured.
  const visHidden = cs.visibility === 'hidden' || cs.visibility === 'collapse';
  // In subtree mode, ancestor elements (between document root and the selected
  // element) skip ALL rendering — we don't want container backgrounds appearing
  // behind the selected content. We still descend to capture siblings/cousins
  // that visually overlap the capture area with correct paint order.
  const skipRender = ctx.rootAncestors.has(el);

  const subtreeReason = !skipRender && needsSubtreeRaster(ctx, el, cs);
  if (subtreeReason) {
    // 2D <canvas> (charts, QR codes): the bitmap is readable → real <image>; WebGL/tainted/blank → raster
    if (el.tagName === 'CANVAS' && el.childElementCount === 0 && !visHidden && subtreeReason === 'media:CANVAS') {
      const url = ctx.canvasDataUrl(el as HTMLCanvasElement);
      if (url) {
        emitBox(ctx, el, cs, clip, opacity);
        const bl = num(cs.borderLeftWidth), bt = num(cs.borderTopWidth);
        const cl = bl + num(cs.paddingLeft), ct = bt + num(cs.paddingTop);
        const cr = num(cs.borderRightWidth) + num(cs.paddingRight), cb = num(cs.borderBottomWidth) + num(cs.paddingBottom);
        ctx.nodes.push({
          kind: 'image', id: ctx.nid(),
          rect: { x: r.left + cl, y: r.top + ct, width: Math.max(0, r.width - cl - cr), height: Math.max(0, r.height - ct - cb) },
          opacity, clip, href: url, preserveAspectRatio: cs.objectFit === 'contain' ? 'xMidYMid meet' : cs.objectFit === 'cover' ? 'xMidYMid slice' : 'none',
        } as PaintNode);
        return;
      }
    }
    if (!visHidden) pushRaster(ctx, r, clip, opacity, subtreeReason, el);
    return;
  }

  if (!skipRender && el.tagName.toLowerCase() === 'svg') {
    if (!visHidden) captureSvgEl(ctx, el, cs, r, clip, opacity);
    return;
  }

  if (!skipRender && el.tagName.toUpperCase() === 'IMG') {
    captureImageEl(ctx, el, cs, r, clip, opacity);
    return;
  }

  // Box-level effects we can't vectorize:
  //   • Leaf element  → rasterize and done (no children to miss)
  //   • Non-leaf with raster backend → rasterize as base layer so pseudo-elements
  //     and complex backgrounds appear, then vectorize children on top.  Children
  //     paint over the raster so the visual result is correct where vectorization
  //     is faithful; the raster fills the gaps (pseudo-elements, bg images, etc.).
  //   • Non-leaf without raster backend → emit what we can vectorize and continue.
  const boxReason = !skipRender && !visHidden && needsBoxRaster(ctx, el, cs);
  // ::after is emitted after the element's children (it paints on top of content);
  // hold its node here and push it past the child walk below.
  let childClip = clip;
  // an ancestor's overflow clip must not crop the picked element's own content
  if (clipsContent(cs) && !skipRender) {
    // For scrollable containers (overflow:auto/scroll) in full-content mode,
    // expand the clip to scrollWidth × scrollHeight so items that are outside
    // the container's current visible area are still included in the output.
    // For overflow:hidden the CSS dimensions are usually intentional (rounded
    // corner clips, dropdown menus, etc.) — keep them. BUT MUI Collapse,
    // Accordion, Drawer, and similar animation primitives use overflow:hidden
    // combined with a transitioning height to reveal content. After the
    // animation settles, scrollHeight typically equals clientHeight, but for
    // the brief window where height is still transitioning (or where layout
    // has sub-pixel mismatches), children would be silently clipped to the
    // collapsed size and disappear from the export. When scrollHeight clearly
    // exceeds clientHeight, expand the clip so the content survives.
    const htmlEl = el as HTMLElement;
    const isScrollContainer = cs.overflowX === 'scroll' || cs.overflowX === 'auto' || cs.overflowY === 'scroll' || cs.overflowY === 'auto';
    const isHiddenWithOverflow =
      (cs.overflowX === 'hidden' || cs.overflowY === 'hidden') &&
      ((htmlEl.scrollHeight || 0) - htmlEl.clientHeight > 1 ||
        (htmlEl.scrollWidth || 0) - htmlEl.clientWidth > 1);
    const captureScrollable = !!(ctx.opts as any).captureScrollableContent;
    // a ≤1px box is the sr-only pattern: its overflowing text must stay clipped
    const shouldExpand = captureScrollable && (isScrollContainer || isHiddenWithOverflow) && r.width > 1 && r.height > 1;
    const clipW = shouldExpand ? Math.max(r.width, htmlEl.scrollWidth || 0) : r.width;
    const clipH = shouldExpand ? Math.max(r.height, htmlEl.scrollHeight || 0) : r.height;
    childClip = intersect(clip, {
      x: r.left,
      y: r.top,
      width: clipW,
      height: clipH,
      radii: radiiOf(cs, r.width, r.height),
    });
  }

  // Content the browser does not paint: `content-visibility:hidden` (also `hidden=until-found`) and the body of a
  // closed <details>. The element's own box stays; its text and children are not drawn.
  const closedDetails = el.tagName === 'DETAILS' && !(el as HTMLDetailsElement).open;
  const contentHidden = !skipRender && ((cs as any).contentVisibility === 'hidden' || closedDetails);
  if (contentHidden) childClip = { x: r.left, y: r.top, width: 0, height: 0, radii: radiiOf(cs, 0, 0) };

  let afterPseudoNodes: PaintNode[] = [];
  let pseudoVectorized = false;
  if (boxReason === 'pseudo') {
    // pseudo backgrounds may be url() images (accordion chevrons, icons): load them before the sync materialize
    for (const sel of ['::before', '::after'] as const) {
      const pbg = ctx.win.getComputedStyle(el, sel).backgroundImage;
      if (pbg && pbg !== 'none') for (const layer of splitTopLevel(pbg)) { const u = layerUrl(layer); if (u) await loadImgInfo(ctx, u); }
    }
    // Try to vectorize the decorative pseudo(s) rather than raster the whole box.
    const pseudoPart = (sel: '::before' | '::after') => {
      if (!pseudoVisible(ctx, el, sel)) return { handled: true as const, nodes: [] as PaintNode[] };
      const b = tryPseudoBox(ctx, el, cs, sel, clip, opacity);
      if (b.handled) return { handled: true as const, nodes: b.node ? [b.node] : [] };
      const t = materializePseudo(ctx, el, sel, clip, opacity);
      return t ? { handled: true as const, nodes: t } : { handled: false as const, nodes: [] as PaintNode[] };
    };
    const before = pseudoPart('::before');
    const after = pseudoPart('::after');
    if (before.handled && after.handled) {
      pseudoVectorized = true;
      // Paint order: host box → ::before → host content/children → ::after.
      emitBox(ctx, el, cs, clip, opacity);
      ctx.nodes.push(...before.nodes);
      captureText(ctx, el, cs, childClip, opacity);
      captureListMarker(ctx, el, cs, childClip, opacity);
      afterPseudoNodes = after.nodes;
    }
  }
  if (boxReason && !pseudoVectorized) {
    if (el.childElementCount === 0) {
      pushRaster(ctx, r, clip, opacity, boxReason, el);
      return;
    }
    if (ctx.containerRasterFallback) {
      pushRaster(ctx, r, clip, opacity, boxReason, el);
      // skip emitBox/captureText — the raster already captures them including ::marker
    } else {
      emitBox(ctx, el, cs, clip, opacity);
      captureText(ctx, el, cs, childClip, opacity);
      captureListMarker(ctx, el, cs, childClip, opacity);
    }
  } else if (!boxReason && !skipRender && !visHidden) {
      emitBox(ctx, el, cs, clip, opacity);
      captureText(ctx, el, cs, childClip, opacity);
    captureListMarker(ctx, el, cs, childClip, opacity);
  }

  // <option>s are painted by captureNative; a closed <details> paints only its first <summary>
  const kids = nativeControl(el) ? []
    : closedDetails ? Array.from(el.children).filter((k, _i, all) => k === all.find((c) => c.tagName === 'SUMMARY'))
    : contentHidden ? [] : Array.from(el.children);
  const parentIsFlexGrid = /flex|grid/.test(cs.display);
  const meta = kids.map((k) => {
    const kcs = ctx.win.getComputedStyle(k);
    const positioned = kcs.position !== 'static';
    const zRaw = kcs.zIndex;
    const z = zRaw === 'auto' ? 0 : parseInt(zRaw, 10) || 0;
    // z-index applies to positioned boxes and to flex/grid items
    const layered = zRaw !== 'auto' && (positioned || parentIsFlexGrid);
    return { k, positioned, z, layered };
  });
  // CSS paint order within a stacking context:
  //   1. negative z-index descendants (lowest first)
  //   2. block/inline flow (non-positioned) in DOM order
  //   3. positioned with z-index:auto or z-index:0 in DOM order (above flow)
  //   4. positive z-index descendants (lowest first)
  // z-indexed descendants belong to the *nearest stacking context*, not to their parent: a
  // `position:relative; z-index:2` box inside a plain wrapper still paints above a later
  // z-index:auto sibling of that wrapper. So z≠0 layers are hoisted to the nearest ancestor
  // that creates a stacking context and painted there (neg → flow → pos).
  const outerHoist = ctx.curHoist;
  const ownsContext = !outerHoist || createsStackingContext(ctx, el, cs);
  const mine: { neg: HoistItem[]; pos: HoistItem[] } = ownsContext ? { neg: [], pos: [] } : outerHoist!;
  ctx.curHoist = mine;
  const flowStart = ctx.nodes.length;
  try {
    for (const m of meta.filter((x) => !(x.layered && x.z !== 0))) {
      if (!m.positioned) await walk(ctx, m.k, childClip, opacity);
    }
    for (const m of meta.filter((x) => x.positioned && !(x.layered && x.z !== 0))) {
      await walk(ctx, m.k, childClip, opacity);
    }
    for (const m of meta) {
      if (m.layered && m.z !== 0) (m.z < 0 ? mine.neg : mine.pos).push({ k: m.k, clip: childClip, opacity, z: m.z });
    }

    // Walk open shadow roots after light-DOM children. Shadow DOM content renders
    // on top of the host's light-DOM background; placing it last preserves that
    // order. Slotted light-DOM elements are captured by their light-DOM walk
    // (range.getClientRects() returns their visual slot position), so no doubling.
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) {
      for (const child of Array.from(shadow.children)) {
        await walk(ctx, child as Element, childClip, opacity);
      }
    }
  } finally {
    ctx.curHoist = outerHoist;
  }

  if (ownsContext && (mine.neg.length > 0 || mine.pos.length > 0)) {
    const flowNodes = ctx.nodes.splice(flowStart);
    ctx.curHoist = mine;
    try {
      // hoisted layers are stacking contexts of their own (they never re-hoist into `mine`)
      for (const it of mine.neg.sort((a, b) => a.z - b.z)) await walk(ctx, it.k, it.clip, it.opacity);
      ctx.nodes.push(...flowNodes);
      for (const it of mine.pos.sort((a, b) => a.z - b.z)) await walk(ctx, it.k, it.clip, it.opacity);
    } finally {
      ctx.curHoist = outerHoist;
    }
  }

  // ::after paints above the host's content (emitted after the child walk).
  ctx.nodes.push(...afterPseudoNodes);
};
