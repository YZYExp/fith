/**
 * In-page / browser-library backend. Runs the core capture + emit entirely
 * inside the page using standard DOM APIs — no Node, no Playwright, no CDP.
 * Bundle this entry for a browser <script> or a content script.
 */
import { captureScene } from '../../core/capture/capture.js';
import { emitSvg } from '../../core/emit/svg.js';
import { captureSourceHtml } from '../../core/capture/source-html.js';
import type { CaptureReport, FontFace, FontRequest, FontResolver, Rect, Scene } from '../../core/ir/types.js';
import { buildReport } from '../../core/report.js';
import type { Outliner } from '../../core/emit/outline.js';
import { createDomRasterizer } from './dom-raster.js';

/** What a host's `rasterize` callback learns about the region it is asked for. */
export interface RasterInfo {
  /** The element the region belongs to, when it has one (an `<iframe>`, `<x-embed>`, `<video>`, a 3D-transformed box…). */
  element?: Element;
  /** Why the region could not be drawn as vectors (`canvas`, `3d-transform`, `filter`, …). */
  reason: string;
}

export interface InPageOptions {
  /** Defaults to the current layout viewport width. */
  width?: number;
  /** Defaults to the full document height. */
  height?: number;
  deviceScaleFactor?: number;
  fontMode?: 'embed' | 'outline' | 'none';
  /**
   * Faces to embed instead of the ones read from the document's `@font-face` rules (`embed` and `outline` modes).
   * For frames without network access, or when the host already holds the bytes. A function is asked for each
   * face the text uses, with the characters set in it, so the host can cut a subset.
   */
  fonts?: FontFace[] | FontResolver;
  /** Prepended to every id in the SVG so several captures can share one document (see `EmitOptions.idPrefix`). */
  idPrefix?: string;
  /**
   * Optional glyph outliner for `outline` mode. Supplied by the caller to keep
   * opentype.js out of the default in-page bundle (so the content script stays
   * small). Build one with `createOutliner` from `core/emit/outline`.
   */
  outline?: Outliner;
  /**
   * Optional rasterizer for regions the core cannot vectorize (canvas, video,
   * filters, native form controls, …). Pure in-page contexts can't screenshot
   * arbitrary DOM; an extension provides this via chrome.tabs.captureVisibleTab.
   * When absent, such regions are omitted.
   */
  rasterize?: (rect: Rect, scale: number, info: RasterInfo) => Promise<string | null>;
  /**
   * Capture only the currently-visible viewport instead of the full scrollable
   * document. Coordinates stay viewport-relative (scroll is NOT reset), so a
   * single chrome.tabs.captureVisibleTab screenshot maps 1:1 to the output —
   * no scroll-and-stitch, which on long pages is slow and drags sticky/fixed
   * headers and lazy-loaded content into the wrong places. Off-screen content
   * is clipped away. Default false (full-page).
   */
  viewportOnly?: boolean;
  /**
   * Re-render regions that have no screenshot (no `rasterize`, or it returned
   * null — e.g. off-screen) by cloning the element with inlined styles into an SVG
   * <foreignObject> and drawing it to a canvas (see dom-raster.ts). Fills the gaps
   * so un-vectorizable content isn't silently dropped. Default true.
   */
  domRasterFallback?: boolean;
  /**
   * Element export only: temporarily expand scrollable containers inside (and
   * including) the picked element to their full content height, so the SVG holds the
   * whole list rather than the visible window. Layout is restored afterwards.
   * Default true; pass false for a "what I see" export.
   */
  unfurlScrollContainers?: boolean;
}

