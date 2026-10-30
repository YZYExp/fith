import type { Scene, CaptureOptions } from '../ir/types.js';
import { bindEnv, type BgEnv, type ImgInfo, bgImageLayer as bgBgImageLayer, parseBackgroundLayers as bgParseBackgroundLayers, parseBgLayers as bgParseBgLayers, parseElementMask as bgParseElementMask, parseGradientLayer as bgParseGradientLayer, parseMaskLayers as bgParseMaskLayers } from './background.js';
import { unfurlScrollContainers, resetScrollAndContentVisibility } from './unfurl.js';
import { createColorNormalizer } from './colorNorm.js';
import { canvasDataUrl as domCanvasDataUrl, canvasExtractDataURL as domCanvasExtractDataURL } from './images.js';
import { collectFonts, resolveFonts } from './fonts.js';
import { walk } from './walk.js';
import type { CaptureCtx } from './ctx.js';
import { transparent } from '../../css/color.js';
import {
  parseLinearGradient as cssParseLinearGradient,
  parseFirstLinearGradient as cssParseFirstLinearGradient,
  parseGradientStops as cssParseGradientStops,
} from '../../css/gradient.js';
import { parseShadows as cssParseShadows, parseInsetShadows as cssParseInsetShadows } from '../../css/shadow.js';
import { parseFilterList as cssParseFilterList } from '../../css/filter.js';

/**
 * Captures the current page into a Scene IR. Runs INSIDE the page context (bundled into
 * the IIFE the Node backend injects, see src/inject/entry.ts), so it must not use Node
 * APIs. The same function is reused by the extension and in-page-library backends, where
 * it is simply called directly.
 */
