/**
 * Scene IR — the contract between the in-page capture and the SVG emitter.
 *
 * The capture runs inside the page (pure DOM APIs) and produces a Scene as
 * plain JSON. The emitter (pure, runs anywhere) turns a Scene into an SVG string.
 *
 * All coordinates are absolute CSS px in the document viewport. All style values
 * are already-computed values resolved by the browser. `nodes` is in paint order
 * (index 0 painted first / bottom-most).
 */

export interface Scene {
  width: number;
  height: number;
  /** viewBox origin (defaults to 0,0). Non-zero when capturing a subtree. */
  originX?: number;
  originY?: number;
  deviceScaleFactor: number;
  background: string;
  nodes: PaintNode[];
  /** Regions the emitter renders as <image>; filled in by the backend screenshotter. */
  rasterTargets: RasterTarget[];
  /** @font-face fonts used by text nodes, inlined as base64 in `embed` mode. */
  fonts: FontFace[];
  /**
   * Full-page screenshot embedded as a base layer at z-order 0, painted before
   * all nodes. Filled by the Node backend when `guaranteeFloor: true`. Null/absent
   * means no base layer (default, backward-compatible behaviour).
   */
  baseLayer?: string | null;
}

export interface FontFace {
  family: string;
  weight: string;
  style: string;
  /** base64 data URI of the font file. */
  src: string;
  format: string;
  /** CSS unicode-range of this face (subsetted webfonts such as Google Fonts). */
  unicodeRange?: string;
}

export interface RasterTarget {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PaintNode = BoxNode | TextNode | ImageNode | InlineSvgNode | RasterNode;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** top-left, top-right, bottom-right, bottom-left (px). */
export type CornerRadii = [number, number, number, number];

export interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
  radii: CornerRadii;
}

/**
 * CSS mask-image over the mask box `rect`: either a linear-gradient (stops are
 * white with the mask alpha) or a placed raster/SVG image (alpha channel used).
 */
export interface MaskGradient {
  rect: Rect;
  gradient?: LinearGradientFill | RadialGradientFill;
  /** several gradient layers, unioned (mask-composite: add), painted bottom → top as listed last → first */
  gradients?: (LinearGradientFill | RadialGradientFill)[];
  image?: { href: string; x: number; y: number; width: number; height: number };
}

export interface NodeBase {
  id: string;
  rect: Rect;
  opacity: number;
  clip?: Clip | null;
  /** Alpha masks (from mask-image on the node or an ancestor) applied multiplicatively. */
  masks?: MaskGradient[];
  /** CSS filter: blur(Npx) on a childless box (glows/scrims) → SVG feGaussianBlur, stdDeviation in px. */
  blur?: number;
  /** CSS clip-path basic shapes (inset/circle/ellipse/polygon) as absolute-px SVG path data; all apply. */
  clipShapes?: { d: string; evenodd?: boolean }[];
  /**
   * 2D CSS transforms (rotate/skew) on ancestors, innermost first. The node's own geometry is in the
   * *untransformed* local space of the transformed element; each layer is emitted as
   * `<g transform=matrix>` and `outerClip` (the clip in force outside that element) wraps it.
   */
  layers?: { matrix: [number, number, number, number, number, number]; outerClip?: Clip | null }[];
}

export interface GradientStop {
  /** 0..1 along the gradient line. */
  offset: number;
  color: string;
}

/** Absolute px box a gradient is sized against (CSS padding box); defaults to the node rect. */
export interface GradientBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RadialGradientFill {
  type: 'radial-gradient';
  /** Centre and radii in absolute px (rx==ry for `circle`). */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  stops: GradientStop[];
  box?: GradientBox;
}

export interface ConicGradientFill {
  type: 'conic-gradient';
  /** Centre in absolute px; `from` is the start angle in degrees (CSS: 0 = up, clockwise). */
  cx: number;
  cy: number;
  from: number;
  /** Offsets are fractions of a full turn. */
  stops: GradientStop[];
  box?: GradientBox;
}

export interface LinearGradientFill {
  type: 'linear-gradient';
  box?: GradientBox;
  /** repeating-linear-gradient: the [from,to] span (fractions of the gradient line) of one period. */
  repeat?: { from: number; to: number };
  /** CSS angle in degrees (0 = to top, 90 = to right). */
  angle: number;
  stops: GradientStop[];
}

