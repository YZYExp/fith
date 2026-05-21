/**
 * Public API surface (planned). Implementation lands per milestone — see DESIGN.md.
 */
import type { Page } from 'puppeteer';

export type * from './ir/types.js';

export interface ConvertOptions {
  /** Viewport width in CSS px (required). */
  width: number;
  /** Viewport height in CSS px; omit to use content height. */
  height?: number;
  /** Resolution multiplier for raster fallbacks and image embedding. */
  deviceScaleFactor?: number;
  /** 'embed' keeps selectable <text> + base64 webfonts; 'outline' vectorizes glyphs to <path>. */
  fontMode?: 'embed' | 'outline';
  /** 'raster' falls back to <image> for non-vectorizable regions; 'none' approximates and warns. */
  fallback?: 'raster' | 'none';
  /** Page background; 'transparent' to keep alpha. */
  background?: string;
  /** Enable defs dedup + path/number minification. */
  optimize?: boolean;
}

/** Input may be raw HTML, a URL, or a caller-owned Puppeteer page (for batching). */
export type ConvertInput =
  | string
  | { html: string }
  | { url: string }
  | { page: Page };

export interface ConvertResult {
  svg: string;
  /** Non-fatal notes, e.g. regions that were rasterized in 'none' mode. */
  warnings: string[];
}

export declare function htmlToSvg(
  input: ConvertInput,
  options: ConvertOptions,
): Promise<ConvertResult>;