async function run(opts: InPageOptions, root?: Element): Promise<{ svg: string; report: CaptureReport }> {
  // the element's own document and window: it may live in a same-origin iframe of this page
  const doc = root?.ownerDocument ?? document;
  const win = doc.defaultView ?? window;
  // Viewport-only: keep coords viewport-relative (don't reset scroll, don't
  // unfurl overflow) so one viewport screenshot composites correctly and
  // off-screen content is left out.
  const viewportOnly = !!opts.viewportOnly && !root;
  const rasterElements = new Map<string, Element>();
  const scene: Scene = await captureScene(
    {
      width: opts.width ?? (viewportOnly ? win.innerWidth : doc.documentElement.clientWidth),
      height:
        opts.height ??
        (viewportOnly
          ? win.innerHeight
          : Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0)),
      deviceScaleFactor: opts.deviceScaleFactor ?? win.devicePixelRatio ?? 1,
      fontMode: opts.fontMode === 'none' ? 'none' : 'embed',
      collectGlyphX: opts.fontMode === 'outline',
      // containerRasterFallback is intentionally OFF for the extension (both
      // viewport-only and full-page). When it fires, it emits a full-container
      // screenshot as a raster base layer (which already includes the children),
      // then walks the children for a vector pass on top — the overlap produces
      // visible ghosting on any page with complex CSS. captureVisibleTab can't
      // screenshot just the container's own box (background/borders/pseudo) without
      // its children, so there is no clean way to combine raster+vector here.
      // tryPseudoBox covers the common ::before/::after overlay pattern; anything
      // else falls back to best-effort vector (missing effect > ghosting).
      containerRasterFallback: false,
      // Full-page export unfurls all scroll containers (resets scroll to 0 and
      // expands overflow clips to scrollWidth × scrollHeight, restored after).
      // Viewport-only skips this so the capture matches what's on screen now.
      captureScrollableContent: !viewportOnly,
      rasterElements,
      fonts: opts.fonts,
      unfurlScrollContainers: opts.unfurlScrollContainers,
    },
    root,
  );

  const targets = new Map(scene.rasterTargets.map((t) => [t.id, t]));
  /** Raster nodes with a drawable target rect, optionally only those still lacking pixels. */
  const pendingRasters = (onlyUnfilled: boolean) =>
    scene.nodes.flatMap((node) => {
      if (node.kind !== 'raster' || (onlyUnfilled && node.href)) return [];
      const t = targets.get(node.id);
      return t && t.width > 0 && t.height > 0 ? [{ node, t }] : [];
    });

  if (opts.rasterize) {
    for (const { node, t } of pendingRasters(false)) {
      try {
        node.href = await opts.rasterize({ x: t.x, y: t.y, width: t.width, height: t.height }, scene.deviceScaleFactor, {
          element: rasterElements.get(node.id),
          reason: node.reason,
        });
      } catch {
        node.href = null; // one region the host could not draw must not lose the whole capture
      }
      if (node.href) node.filledBy = 'screenshot';
    }
  }

  if (opts.domRasterFallback !== false) {
    const domRaster = createDomRasterizer();
    for (const { node, t } of pendingRasters(true)) {
      const el = rasterElements.get(node.id);
      if (!el) continue;
      node.href = await domRaster(el, { x: t.x, y: t.y, width: t.width, height: t.height }, scene.deviceScaleFactor);
      if (node.href) node.filledBy = 'dom';
    }
  }

  if (opts.fontMode === 'outline' && opts.outline) {
    const report = buildReport(scene, { outlined: true });
    scene.fonts = [];
    return { svg: emitSvg(scene, { outline: opts.outline, idPrefix: opts.idPrefix }), report };
  }
  return { svg: emitSvg(scene, { idPrefix: opts.idPrefix }), report: buildReport(scene) };
}

/** Capture the current page into a self-contained SVG string. */
export async function captureCurrentPage(opts: InPageOptions = {}): Promise<string> {
  return (await run(opts)).svg;
}

/** Capture a single element subtree into a self-contained SVG cropped to it. */
export async function captureElement(el: Element, opts: InPageOptions = {}): Promise<string> {
  return (await run(opts, el)).svg;
}

/** Like `captureCurrentPage`, with the report of what was drawn as pictures or left blank. */
export function captureCurrentPageDetailed(opts: InPageOptions = {}): Promise<{ svg: string; report: CaptureReport }> {
  return run(opts);
}

/** Like `captureElement`, with the report of what was drawn as pictures or left blank. */
export function captureElementDetailed(el: Element, opts: InPageOptions = {}): Promise<{ svg: string; report: CaptureReport }> {
  return run(opts, el);
}

export { captureScene, emitSvg, captureSourceHtml, buildReport };
export type { CaptureReport, FontFace, FontRequest, FontResolver };
