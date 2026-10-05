/**
 * In-page / browser-library backend. Runs the core capture + emit entirely
 * inside the page using standard DOM APIs — no Node, no Playwright, no CDP.
 * Bundle this entry for a browser <script> or a content script.
 */
import { captureScene } from '../../core/capture/capture.js';
import { emitSvg } from '../../core/emit/svg.js';
import type { Rect, Scene } from '../../core/ir/types.js';
import type { Outliner } from '../../core/emit/outline.js';
import { createDomRasterizer } from './dom-raster.js';

export interface InPageOptions {
  /** Defaults to the current layout viewport width. */
  width?: number;
  /** Defaults to the full document height. */
  height?: number;
  deviceScaleFactor?: number;
  fontMode?: 'embed' | 'outline' | 'none';
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
  rasterize?: (rect: Rect, scale: number) => Promise<string | null>;
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

async function run(opts: InPageOptions, root?: Element): Promise<string> {
  // Viewport-only: keep coords viewport-relative (don't reset scroll, don't
  // unfurl overflow) so one viewport screenshot composites correctly and
  // off-screen content is left out.
  const viewportOnly = !!opts.viewportOnly && !root;
  const rasterElements = new Map<string, Element>();
  const scene: Scene = await captureScene(
    {
      width: opts.width ?? (viewportOnly ? window.innerWidth : document.documentElement.clientWidth),
      height:
        opts.height ??
        (viewportOnly
          ? window.innerHeight
          : Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)),
      deviceScaleFactor: opts.deviceScaleFactor ?? window.devicePixelRatio ?? 1,
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
      unfurlScrollContainers: opts.unfurlScrollContainers,
    },
    root,
  );

  if (opts.rasterize) {
    const byId = new Map(scene.rasterTargets.map((t) => [t.id, t]));
    for (const node of scene.nodes) {
      if (node.kind !== 'raster') continue;
      const t = byId.get(node.id);
      if (!t || t.width <= 0 || t.height <= 0) continue;
      node.href = await opts.rasterize(
        { x: t.x, y: t.y, width: t.width, height: t.height },
        scene.deviceScaleFactor,
      );
    }
  }

  if (opts.domRasterFallback !== false) {
    const domRaster = createDomRasterizer();
    const byId = new Map(scene.rasterTargets.map((t) => [t.id, t]));
    for (const node of scene.nodes) {
      if (node.kind !== 'raster' || node.href) continue;
      const t = byId.get(node.id);
      const el = rasterElements.get(node.id);
      if (!t || !el || t.width <= 0 || t.height <= 0) continue;
      node.href = await domRaster(el, { x: t.x, y: t.y, width: t.width, height: t.height }, scene.deviceScaleFactor);
    }
  }

  if (opts.fontMode === 'outline' && opts.outline) {
    scene.fonts = [];
    return emitSvg(scene, { outline: opts.outline });
  }
  return emitSvg(scene);
}

/** Capture the current page into a self-contained SVG string. */
export function captureCurrentPage(opts: InPageOptions = {}): Promise<string> {
  return run(opts);
}

/** Capture a single element subtree into a self-contained SVG cropped to it. */
export function captureElement(el: Element, opts: InPageOptions = {}): Promise<string> {
  return run(opts, el);
}

export { captureScene, emitSvg };
