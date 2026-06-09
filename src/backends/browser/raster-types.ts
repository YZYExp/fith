/** Shared types for the screenshot-backed rasterizers. */
import type { Rect } from '../../core/ir/types.js';

export interface Viewport {
  width: number;
  height: number;
}

/** A captured screenshot. Environments extend this with their own bitmap
 *  payload (ImageBitmap, PNG, …); only `scale` is needed by the core. */
export interface TileShot {
  /** Device px per CSS px in the screenshot (devicePixelRatio + browser zoom). */
  scale: number;
}

/** Per-environment output sink: accumulate device-px slices, then encode. */
export interface TileCanvas<S extends TileShot> {
  /** Paint a crop of `shot` (src, device px) into the output (dst, device px). */
  draw(shot: S, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  /** Encode the accumulated output as a data URL (null on failure). */
  toDataURL(): Promise<string | null>;
}

export type { Rect };
