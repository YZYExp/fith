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
  gradient?: LinearGradientFill;
  image?: { href: string; x: number; y: number; width: number; height: number };
}

export interface NodeBase {
  id: string;
  rect: Rect;
  opacity: number;
  clip?: Clip | null;
  /** Alpha masks (from mask-image on the node or an ancestor) applied multiplicatively. */
  masks?: MaskGradient[];
}

export interface GradientStop {
  /** 0..1 along the gradient line. */
  offset: number;
  color: string;
}

export interface LinearGradientFill {
  type: 'linear-gradient';
  /** CSS angle in degrees (0 = to top, 90 = to right). */
  angle: number;
  stops: GradientStop[];
}

export interface BoxNode extends NodeBase {
  kind: 'box';
  /** Solid background color, or null/absent for none. */
  fill?: string | null;
  /** Background gradient painted over `fill`. */
  gradient?: LinearGradientFill | null;
  radii: CornerRadii;
  border?: BorderEdges | null;
  shadows?: BoxShadow[];
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
}

export interface CaptureOptions {
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
}
