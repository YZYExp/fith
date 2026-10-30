import type { CaptureReport, Scene } from './ir/types.js';

/**
 * Summarise what a captured scene could not draw as vectors. Call it once the backend has filled the raster
 * nodes, and before `scene.fonts` is cleared for outline mode (pass `outlined` for that case).
 */
export function buildReport(scene: Scene, opts: { outlined?: boolean } = {}): CaptureReport {
  const rasters: CaptureReport['rasters'] = [];
  const omitted: CaptureReport['omitted'] = [];
  const families = new Set<string>();
  for (const node of scene.nodes) {
    if (node.kind === 'raster') {
      const filled = node.href ? (node.filledBy ?? 'screenshot') : 'none';
      rasters.push({ reason: node.reason, rect: node.rect, desc: node.desc, filled });
      if (filled === 'none' && !node.imgFallback) omitted.push({ reason: node.reason, rect: node.rect, desc: node.desc });
    } else if (node.kind === 'text') {
      const primary = node.fontFamily.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
      if (primary) families.add(primary);
    }
  }
  const embedded = new Set(scene.fonts.map((f) => f.family.toLowerCase()));
  const fonts = [...families].map((family) => ({
    family,
    mode: opts.outlined ? ('outlined' as const) : embedded.has(family.toLowerCase()) ? ('embedded' as const) : ('referenced' as const),
  }));
  return { rasters, omitted, fonts };
}
