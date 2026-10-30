import type { CaptureOptions, Clip, PaintNode } from '../ir/types.js';
import type { ColorNorm } from '../../css/color.js';
import type { parseLinearGradient, parseFirstLinearGradient, parseGradientStops } from '../../css/gradient.js';
import type { parseShadows, parseInsetShadows } from '../../css/shadow.js';
import type { parseFilterList } from '../../css/filter.js';
import type { ImgInfo, parseGradientLayer, parseBgLayers, parseMaskLayers, parseElementMask, parseBackgroundLayers, bgImageLayer } from './background.js';

/** Thrown while a rotated / skewed subtree is measured when something inside needs a screenshot: the element falls back to a raster. */
export class TransformBail extends Error {}

/** A positioned descendant lifted out of its parent so it paints in its stacking context's z-order. */
export type HoistItem = { k: Element; clip: Clip | null; opacity: number; z: number };

/** A function of another module with its first (environment) parameter, or the colour normaliser, already bound. */
type Bound<F> = F extends (env: never, ...a: infer A) => infer R ? (...a: A) => R : never;
type WithNorm<F> = F extends (...a: infer A) => infer R ? (...a: A extends [...infer H, ColorNorm] ? H : A extends [...infer H, ColorNorm, infer O] ? [...H, O] : A) => R : never;

/**
 * Everything one `captureScene` run shares: the document it reads, the options, the paint list it fills and the
 * counters and caches that used to be locals of one 2000-line closure. Built once per run in `capture.ts`; every
 * function in the sibling modules takes it as its first argument.
 */
export interface CaptureCtx {
  opts: CaptureOptions;
  /** the element's own document and window (it may live in a same-origin iframe) */
  doc: Document;
  win: Window & typeof globalThis;
  rootEl: Element;
  subtree: boolean;
  dpr: number;
  W: number;
  H: number;
  originX: number;
  originY: number;
  /** the captured region: the document box for full-page, the root element's box for a subtree */
  cullLeft: number;
  cullRight: number;
  cullTop: number;
  cullBottom: number;
  /** ancestors of a picked element: context only, they paint nothing of their own */
  rootAncestors: Set<Element>;

  nodes: PaintNode[];
  rasterTargets: { id: string; x: number; y: number; width: number; height: number }[];
  collectGlyphX: boolean;
  counter: number;
  nid: () => string;
  mctx: CanvasRenderingContext2D;
  normColor: ColorNorm;

  imgInfo: ImgInfo;
  imgTasks: Promise<void>[];
  containerRasterFallback: boolean;
  groupedEls: WeakSet<Element>;
  noVectorTransform: WeakSet<Element>;
  transformDepth: number;
  groupSeq: number;
  groups: Record<string, any>;
  curHoist: { neg: HoistItem[]; pos: HoistItem[] } | null;
  background: string;
  body: HTMLElement | null;

  // parsers of src/css and background.ts with the colour normaliser / image table already bound
  parseLinearGradient: WithNorm<typeof parseLinearGradient>;
  parseFirstLinearGradient: WithNorm<typeof parseFirstLinearGradient>;
  parseGradientStops: (parts: string[], lineLen: number, repeating?: boolean) => ReturnType<typeof parseGradientStops>;
  parseShadows: WithNorm<typeof parseShadows>;
  parseInsetShadows: WithNorm<typeof parseInsetShadows>;
  parseFilterList: WithNorm<typeof parseFilterList>;
  parseGradientLayer: Bound<typeof parseGradientLayer>;
  parseBgLayers: Bound<typeof parseBgLayers>;
  parseMaskLayers: Bound<typeof parseMaskLayers>;
  parseElementMask: Bound<typeof parseElementMask>;
  parseBackgroundLayers: Bound<typeof parseBackgroundLayers>;
  bgImageLayer: Bound<typeof bgImageLayer>;
  canvasDataUrl: (cv: HTMLCanvasElement) => string | null;
  canvasExtractDataURL: (img: HTMLImageElement) => string | null;
}