export async function captureScene(opts: CaptureOptions, root?: Element): Promise<Scene> {
  const dpr = opts.deviceScaleFactor || 1;
  // The element's own document and window, not the globals of the page this code was loaded into:
  // the editor that embeds fith captures a same-origin <iframe>, and `instanceof HTMLElement` is false across realms.
  const doc = root?.ownerDocument ?? document;
  const win = (doc.defaultView ?? window) as Window & typeof globalThis;
  const rootEl = root ?? doc.documentElement;
  const subtree = rootEl !== doc.documentElement;

  const restoreUnfurl =
    subtree && (opts as any).captureScrollableContent && (opts as any).unfurlScrollContainers !== false
      ? unfurlScrollContainers(win, rootEl)
      : () => {};
  let restoreScroll = () => {};
  try {
  const rootRect = rootEl.getBoundingClientRect();
  const W = subtree ? rootRect.width : opts.width;
  const H = subtree
    ? rootRect.height
    : opts.height ||
      Math.max(
        doc.documentElement.scrollHeight,
        doc.body ? doc.body.scrollHeight : 0,
      );
  const originX = subtree ? rootRect.left : 0;
  const originY = subtree ? rootRect.top : 0;

  // In subtree mode, collect all DOM ancestors of rootEl. walk() skips rendering
  // for these elements (to suppress container backgrounds) but still descends into
  // their children, so siblings and cousins that visually overlap the capture area
  // are captured with correct paint order. We walk from document.documentElement
  // instead of rootEl so those out-of-subtree elements are naturally visited.
  const rootAncestors = new Set<Element>();
  if (subtree) {
    let a: Element | null = rootEl.parentElement;
    while (a) { rootAncestors.add(a); a = a.parentElement; }
  }

  const mctx = doc.createElement('canvas').getContext('2d')!;
  const normColor = createColorNormalizer(doc);
  const imgInfo: ImgInfo = new Map();
  const bgEnv: BgEnv = { doc, win, normColor, imgInfo };

  const ctx: CaptureCtx = {
    opts,
    doc,
    win,
    rootEl,
    subtree,
    dpr,
    W,
    H,
    originX,
    originY,
    // cull against the captured region: the document box for full-page, the root element's box for a
    // subtree (coords are absolute viewport px in both cases)
    cullRight: subtree ? originX + W : W,
    cullBottom: subtree ? originY + H : H,
    cullLeft: subtree ? originX : 0,
    cullTop: subtree ? originY : 0,
    rootAncestors,
    nodes: [],
    rasterTargets: [],
    collectGlyphX: !!opts.collectGlyphX,
    counter: 0,
    nid: () => 'n' + ctx.counter++,
    mctx,
    normColor,
    imgInfo,
    imgTasks: [],
    containerRasterFallback: !!(opts as any).containerRasterFallback,
    groupedEls: new WeakSet(),
    noVectorTransform: new WeakSet(),
    transformDepth: 0,
    groupSeq: 0,
    groups: {},
    curHoist: null,
    background: '',
    body: doc.body,
    // CSS parsers live in src/css (pure, unit-tested); these bind the page's colour normaliser
    parseLinearGradient: (value) => cssParseLinearGradient(value, normColor),
    parseFirstLinearGradient: (value) => cssParseFirstLinearGradient(value, normColor),
    parseGradientStops: (parts, lineLen, repeating = false) => cssParseGradientStops(parts, lineLen, normColor, repeating),
    parseShadows: (value) => cssParseShadows(value, normColor),
    parseInsetShadows: (value) => cssParseInsetShadows(value, normColor),
    parseFilterList: (v) => cssParseFilterList(v, normColor),
    // backgrounds and masks (background.ts) with the environment bound
    bgImageLayer: bindEnv(bgEnv, bgBgImageLayer),
    parseBackgroundLayers: bindEnv(bgEnv, bgParseBackgroundLayers),
    parseBgLayers: bindEnv(bgEnv, bgParseBgLayers),
    parseElementMask: bindEnv(bgEnv, bgParseElementMask),
    parseGradientLayer: bindEnv(bgEnv, bgParseGradientLayer),
    parseMaskLayers: bindEnv(bgEnv, bgParseMaskLayers),
    canvasDataUrl: (cv) => domCanvasDataUrl(doc, cv),
    canvasExtractDataURL: (img) => domCanvasExtractDataURL(doc, img),
  };

  const body = ctx.body;
  if (subtree) {
    // a subtree export is just the element: use its own opaque bg, else transparent
    const ebg = win.getComputedStyle(rootEl).backgroundColor;
    ctx.background = transparent(ebg) ? '' : normColor(ebg);
  } else {
    ctx.background = !transparent(win.getComputedStyle(doc.documentElement).backgroundColor)
      ? normColor(win.getComputedStyle(doc.documentElement).backgroundColor)
      : body && !transparent(win.getComputedStyle(body).backgroundColor)
        ? normColor(win.getComputedStyle(body).backgroundColor)
        : '#ffffff';
  }

  restoreScroll = (opts as any).captureScrollableContent ? resetScrollAndContentVisibility(doc, win, rootEl, subtree) : restoreScroll;
  // In subtree mode, walk from document root so siblings and cousins that
  // visually overlap the selected element's bounding area are captured with
  // correct paint order. rootAncestors guards suppress their own rendering.
  await walk(ctx, subtree ? (doc.documentElement as Element) : rootEl, null, 1);
  await Promise.all(ctx.imgTasks);

  restoreScroll();

  const fonts =
    (opts.fontMode ?? 'embed') !== 'embed'
      ? []
      : typeof opts.fonts === 'function'
        ? await resolveFonts(ctx.nodes, opts.fonts)
        : opts.fonts ?? (await collectFonts(ctx.nodes, { doc, win, externalCss: opts.externalCss }));

  return {
    width: W,
    height: H,
    originX,
    originY,
    deviceScaleFactor: dpr,
    background: ctx.background,
    nodes: ctx.nodes,
    groups: Object.keys(ctx.groups).length ? ctx.groups : undefined,
    rasterTargets: ctx.rasterTargets,
    fonts,
  };

  } finally {
    restoreScroll();
    restoreUnfurl();
  }
}
