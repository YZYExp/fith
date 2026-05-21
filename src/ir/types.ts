/**
 * Scene IR — the intermediate representation between browser capture and SVG emission.
 *
 * A Scene is a FLAT list of paint nodes already sorted in browser paint order.
 * All coordinates are absolute device-independent pixels in the document space.
 * All style values are *computed* values (resolved by Chrome), not authored CSS.
 *
 * This file is design-only: types/interfaces, no logic.
 */

export interface Scene {
  /** Document size in CSS pixels; becomes the SVG viewBox. */
  width: number;
  height: number;
  /** devicePixelRatio used for raster fallbacks / image embedding. */
  deviceScaleFactor: number;
  /** Page background paint color (or 'transparent'). */
  background: string;
  /** Paint nodes in browser paint order (index 0 painted first / bottom-most). */
  nodes: PaintNode[];
  /** Fonts referenced by text nodes; embedded into the SVG. */
  fonts: FontFace[];
}

export type PaintNode =
  | BoxNode
  | TextNode
  | ImageNode
  | InlineSvgNode
  | RasterNode;

export interface NodeBase {
  /** Stable id for clip/filter references and debugging. */
  id: string;
  /** Absolute bounds in document px. */
  rect: Rect;
  /** Resolved opacity in [0,1]. */
  opacity: number;
  /** Resolved transform as a 6-tuple matrix, relative to document space. */
  transform?: Matrix;
  /** Clip applied to this node (overflow / border-radius / clip-path). */
  clip?: Clip;
  /** Compositing blend mode, if not 'normal'. */
  blendMode?: string;
}

export interface BoxNode extends NodeBase {
  kind: 'box';
  /** Background fill: solid color, gradient ref, or image. */
  background?: Fill;
  borders?: BorderEdges;
  /** Corner radii (top-left, top-right, bottom-right, bottom-left). */
  radius?: CornerRadii;
  shadows?: BoxShadow[];
  filter?: FilterChain;
}

export interface TextNode extends NodeBase {
  kind: 'text';
  /** One entry per browser-broken line. */
  lines: TextLine[];
  font: FontRef;
  color: string;
  letterSpacing: number;
  wordSpacing: number;
  decoration?: TextDecoration;
}

export interface TextLine {
  /** Run content; either the whole string or per-glyph for non-uniform spacing. */
  text: string;
  /** Left edge of the line box (text-anchor:start). */
  x: number;
  /** Baseline y in document px. */
  baseline: number;
  /** Optional per-character x advances for justify / letter-spacing edge cases. */
  glyphX?: number[];
}

export interface ImageNode extends NodeBase {
  kind: 'image';
  /** base64 data URI (image, canvas snapshot, embedded). */
  href: string;
  objectFit?: 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';
}

export interface InlineSvgNode extends NodeBase {
  kind: 'inline-svg';
  /** Serialized <svg> subtree, transplanted as-is. */
  markup: string;
}

/** A region that could not be vectorized faithfully; rasterized to an <image>. */
export interface RasterNode extends NodeBase {
  kind: 'raster';
  href: string;
  /** Why it was rasterized — surfaced as a warning. */
  reason: string;
}

// ── value types ──────────────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** SVG-style transform matrix [a, b, c, d, e, f]. */
export type Matrix = [number, number, number, number, number, number];

export type Fill =
  | { type: 'color'; color: string }
  | { type: 'gradient'; gradient: Gradient }
  | { type: 'image'; href: string; repeat: BackgroundRepeat; position: Point; size: Size };

export type BackgroundRepeat = 'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y';

export interface Point { x: number; y: number; }
export interface Size { width: number; height: number; }

export type Gradient =
  | LinearGradient
  | RadialGradient
  | ConicGradient;

export interface GradientStop { offset: number; color: string; }

export interface LinearGradient {
  type: 'linear';
  /** Direction in degrees (CSS angle), converted to x1/y1/x2/y2 at emit time. */
  angle: number;
  stops: GradientStop[];
}

export interface RadialGradient {
  type: 'radial';
  shape: 'circle' | 'ellipse';
  center: Point;
  radius: Size;
  stops: GradientStop[];
}

/** SVG has no native conic gradient → emitter rasterizes or approximates. */
export interface ConicGradient {
  type: 'conic';
  center: Point;
  fromAngle: number;
  stops: GradientStop[];
}

export interface BorderEdge {
  width: number;
  color: string;
  style: 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
}

export interface BorderEdges {
  top: BorderEdge;
  right: BorderEdge;
  bottom: BorderEdge;
  left: BorderEdge;
}

/** top-left, top-right, bottom-right, bottom-left (px). */
export type CornerRadii = [number, number, number, number];

export interface BoxShadow {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
  inset: boolean;
}

export type Clip =
  | { type: 'rect'; rect: Rect; radius?: CornerRadii }
  | { type: 'path'; d: string };

export interface FilterChain {
  /** Raw computed filter functions, e.g. "blur(4px) brightness(1.2)". */
  functions: string;
}

export interface TextDecoration {
  line: 'underline' | 'line-through' | 'overline';
  color: string;
  thickness: number;
}

export interface FontRef {
  family: string;
  size: number;
  weight: number;
  style: 'normal' | 'italic' | 'oblique';
  /** Index into Scene.fonts when an embedded face backs this text. */
  faceIndex?: number;
}

export interface FontFace {
  family: string;
  weight: number;
  style: string;
  /** base64 data URI of the (possibly subsetted) font file. */
  src: string;
  format: 'woff2' | 'woff' | 'truetype' | 'opentype';
}
