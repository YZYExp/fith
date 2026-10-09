/**
 * Real-world benchmark corpus. Two kinds of targets:
 *  - live:  well-known public sites (need network; skipped when unreachable)
 *  - local: real third-party UI libraries pulled from the npm registry by
 *           `pnpm bench:fetch` and assembled into pages by bench/pages/*.html
 *
 * `maxRatio` is the regression gate (pixel-diff fraction); `minTextCoverage` is the
 * floor for vector-text chars / DOM-text chars; `maxRasterArea` is the fraction of the
 * viewport allowed to fall back to raster. Tighten these as fidelity improves.
 */
export interface Target {
  id: string;
  kind: 'live' | 'local';
  /** URL for live targets; path relative to bench/pages for local ones. */
  src: string;
  width: number;
  height: number;
  settleMs?: number;
  maxRatio: number;
  minTextCoverage?: number;
  maxRasterArea?: number;
  notes?: string;
}

export const CORPUS: Target[] = [
  { id: 'live-nodejs', kind: 'live', src: 'https://nodejs.org/en', width: 1280, height: 1600, settleMs: 1500, maxRatio: 0.15 },
  { id: 'live-anthropic', kind: 'live', src: 'https://www.anthropic.com', width: 1280, height: 1600, settleMs: 2000, maxRatio: 0.2 },
  { id: 'live-pypi', kind: 'live', src: 'https://pypi.org', width: 1280, height: 1400, settleMs: 1000, maxRatio: 0.15 },
];
