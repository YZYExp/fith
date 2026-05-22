import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import type { Rect } from '../../core/ir/types.js';

/**
 * Compares two full-page PNG screenshots and returns bounding rectangles
 * (in CSS px) of contiguous regions where more than `threshold` fraction of
 * pixels differ. Used by the diff-patch pass to identify areas that the DOM
 * walk vectorized incorrectly or left empty.
 *
 * Algorithm: divide both images into a grid of `cellSize`-pixel cells, mark
 * cells whose diff-pixel fraction exceeds `threshold`, then flood-fill
 * adjacent marked cells into merged bounding rectangles.
 *
 * @param sceneWidth  CSS px width of the captured area (may differ from PNG
 *                    width when deviceScaleFactor > 1)
 * @param sceneHeight CSS px height of the captured area
 */
export function findDiffRegions(
  originalPng: Buffer,
  svgPng: Buffer,
  sceneWidth: number,
  sceneHeight: number,
  threshold = 0.05,
  cellSize = 64,
): Rect[] {
  const a = PNG.sync.read(originalPng);
  const b = PNG.sync.read(svgPng);
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);

  const diff = new PNG({ width: w, height: h });
  pixelmatch(a.data, b.data, diff.data, w, h, { threshold: 0.1 });

  const cols = Math.ceil(w / cellSize);
  const rows = Math.ceil(h / cellSize);
  const cellDiff = new Uint32Array(cols * rows);
  const cellTotal = new Uint32Array(cols * rows);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const col = Math.min(Math.floor(x / cellSize), cols - 1);
      const row = Math.min(Math.floor(y / cellSize), rows - 1);
      const idx = row * cols + col;
      cellTotal[idx]++;
      const pi = (y * w + x) * 4;
      // pixelmatch marks differing pixels as red (r=255, g=0, b=0)
      if (diff.data[pi] === 255 && diff.data[pi + 1] === 0) cellDiff[idx]++;
    }
  }

  const marked = new Uint8Array(cols * rows);
  for (let i = 0; i < cellTotal.length; i++) {
    if (cellTotal[i] > 0 && cellDiff[i] / cellTotal[i] > threshold) marked[i] = 1;
  }

  // BFS flood-fill: merge adjacent marked cells into bounding rectangles.
  const visited = new Uint8Array(cols * rows);
  const scaleX = sceneWidth / w;
  const scaleY = sceneHeight / h;
  const rects: Rect[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!marked[idx] || visited[idx]) continue;

      let minC = c, maxC = c, minR = r, maxR = r;
      const queue = [idx];
      visited[idx] = 1;
      while (queue.length) {
        const cur = queue.shift()!;
        const cr = Math.floor(cur / cols);
        const cc = cur % cols;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const nr = cr + dr, nc = cc + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const ni = nr * cols + nc;
          if (!marked[ni] || visited[ni]) continue;
          visited[ni] = 1;
          minC = Math.min(minC, nc); maxC = Math.max(maxC, nc);
          minR = Math.min(minR, nr); maxR = Math.max(maxR, nr);
          queue.push(ni);
        }
      }

      // Convert cell-grid coordinates back to CSS px with a small safety margin.
      const pad = 4;
      const px = Math.max(0, Math.round(minC * cellSize * scaleX) - pad);
      const py = Math.max(0, Math.round(minR * cellSize * scaleY) - pad);
      const pr = Math.min(sceneWidth, Math.round((maxC + 1) * cellSize * scaleX) + pad);
      const pb = Math.min(sceneHeight, Math.round((maxR + 1) * cellSize * scaleY) + pad);
      rects.push({ x: px, y: py, width: pr - px, height: pb - py });
    }
  }

  return rects;
}
