/**
 * In-page / browser-library backend. Runs the core capture + emit entirely
 * inside the page using standard DOM APIs — no Node, no Playwright, no CDP.
 * Bundle this entry for a browser <script> or a content script.
 */
import { captureScene } from '../../core/capture/capture.js';
import { emitSvg } from '../../core/emit/svg.js';
import type { Rect, Scene } from '../../core/ir/types.js';
import type { Outliner } from '../../core/emit/outline.js';

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
}

async function run(opts: InPageOptions, root?: Element): Promise<string> {
  const scene: Scene = await captureScene(
    {
      width: opts.width ?? document.documentElement.clientWidth,
      height:
        opts.height ??
        Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
      deviceScaleFactor: opts.deviceScaleFactor ?? window.devicePixelRatio ?? 1,
      fontMode: opts.fontMode === 'none' ? 'none' : 'embed',
      collectGlyphX: opts.fontMode === 'outline',
      // Rasterize non-leaf containers that have un-vectorizable box effects
      // (pseudo-elements, complex background images) only when a rasterize
      // backend is available; otherwise silently emit what can be vectorized.
      containerRasterFallback: !!opts.rasterize,
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