export interface BoxNode extends NodeBase {
  kind: 'box';
  /** Solid background color, or null/absent for none. */
  fill?: string | null;
  /** Background gradient painted over `fill`. */
  gradient?: LinearGradientFill | RadialGradientFill | ConicGradientFill | null;
  /** Extra background layers (multi-layer `background-image`), painted bottom → top above `gradient`. */
  gradients?: (LinearGradientFill | RadialGradientFill | ConicGradientFill)[];
  radii: CornerRadii;
  /** Vertical radii when corners are elliptical (e.g. `border-radius: 50%` on a non-square box). */
  radiiY?: CornerRadii;
  border?: BorderEdges | null;
  shadows?: BoxShadow[];
  /** `inset` box-shadow layers (blur → feGaussianBlur σ=blur/2) — painted inside the padding box above the background. */
  insetShadows?: { offsetX: number; offsetY: number; spread: number; color: string; blur?: number }[];
  /** CSS outline rendered outside the border box. */
  outline?: { width: number; color: string; style: string; offset: number } | null;
}

export interface BorderEdge {
  width: number;
  color: string;
  style: string;
}

export interface BorderEdges {
  top: BorderEdge;
  right: BorderEdge;
  bottom: BorderEdge;
  left: BorderEdge;
}

export interface BoxShadow {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
}

export interface TextLine {
  text: string;
  x: number;
  baseline: number;
  /** Per-character left x (outline mode), aligned to `text` by code unit. */
  glyphX?: number[];
}

export interface TextNode extends NodeBase {
  kind: 'text';
  lines: TextLine[];
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  color: string;
  letterSpacing: number;
  wordSpacing: number;
  decoration?: string | null;
  /** white-space: pre* — keep runs of spaces (emitted with xml:space=preserve). */
  preserveSpace?: boolean;
  /** Extra CSS font declarations that change glyph selection/shape (font-feature-settings, font-variation-settings, …). */
  fontExtra?: string;
  decorationColor?: string;
  textAnchor?: 'start' | 'middle' | 'end';
  /** Gradient fill from background-clip:text pattern; overrides color when set. */
  gradientFill?: LinearGradientFill | null;
  /** CSS background positioning area, shared by all lines of gradient text. */
  gradientRect?: Rect;
}

export interface ImageNode extends NodeBase {
  kind: 'image';
  /** base64 data URI, or null if it must be rasterized by the backend. */
  href: string | null;
  preserveAspectRatio?: string;
}

export interface InlineSvgNode extends NodeBase {
  kind: 'inline-svg';
  /** Serialized <svg> markup, already positioned/sized and color-resolved. */
  markup: string;
}

export interface RasterNode extends NodeBase {
  kind: 'raster';
  /** Filled in by the backend; references RasterTarget.id until then. */
  href?: string | null;
  reason: string;
  /** Source element (tag.class) for diagnostics. */
  desc?: string;
  /** Set when an <img> could not be read in-page (CORS): the Node backend may fetch `src` itself and
   *  turn this node back into an ImageNode (vector-first) instead of screenshotting it. */
  imgFallback?: { src: string; rect: Rect; preserveAspectRatio?: string };
}

export interface CaptureOptions {
  /** CSS text of cross-origin stylesheets the page cannot read (href → text), supplied by a backend that can
   *  bypass CORS; lets @font-face rules in them be embedded. */
  externalCss?: Record<string, string>;
  width: number;
  height?: number;
  deviceScaleFactor?: number;
  /** 'embed' inlines @font-face files as base64; 'none' references families by name. */
  fontMode?: 'embed' | 'none';
  /** Capture per-glyph x positions for outline mode (slower). */
  collectGlyphX?: boolean;
  /**
   * When true, non-leaf containers with un-vectorizable box effects (pseudo-elements,
   * complex background images) are rasterized as a base layer while their children
   * are still vectorized on top. Set to true only when a rasterize backend is
   * available; defaults to false to avoid empty raster placeholders in pure-DOM contexts.
   */
  containerRasterFallback?: boolean;
  /**
   * When true, all scroll positions (page and overflow containers) are reset to 0
   * before capture so that scrolled-out content is included in the output. Overflow
   * containers (scroll/auto) have their clip expanded to scrollWidth × scrollHeight
   * so every item in a sidebar tree-list, scrollable panel, etc. appears in the SVG.
   * Scroll positions are restored after capture. Default false.
   */
  captureScrollableContent?: boolean;
  /**
   * Out-parameter for in-page callers (not serializable, so unused by the Playwright
   * backend): receives raster target id → source element, so a backend without
   * screenshots can re-render the element itself.
   */
  rasterElements?: Map<string, Element>;
  /** Element capture: expand inner scroll containers to full content height (default true). */
  unfurlScrollContainers?: boolean;
}
